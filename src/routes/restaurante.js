const express = require('express');
const db = require('../db');
const imagem = require('../imagem');
const { lerConfiguracoes } = require('../config_valores');
const { HttpError, wrap, uuid, texto, numero, dataOpcional, distanciaRuaKm } = require('../util');

const router = express.Router();
const STATUS_VALIDOS = ['CRIADO', 'CONFIRMADO', 'EM_PREPARO', 'PRONTO', 'SAIU_PARA_ENTREGA', 'ENTREGUE', 'CANCELADO'];
// O restaurante só controla até "PRONTO". Saiu/Entregue são do entregador.
const TRANSICOES = {
  CRIADO: ['CONFIRMADO', 'EM_PREPARO', 'CANCELADO'],
  CONFIRMADO: ['EM_PREPARO', 'CANCELADO'],
  EM_PREPARO: ['PRONTO', 'CANCELADO'],
};

// Descobre qual restaurante pertence a este usuário.
router.use(wrap(async (req, res, next) => {
  const { rows } = await db.query(
    'SELECT * FROM restaurantes WHERE dono_id = $1 AND ativo ORDER BY criado_em LIMIT 1', [req.user.id]);
  if (!rows[0]) throw new HttpError(404, 'Nenhum restaurante está vinculado a esta conta.');
  req.rest = rows[0];
  next();
}));

// --------------------------- Dados do restaurante ---------------------------
router.get('/meu', (req, res) => res.json(req.rest));

router.patch('/meu', wrap(async (req, res) => {
  const b = req.body;
  const campos = {};
  if (b.nome !== undefined) campos.nome = texto(b.nome, 'nome', { max: 100 });
  if (b.categoria !== undefined) campos.categoria = texto(b.categoria, 'categoria', { max: 50 });
  if (b.aberto !== undefined) campos.aberto = b.aberto === true;
  if (b.taxa_entrega !== undefined) campos.taxa_entrega = numero(b.taxa_entrega, 'taxa de entrega', { max: 500 });
  if (b.pedido_minimo !== undefined) campos.pedido_minimo = numero(b.pedido_minimo, 'pedido mínimo', { max: 5000 });
  const chaves = Object.keys(campos);
  if (!chaves.length) throw new HttpError(400, 'Nada para alterar.');
  const sets = chaves.map((k, i) => `${k} = $${i + 2}`).join(', ');
  const { rows } = await db.query(`UPDATE restaurantes SET ${sets} WHERE id = $1 RETURNING *`, [req.rest.id, ...chaves.map((k) => campos[k])]);
  res.json(rows[0]);
}));

// Foto de capa: o app envia a imagem em base64 (PNG ou JPEG, até ~5 MB).
router.put('/capa', wrap(async (req, res) => {
  const url = imagem.salvar(req.body.imagem_base64, req.rest.id);
  await db.query('UPDATE restaurantes SET foto_capa_url = $2 WHERE id = $1', [req.rest.id, url]);
  imagem.apagar(req.rest.foto_capa_url);
  res.json({ foto_capa_url: url });
}));

// -------------------------------- Cardápio --------------------------------
router.get('/cardapio', wrap(async (req, res) => {
  const { rows } = await db.query(
    `SELECT id, nome, descricao, preco, foto_url, visivel FROM itens_cardapio
     WHERE restaurante_id = $1 AND removido_em IS NULL ORDER BY nome`, [req.rest.id]);
  res.json(rows);
}));

router.post('/cardapio', wrap(async (req, res) => {
  const b = req.body;
  const { rows } = await db.query(
    `INSERT INTO itens_cardapio (restaurante_id, nome, descricao, preco, visivel)
     VALUES ($1,$2,$3,$4,$5) RETURNING id, nome, descricao, preco, foto_url, visivel`,
    [req.rest.id, texto(b.nome, 'nome', { max: 80 }), texto(b.descricao, 'descrição', { max: 300, obrigatorio: false }),
     numero(b.preco, 'preço', { max: 9999 }), b.visivel !== false]);
  res.status(201).json(rows[0]);
}));

router.patch('/cardapio/:id', wrap(async (req, res) => {
  const id = uuid(req.params.id);
  const b = req.body;
  const campos = {};
  if (b.nome !== undefined) campos.nome = texto(b.nome, 'nome', { max: 80 });
  if (b.descricao !== undefined) campos.descricao = texto(b.descricao, 'descrição', { max: 300, obrigatorio: false });
  if (b.preco !== undefined) campos.preco = numero(b.preco, 'preço', { max: 9999 });
  if (b.visivel !== undefined) campos.visivel = b.visivel === true; // ocultar / mostrar
  const chaves = Object.keys(campos);
  if (!chaves.length) throw new HttpError(400, 'Nada para alterar.');
  const sets = chaves.map((k, i) => `${k} = $${i + 3}`).join(', ');
  const { rows } = await db.query(
    `UPDATE itens_cardapio SET ${sets} WHERE id = $1 AND restaurante_id = $2 AND removido_em IS NULL
     RETURNING id, nome, descricao, preco, foto_url, visivel`, [id, req.rest.id, ...chaves.map((k) => campos[k])]);
  if (!rows[0]) throw new HttpError(404, 'Item não encontrado.');
  res.json(rows[0]);
}));

// "Remover" = esconder para sempre mantendo o histórico dos pedidos antigos.
router.delete('/cardapio/:id', wrap(async (req, res) => {
  const { rowCount } = await db.query(
    'UPDATE itens_cardapio SET removido_em = now() WHERE id = $1 AND restaurante_id = $2 AND removido_em IS NULL',
    [uuid(req.params.id), req.rest.id]);
  if (!rowCount) throw new HttpError(404, 'Item não encontrado.');
  res.status(204).end();
}));

// Foto de cada produto (aparece no cardápio do cliente).
router.put('/cardapio/:id/foto', wrap(async (req, res) => {
  const id = uuid(req.params.id);
  const item = (await db.query(
    'SELECT foto_url FROM itens_cardapio WHERE id = $1 AND restaurante_id = $2 AND removido_em IS NULL',
    [id, req.rest.id])).rows[0];
  if (!item) throw new HttpError(404, 'Item não encontrado.');
  const url = imagem.salvar(req.body.imagem_base64, `item-${id}`);
  await db.query('UPDATE itens_cardapio SET foto_url = $2 WHERE id = $1', [id, url]);
  imagem.apagar(item.foto_url);
  res.json({ foto_url: url });
}));

router.delete('/cardapio/:id/foto', wrap(async (req, res) => {
  const id = uuid(req.params.id);
  const item = (await db.query(
    'SELECT foto_url FROM itens_cardapio WHERE id = $1 AND restaurante_id = $2 AND removido_em IS NULL',
    [id, req.rest.id])).rows[0];
  if (!item) throw new HttpError(404, 'Item não encontrado.');
  await db.query('UPDATE itens_cardapio SET foto_url = NULL WHERE id = $1', [id]);
  imagem.apagar(item.foto_url);
  res.status(204).end();
}));

// --------------------------------- Pedidos ---------------------------------
router.get('/pedidos', wrap(async (req, res) => {
  let status = ['CRIADO', 'CONFIRMADO', 'EM_PREPARO', 'PRONTO', 'SAIU_PARA_ENTREGA'];
  if (req.query.status) {
    status = String(req.query.status).split(',');
    if (status.some((s) => !STATUS_VALIDOS.includes(s))) throw new HttpError(400, 'Status inválido.');
  }
  const { rows } = await db.query(
    `SELECT p.id, p.status, p.total, p.criado_em, u.nome AS cliente,
            (SELECT string_agg(ip.quantidade || 'x ' || ip.nome_item, ', ' ORDER BY ip.nome_item)
             FROM itens_pedido ip WHERE ip.pedido_id = p.id) AS itens
     FROM pedidos p JOIN usuarios u ON u.id = p.cliente_id
     WHERE p.restaurante_id = $1 AND p.status = ANY($2::status_pedido[])
     ORDER BY p.criado_em DESC LIMIT 100`, [req.rest.id, status]);
  res.json(rows);
}));

router.patch('/pedidos/:id/status', wrap(async (req, res) => {
  const id = uuid(req.params.id);
  const novo = req.body.status;
  if (!STATUS_VALIDOS.includes(novo)) throw new HttpError(400, 'Status inválido.');
  const resultado = await db.tx(async (c) => {
    const p = (await c.query(
      `SELECT p.id, p.status, e.latitude AS e_lat, e.longitude AS e_lng
       FROM pedidos p JOIN enderecos e ON e.id = p.endereco_entrega_id
       WHERE p.id = $1 AND p.restaurante_id = $2 FOR UPDATE OF p`, [id, req.rest.id])).rows[0];
    if (!p) throw new HttpError(404, 'Pedido não encontrado.');
    if (!(TRANSICOES[p.status] || []).includes(novo)) {
      throw new HttpError(409, `Não é possível mudar de ${p.status} para ${novo}.`);
    }
    await c.query('UPDATE pedidos SET status = $2 WHERE id = $1', [id, novo]);
    if (novo === 'PRONTO') {
      // Libera a corrida para os entregadores.
      const dist = distanciaRuaKm(req.rest.latitude, req.rest.longitude, p.e_lat, p.e_lng);
      await c.query(
        `INSERT INTO entregas (pedido_id, status, dist_entrega_km) VALUES ($1, 'DISPONIVEL', $2)
         ON CONFLICT (pedido_id) DO NOTHING`, [id, dist]);
    }
    if (novo === 'CANCELADO') {
      await c.query("UPDATE pagamentos SET status = 'ESTORNADO' WHERE pedido_id = $1 AND status = 'APROVADO'", [id]);
    }
    return { id, status: novo };
  });
  res.json(resultado);
}));

// -------------------------------- Relatório --------------------------------
router.get('/relatorio', wrap(async (req, res) => {
  const ini = dataOpcional(req.query.inicio, 'inicio');
  const fim = dataOpcional(req.query.fim, 'fim');
  const periodo = `p.criado_em >= COALESCE($2::date, CURRENT_DATE - 30) AND p.criado_em < COALESCE($3::date, CURRENT_DATE) + 1`;
  const resumo = (await db.query(
    `SELECT COUNT(*) AS qtd_pedidos, COALESCE(SUM(p.total), 0) AS faturamento,
            COALESCE(ROUND(AVG(p.total), 2), 0) AS ticket_medio
     FROM pedidos p WHERE p.restaurante_id = $1 AND p.status = 'ENTREGUE' AND ${periodo}`,
    [req.rest.id, ini, fim])).rows[0];
  const pagamentos = (await db.query(
    'SELECT * FROM relatorio_pagamentos(COALESCE($1::date, CURRENT_DATE - 30), COALESCE($2::date, CURRENT_DATE), $3)',
    [ini, fim, req.rest.id])).rows;
  const maisVendidos = (await db.query(
    `SELECT ip.nome_item AS item, SUM(ip.quantidade) AS quantidade, SUM(ip.quantidade * ip.preco_unitario) AS valor
     FROM itens_pedido ip JOIN pedidos p ON p.id = ip.pedido_id
     WHERE p.restaurante_id = $1 AND p.status = 'ENTREGUE' AND ${periodo}
     GROUP BY ip.nome_item ORDER BY 2 DESC LIMIT 5`, [req.rest.id, ini, fim])).rows;
  const cfg = await lerConfiguracoes();
  res.json({ resumo, pagamentos, mais_vendidos: maisVendidos, comissao_percentual: cfg.comissao_plataforma });
}));

module.exports = router;
