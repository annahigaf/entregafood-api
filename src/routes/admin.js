const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { PAPEIS } = require('../auth');
const { lerConfiguracoes } = require('../config_valores');
const { HttpError, wrap, uuid, texto, numero, dataOpcional } = require('../util');

const router = express.Router();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ------------------------------- Relatórios -------------------------------
const periodo = (q) => [dataOpcional(q.inicio, 'inicio'), dataOpcional(q.fim, 'fim')];
const DATAS = 'COALESCE($1::date, CURRENT_DATE - 30), COALESCE($2::date, CURRENT_DATE)';

router.get('/relatorio/receita', wrap(async (req, res) => {
  const { rows } = await db.query(`SELECT * FROM relatorio_receita(${DATAS})`, periodo(req.query));
  res.json({ restaurantes: rows, total: rows.reduce((s, r) => s + r.receita_bruta, 0) });
}));

router.get('/relatorio/pedidos', wrap(async (req, res) => {
  const { rows } = await db.query(`SELECT * FROM relatorio_pedidos(${DATAS})`, periodo(req.query));
  res.json(rows);
}));

router.get('/relatorio/pagamentos', wrap(async (req, res) => {
  const rid = req.query.restaurante_id ? uuid(req.query.restaurante_id, 'restaurante') : null;
  const { rows } = await db.query(`SELECT * FROM relatorio_pagamentos(${DATAS}, $3)`, [...periodo(req.query), rid]);
  res.json(rows);
}));

// -------------------------------- Usuários --------------------------------
router.get('/usuarios', wrap(async (req, res) => {
  const papel = req.query.papel;
  if (papel && !PAPEIS.includes(papel)) throw new HttpError(400, 'Perfil inválido.');
  const { rows } = await db.query(
    `SELECT id, nome, email, telefone, papel, ativo, criado_em FROM usuarios
     WHERE ($1::papel_usuario IS NULL OR papel = $1) ORDER BY criado_em DESC LIMIT 200`, [papel || null]);
  res.json(rows);
}));

router.post('/usuarios', wrap(async (req, res) => {
  const b = req.body;
  const nome = texto(b.nome, 'nome', { min: 2, max: 100 });
  const email = texto(b.email, 'e-mail', { max: 150 }).toLowerCase();
  if (!EMAIL_RE.test(email)) throw new HttpError(400, 'Digite um e-mail válido.');
  if (!PAPEIS.includes(b.papel)) throw new HttpError(400, 'Perfil inválido.');
  const senha = b.senha;
  if (typeof senha !== 'string' || senha.length < 6 || senha.length > 100) throw new HttpError(400, 'A senha deve ter de 6 a 100 caracteres.');
  const { rows } = await db.query(
    `INSERT INTO usuarios (nome, email, telefone, senha_hash, papel) VALUES ($1,$2,$3,$4,$5)
     RETURNING id, nome, email, telefone, papel, ativo`,
    [nome, email, texto(b.telefone, 'telefone', { max: 30, obrigatorio: false }), await bcrypt.hash(senha, 10), b.papel]);
  res.status(201).json(rows[0]);
}));

router.patch('/usuarios/:id', wrap(async (req, res) => {
  const id = uuid(req.params.id);
  if (typeof req.body.ativo !== 'boolean') throw new HttpError(400, 'Informe "ativo": true ou false.');
  if (id === req.user.id && req.body.ativo === false) throw new HttpError(400, 'Você não pode bloquear a sua própria conta.');
  const { rows } = await db.query(
    'UPDATE usuarios SET ativo = $2 WHERE id = $1 RETURNING id, nome, email, papel, ativo', [id, req.body.ativo]);
  if (!rows[0]) throw new HttpError(404, 'Usuário não encontrado.');
  res.json(rows[0]);
}));

// ------------------------------- Restaurantes -------------------------------
router.get('/restaurantes', wrap(async (req, res) => {
  const { rows } = await db.query(
    `SELECT r.id, r.nome, r.categoria, r.aberto, r.ativo, r.taxa_entrega, u.nome AS dono, u.email AS dono_email
     FROM restaurantes r JOIN usuarios u ON u.id = r.dono_id ORDER BY r.nome`);
  res.json(rows);
}));

router.post('/restaurantes', wrap(async (req, res) => {
  const b = req.body;
  const { rows } = await db.query(
    `INSERT INTO restaurantes (dono_id, nome, categoria, endereco, latitude, longitude, taxa_entrega, pedido_minimo)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [uuid(b.dono_id, 'dono'), texto(b.nome, 'nome', { max: 100 }), texto(b.categoria, 'categoria', { max: 50, obrigatorio: false }),
     texto(b.endereco, 'endereço', { max: 200 }),
     numero(b.latitude, 'latitude', { min: -90, max: 90, obrigatorio: false }), numero(b.longitude, 'longitude', { min: -180, max: 180, obrigatorio: false }),
     numero(b.taxa_entrega ?? 0, 'taxa de entrega', { max: 500 }), numero(b.pedido_minimo ?? 0, 'pedido mínimo', { max: 5000 })]);
  res.status(201).json(rows[0]);
}));

router.patch('/restaurantes/:id', wrap(async (req, res) => {
  if (typeof req.body.ativo !== 'boolean') throw new HttpError(400, 'Informe "ativo": true ou false.');
  const { rows } = await db.query('UPDATE restaurantes SET ativo = $2 WHERE id = $1 RETURNING id, nome, ativo', [uuid(req.params.id), req.body.ativo]);
  if (!rows[0]) throw new HttpError(404, 'Restaurante não encontrado.');
  res.json(rows[0]);
}));

// ------------------------------ Configurações ------------------------------
router.get('/configuracoes', wrap(async (req, res) => res.json(await lerConfiguracoes())));

router.put('/configuracoes', wrap(async (req, res) => {
  const b = req.body;
  const novos = {};
  if (b.valor_base_corrida !== undefined) novos.valor_base_corrida = numero(b.valor_base_corrida, 'valor base', { max: 1000 });
  if (b.valor_por_km !== undefined) novos.valor_por_km = numero(b.valor_por_km, 'valor por km', { max: 100 });
  if (b.comissao_plataforma !== undefined) novos.comissao_plataforma = numero(b.comissao_plataforma, 'comissão', { max: 100 });
  if (!Object.keys(novos).length) throw new HttpError(400, 'Nada para alterar.');
  await db.tx(async (c) => {
    for (const [chave, valor] of Object.entries(novos)) {
      await c.query(
        `INSERT INTO configuracoes (chave, valor, atualizado_por) VALUES ($1,$2,$3)
         ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor, atualizado_por = EXCLUDED.atualizado_por, atualizado_em = now()`,
        [chave, String(valor), req.user.id]);
    }
  });
  res.json(await lerConfiguracoes());
}));

module.exports = router;
