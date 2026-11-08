const express = require('express');
const db = require('../db');
const { lerConfiguracoes, valorCorrida } = require('../config_valores');
const { HttpError, wrap, uuid, numero, dataOpcional, distanciaRuaKm } = require('../util');

const router = express.Router();

// Acima disso a posição provavelmente está errada (ex.: emulador na Califórnia): ignora a coleta.
const MAX_COLETA_KM = 60;
function coletaKm(lat, lng, rLat, rLng) {
  if (lat === null || lng === null) return null;
  const d = distanciaRuaKm(lat, lng, rLat, rLng);
  return d !== null && d <= MAX_COLETA_KM ? d : null;
}

const posicao = (src) => ({
  lat: numero(src.lat, 'lat', { min: -90, max: 90, obrigatorio: false }),
  lng: numero(src.lng, 'lng', { min: -180, max: 180, obrigatorio: false }),
});

// Corridas disponíveis. O endereço exato do cliente só aparece depois de aceitar.
router.get('/corridas', wrap(async (req, res) => {
  const { lat, lng } = posicao(req.query);
  const cfg = await lerConfiguracoes();
  const { rows } = await db.query(
    `SELECT e.id, e.dist_entrega_km, r.nome AS restaurante, r.endereco AS restaurante_endereco,
            r.latitude AS restaurante_lat, r.longitude AS restaurante_lng, en.bairro, en.cidade
     FROM entregas e
     JOIN pedidos p ON p.id = e.pedido_id
     JOIN restaurantes r ON r.id = p.restaurante_id
     JOIN enderecos en ON en.id = p.endereco_entrega_id
     WHERE e.status = 'DISPONIVEL' ORDER BY p.criado_em`);
  res.json(rows.map((r) => {
    const coleta = coletaKm(lat, lng, r.restaurante_lat, r.restaurante_lng);
    return { ...r, dist_coleta_km: coleta, valor_motoboy: valorCorrida(cfg, coleta, r.dist_entrega_km) };
  }));
}));

router.post('/corridas/:id/aceitar', wrap(async (req, res) => {
  const id = uuid(req.params.id);
  const { lat, lng } = posicao(req.body);
  const cfg = await lerConfiguracoes();
  const corrida = await db.tx(async (c) => {
    const e = (await c.query(
      `SELECT e.dist_entrega_km, r.latitude AS r_lat, r.longitude AS r_lng
       FROM entregas e JOIN pedidos p ON p.id = e.pedido_id JOIN restaurantes r ON r.id = p.restaurante_id
       WHERE e.id = $1`, [id])).rows[0];
    if (!e) throw new HttpError(404, 'Corrida não encontrada.');
    const coleta = coletaKm(lat, lng, e.r_lat, e.r_lng);
    const valor = valorCorrida(cfg, coleta, e.dist_entrega_km);
    // Atômico: só um entregador consegue pegar a corrida (o índice único impede 2 corridas ativas por motoboy).
    const { rows } = await c.query(
      `UPDATE entregas SET motoboy_id = $2, status = 'ACEITA', dist_coleta_km = $3, valor_motoboy = $4, aceita_em = now()
       WHERE id = $1 AND status = 'DISPONIVEL' RETURNING id, status, dist_coleta_km, dist_entrega_km, valor_motoboy`,
      [id, req.user.id, coleta, valor]);
    if (!rows[0]) throw new HttpError(409, 'Esta corrida já foi aceita por outro entregador.');
    return rows[0];
  });
  res.json(corrida);
}));

router.get('/minha-corrida', wrap(async (req, res) => {
  const { rows } = await db.query(
    `SELECT e.id, e.status, e.dist_coleta_km, e.dist_entrega_km, e.valor_motoboy, p.id AS pedido_id,
            r.nome AS restaurante, r.endereco AS restaurante_endereco, r.latitude AS restaurante_lat, r.longitude AS restaurante_lng,
            u.nome AS cliente, en.logradouro, en.numero, en.complemento, en.bairro, en.cidade,
            en.latitude AS cliente_lat, en.longitude AS cliente_lng,
            pg.tipo AS pagamento_tipo, pg.status AS pagamento_status, p.total
     FROM entregas e
     JOIN pedidos p ON p.id = e.pedido_id
     JOIN restaurantes r ON r.id = p.restaurante_id
     JOIN usuarios u ON u.id = p.cliente_id
     JOIN enderecos en ON en.id = p.endereco_entrega_id
     LEFT JOIN pagamentos pg ON pg.pedido_id = p.id
     WHERE e.motoboy_id = $1 AND e.status IN ('ACEITA', 'COLETADA')`, [req.user.id]);
  res.json({ corrida: rows[0] || null });
}));

router.post('/corridas/:id/coletar', wrap(async (req, res) => {
  const id = uuid(req.params.id);
  await db.tx(async (c) => {
    const { rows } = await c.query(
      "UPDATE entregas SET status = 'COLETADA' WHERE id = $1 AND motoboy_id = $2 AND status = 'ACEITA' RETURNING pedido_id",
      [id, req.user.id]);
    if (!rows[0]) throw new HttpError(409, 'Esta corrida não está aguardando coleta.');
    await c.query("UPDATE pedidos SET status = 'SAIU_PARA_ENTREGA' WHERE id = $1", [rows[0].pedido_id]);
  });
  res.json({ ok: true, status: 'COLETADA' });
}));

router.post('/corridas/:id/concluir', wrap(async (req, res) => {
  const id = uuid(req.params.id);
  const r = await db.tx(async (c) => {
    const { rows } = await c.query(
      `UPDATE entregas SET status = 'CONCLUIDA', concluida_em = now()
       WHERE id = $1 AND motoboy_id = $2 AND status = 'COLETADA' RETURNING pedido_id, valor_motoboy`, [id, req.user.id]);
    if (!rows[0]) throw new HttpError(409, 'Primeiro confirme a coleta no restaurante.');
    await c.query("UPDATE pedidos SET status = 'ENTREGUE' WHERE id = $1", [rows[0].pedido_id]);
    // Dinheiro: o pagamento é confirmado quando o entregador recebe do cliente.
    await c.query("UPDATE pagamentos SET status = 'APROVADO' WHERE pedido_id = $1 AND tipo = 'DINHEIRO' AND status = 'PENDENTE'", [rows[0].pedido_id]);
    return rows[0];
  });
  res.json({ ok: true, status: 'CONCLUIDA', valor_motoboy: r.valor_motoboy });
}));

router.get('/ganhos', wrap(async (req, res) => {
  const ini = dataOpcional(req.query.inicio, 'inicio');
  const fim = dataOpcional(req.query.fim, 'fim');
  const { rows } = await db.query(
    `SELECT COUNT(*) AS corridas, COALESCE(SUM(valor_motoboy), 0) AS total
     FROM entregas WHERE motoboy_id = $1 AND status = 'CONCLUIDA'
       AND concluida_em >= COALESCE($2::date, CURRENT_DATE) AND concluida_em < COALESCE($3::date, CURRENT_DATE) + 1`,
    [req.user.id, ini, fim]);
  res.json(rows[0]);
}));

module.exports = router;
