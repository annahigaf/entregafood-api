const express = require('express');
const db = require('../db');
const { HttpError, wrap, uuid, texto, numero, arred2 } = require('../util');

const router = express.Router();
const TIPOS_PAGAMENTO = ['PIX', 'CARTAO_CREDITO', 'CARTAO_DEBITO', 'DINHEIRO'];

// ------------------------------ Endereços ------------------------------
router.get('/enderecos', wrap(async (req, res) => {
  const { rows } = await db.query(
    'SELECT * FROM enderecos WHERE usuario_id = $1 ORDER BY principal DESC, apelido', [req.user.id]);
  res.json(rows);
}));

router.post('/enderecos', wrap(async (req, res) => {
  const b = req.body;
  const dados = {
    apelido: texto(b.apelido, 'apelido', { max: 40 }),
    logradouro: texto(b.logradouro, 'endereço', { max: 200 }),
    numero: texto(b.numero, 'número', { max: 20, obrigatorio: false }),
    complemento: texto(b.complemento, 'complemento', { max: 80, obrigatorio: false }),
    bairro: texto(b.bairro, 'bairro', { max: 80, obrigatorio: false }),
    cidade: texto(b.cidade ?? 'São Paulo', 'cidade', { max: 80 }),
    uf: texto(b.uf ?? 'SP', 'UF', { min: 2, max: 2 }).toUpperCase(),
    cep: texto(b.cep, 'CEP', { max: 10, obrigatorio: false }),
    latitude: numero(b.latitude, 'latitude', { min: -90, max: 90, obrigatorio: false }),
    longitude: numero(b.longitude, 'longitude', { min: -180, max: 180, obrigatorio: false }),
  };
  const criado = await db.tx(async (c) => {
    const { rows: ja } = await c.query('SELECT 1 FROM enderecos WHERE usuario_id = $1 LIMIT 1', [req.user.id]);
    const principal = b.principal === true || ja.length === 0; // o primeiro é o principal
    if (principal) await c.query('UPDATE enderecos SET principal = false WHERE usuario_id = $1', [req.user.id]);
    const { rows } = await c.query(
      `INSERT INTO enderecos (usuario_id, apelido, logradouro, numero, complemento, bairro, cidade, uf, cep, latitude, longitude, principal)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [req.user.id, dados.apelido, dados.logradouro, dados.numero, dados.complemento, dados.bairro,
       dados.cidade, dados.uf, dados.cep, dados.latitude, dados.longitude, principal]);
    return rows[0];
  });
  res.status(201).json(criado);
}));

router.delete('/enderecos/:id', wrap(async (req, res) => {
  const { rowCount } = await db.query(
    'DELETE FROM enderecos WHERE id = $1 AND usuario_id = $2', [uuid(req.params.id), req.user.id]);
  if (!rowCount) throw new HttpError(404, 'Endereço não encontrado.');
  res.status(204).end();
}));

// -------------------------- Meios de pagamento --------------------------
router.get('/meios-pagamento', wrap(async (req, res) => {
  const { rows } = await db.query(
    `SELECT id, tipo, bandeira, ultimos4, principal FROM meios_pagamento
     WHERE usuario_id = $1 ORDER BY principal DESC, tipo`, [req.user.id]);
  res.json(rows);
}));

router.post('/meios-pagamento', wrap(async (req, res) => {
  const b = req.body;
  // O servidor NUNCA recebe o número completo do cartão (use o SDK do gateway no app).
  for (const proibido of ['numero', 'numero_cartao', 'cvv', 'cvc', 'validade']) {
    if (b[proibido] !== undefined) throw new HttpError(400, 'Não envie os dados completos do cartão. Envie só bandeira e os 4 últimos dígitos.');
  }
  if (!TIPOS_PAGAMENTO.includes(b.tipo)) throw new HttpError(400, 'Tipo de pagamento inválido.');
  const ehCartao = b.tipo.startsWith('CARTAO');
  let bandeira = null, ultimos4 = null;
  if (ehCartao) {
    bandeira = texto(b.bandeira, 'bandeira', { max: 30 });
    if (!/^\d{4}$/.test(String(b.ultimos4 ?? ''))) throw new HttpError(400, 'Informe os 4 últimos dígitos do cartão.');
    ultimos4 = String(b.ultimos4);
  }
  const criado = await db.tx(async (c) => {
    const { rows: ja } = await c.query('SELECT 1 FROM meios_pagamento WHERE usuario_id = $1 LIMIT 1', [req.user.id]);
    const principal = b.principal === true || ja.length === 0;
    if (principal) await c.query('UPDATE meios_pagamento SET principal = false WHERE usuario_id = $1', [req.user.id]);
    const { rows } = await c.query(
      `INSERT INTO meios_pagamento (usuario_id, tipo, bandeira, ultimos4, token_gateway, principal)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, tipo, bandeira, ultimos4, principal`,
      [req.user.id, b.tipo, bandeira, ultimos4, texto(b.token_gateway, 'token', { max: 200, obrigatorio: false }), principal]);
    return rows[0];
  });
  res.status(201).json(criado);
}));

router.delete('/meios-pagamento/:id', wrap(async (req, res) => {
  const { rowCount } = await db.query(
    'DELETE FROM meios_pagamento WHERE id = $1 AND usuario_id = $2', [uuid(req.params.id), req.user.id]);
  if (!rowCount) throw new HttpError(404, 'Meio de pagamento não encontrado.');
  res.status(204).end();
}));

// ------------------------------- Pedidos -------------------------------
const PEDIDO_CAMPOS = 'id, status, subtotal, taxa_entrega, total, criado_em';

/** Pedido já criado com esta chave (usado quando o app repete o envio por falha de rede). */
async function pedidoPorChave(clienteId, chave) {
  const { rows } = await db.query(
    `SELECT ${PEDIDO_CAMPOS} FROM pedidos WHERE cliente_id = $1 AND chave_idempotencia = $2`, [clienteId, chave]);
  return rows[0] || null;
}

router.post('/pedidos', wrap(async (req, res) => {
  const b = req.body;
  // "chave" evita pedido duplicado: se o app repetir o envio (ex.: caiu a conexão), recebe o mesmo pedido de volta.
  const chave = texto(b.chave, 'chave do pedido', { min: 8, max: 80, obrigatorio: false });
  if (chave) {
    const existente = await pedidoPorChave(req.user.id, chave);
    if (existente) return res.status(200).json({ ...existente, repetido: true });
  }
  const restauranteId = uuid(b.restaurante_id, 'restaurante');
  const enderecoId = uuid(b.endereco_id, 'endereço');
  if (!TIPOS_PAGAMENTO.includes(b.tipo_pagamento)) throw new HttpError(400, 'Forma de pagamento inválida.');
  if (!Array.isArray(b.itens) || b.itens.length === 0 || b.itens.length > 50) {
    throw new HttpError(400, 'Adicione de 1 a 50 itens ao pedido.');
  }
  const itens = b.itens.map((i) => ({
    item_id: uuid(i.item_id, 'item'),
    quantidade: numero(i.quantidade, 'quantidade', { min: 1, max: 50 }),
    observacao: texto(i.observacao, 'observação', { max: 200, obrigatorio: false }),
  }));
  if (itens.some((i) => !Number.isInteger(i.quantidade))) throw new HttpError(400, 'Quantidade inválida.');

  let pedido;
  try {
  pedido = await db.tx(async (c) => {
    const rest = (await c.query(
      'SELECT id, ativo, aberto, taxa_entrega, pedido_minimo FROM restaurantes WHERE id = $1', [restauranteId])).rows[0];
    if (!rest || !rest.ativo) throw new HttpError(404, 'Restaurante não encontrado.');
    if (!rest.aberto) throw new HttpError(409, 'Este restaurante está fechado no momento.');

    const end = (await c.query('SELECT id FROM enderecos WHERE id = $1 AND usuario_id = $2', [enderecoId, req.user.id])).rows[0];
    if (!end) throw new HttpError(400, 'Endereço de entrega inválido.');

    let meioId = null;
    if (b.meio_pagamento_id) {
      meioId = uuid(b.meio_pagamento_id, 'meio de pagamento');
      const meio = (await c.query('SELECT tipo FROM meios_pagamento WHERE id = $1 AND usuario_id = $2', [meioId, req.user.id])).rows[0];
      if (!meio || meio.tipo !== b.tipo_pagamento) throw new HttpError(400, 'Meio de pagamento inválido.');
    }

    // Os PREÇOS vêm do banco, nunca do app.
    const ids = [...new Set(itens.map((i) => i.item_id))];
    const { rows: achados } = await c.query(
      `SELECT id, nome, preco FROM itens_cardapio
       WHERE restaurante_id = $1 AND id = ANY($2::uuid[]) AND visivel AND removido_em IS NULL`, [restauranteId, ids]);
    const porId = new Map(achados.map((r) => [r.id, r]));
    if (porId.size !== ids.length) throw new HttpError(409, 'Um ou mais itens não estão mais disponíveis. Atualize o cardápio.');

    const subCent = itens.reduce((s, i) => s + Math.round(porId.get(i.item_id).preco * 100) * i.quantidade, 0);
    const subtotal = subCent / 100;
    if (subtotal < rest.pedido_minimo) {
      throw new HttpError(409, `Pedido mínimo deste restaurante: R$ ${rest.pedido_minimo.toFixed(2).replace('.', ',')}.`);
    }
    const total = arred2(subtotal + rest.taxa_entrega);

    const p = (await c.query(
      `INSERT INTO pedidos (cliente_id, restaurante_id, endereco_entrega_id, subtotal, taxa_entrega, total, chave_idempotencia)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING ${PEDIDO_CAMPOS}`,
      [req.user.id, restauranteId, enderecoId, subtotal, rest.taxa_entrega, total, chave])).rows[0];

    for (const i of itens) {
      const ref = porId.get(i.item_id);
      await c.query(
        `INSERT INTO itens_pedido (pedido_id, item_id, nome_item, preco_unitario, quantidade, observacao)
         VALUES ($1,$2,$3,$4,$5,$6)`, [p.id, ref.id, ref.nome, ref.preco, i.quantidade, i.observacao]);
    }
    // TODO: integrar o gateway de pagamento. Por enquanto Pix/cartão ficam "APROVADO" (simulado)
    // e dinheiro fica "PENDENTE" até o entregador receber.
    await c.query(
      `INSERT INTO pagamentos (pedido_id, meio_pagamento_id, tipo, valor, status) VALUES ($1,$2,$3,$4,$5)`,
      [p.id, meioId, b.tipo_pagamento, total, b.tipo_pagamento === 'DINHEIRO' ? 'PENDENTE' : 'APROVADO']);
    return p;
  });
  } catch (e) {
    // Dois envios ao mesmo tempo com a mesma chave: o segundo cai aqui e recebe o pedido do primeiro.
    if (e.code === '23505' && e.constraint === 'uq_pedido_chave') {
      const existente = await pedidoPorChave(req.user.id, chave);
      if (existente) return res.status(200).json({ ...existente, repetido: true });
    }
    throw e;
  }
  res.status(201).json(pedido);
}));

router.get('/pedidos', wrap(async (req, res) => {
  const limite = Math.min(Math.max(parseInt(req.query.limite, 10) || 20, 1), 50);
  const pagina = Math.max(parseInt(req.query.pagina, 10) || 0, 0);
  const { rows } = await db.query(
    `SELECT p.id, p.status, p.total, p.criado_em, r.nome AS restaurante,
            (a.id IS NOT NULL) AS avaliado
     FROM pedidos p
     JOIN restaurantes r ON r.id = p.restaurante_id
     LEFT JOIN avaliacoes a ON a.pedido_id = p.id
     WHERE p.cliente_id = $1 ORDER BY p.criado_em DESC LIMIT $2 OFFSET $3`,
    [req.user.id, limite, pagina * limite]);
  res.json(rows);
}));

router.get('/pedidos/:id', wrap(async (req, res) => {
  const id = uuid(req.params.id);
  const p = (await db.query(
    `SELECT p.id, p.status, p.subtotal, p.taxa_entrega, p.desconto, p.total, p.criado_em,
            r.nome AS restaurante, e.status AS entrega_status, m.nome AS entregador,
            (a.id IS NOT NULL) AS avaliado
     FROM pedidos p
     JOIN restaurantes r ON r.id = p.restaurante_id
     LEFT JOIN entregas e ON e.pedido_id = p.id
     LEFT JOIN usuarios m ON m.id = e.motoboy_id
     LEFT JOIN avaliacoes a ON a.pedido_id = p.id
     WHERE p.id = $1 AND p.cliente_id = $2`, [id, req.user.id])).rows[0];
  if (!p) throw new HttpError(404, 'Pedido não encontrado.');
  const itens = (await db.query(
    'SELECT nome_item, preco_unitario, quantidade, observacao FROM itens_pedido WHERE pedido_id = $1', [id])).rows;
  const pagamento = (await db.query('SELECT tipo, valor, status FROM pagamentos WHERE pedido_id = $1', [id])).rows[0] || null;
  res.json({ ...p, itens, pagamento });
}));

router.post('/pedidos/:id/cancelar', wrap(async (req, res) => {
  const id = uuid(req.params.id);
  await db.tx(async (c) => {
    const p = (await c.query('SELECT status FROM pedidos WHERE id = $1 AND cliente_id = $2 FOR UPDATE', [id, req.user.id])).rows[0];
    if (!p) throw new HttpError(404, 'Pedido não encontrado.');
    if (!['CRIADO', 'CONFIRMADO'].includes(p.status)) throw new HttpError(409, 'Este pedido já está em preparo e não pode mais ser cancelado.');
    await c.query("UPDATE pedidos SET status = 'CANCELADO' WHERE id = $1", [id]);
    await c.query("UPDATE pagamentos SET status = 'ESTORNADO' WHERE pedido_id = $1 AND status = 'APROVADO'", [id]);
  });
  res.json({ ok: true, status: 'CANCELADO' });
}));

router.post('/pedidos/:id/avaliar', wrap(async (req, res) => {
  const id = uuid(req.params.id);
  const nota = numero(req.body.nota, 'nota', { min: 1, max: 5 });
  if (!Number.isInteger(nota)) throw new HttpError(400, 'A nota deve ser um número inteiro de 1 a 5.');
  const comentario = texto(req.body.comentario, 'comentário', { max: 500, obrigatorio: false });
  const p = (await db.query(
    'SELECT restaurante_id, status FROM pedidos WHERE id = $1 AND cliente_id = $2', [id, req.user.id])).rows[0];
  if (!p) throw new HttpError(404, 'Pedido não encontrado.');
  if (p.status !== 'ENTREGUE') throw new HttpError(409, 'Você só pode avaliar pedidos já entregues.');
  try {
    await db.query(
      'INSERT INTO avaliacoes (pedido_id, cliente_id, restaurante_id, nota, comentario) VALUES ($1,$2,$3,$4,$5)',
      [id, req.user.id, p.restaurante_id, nota, comentario]);
  } catch (e) {
    if (e.code === '23505') throw new HttpError(409, 'Este pedido já foi avaliado.');
    throw e;
  }
  res.status(201).json({ ok: true });
}));

module.exports = router;
