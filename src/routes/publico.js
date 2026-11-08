// Rotas que qualquer usuário logado pode ver (lista de restaurantes e cardápio).
const express = require('express');
const db = require('../db');
const { HttpError, wrap, uuid } = require('../util');

const router = express.Router();

router.get('/', wrap(async (req, res) => {
  const { rows } = await db.query(
    `SELECT r.id, r.nome, COALESCE(r.categoria, 'Outros') AS categoria, r.foto_capa_url,
            r.taxa_entrega, r.pedido_minimo, r.aberto, r.tempo_min, r.tempo_max,
            COALESCE(ROUND(AVG(a.nota), 1), 0) AS nota, COUNT(a.id) AS qtd_avaliacoes
     FROM restaurantes r
     LEFT JOIN avaliacoes a ON a.restaurante_id = r.id
     WHERE r.ativo
     GROUP BY r.id
     ORDER BY r.aberto DESC, r.nome`);
  res.json(rows);
}));

router.get('/:id/cardapio', wrap(async (req, res) => {
  const id = uuid(req.params.id);
  const rest = (await db.query(
    `SELECT id, nome, categoria, foto_capa_url, taxa_entrega, pedido_minimo, aberto, tempo_min, tempo_max
     FROM restaurantes WHERE id = $1 AND ativo`, [id])).rows[0];
  if (!rest) throw new HttpError(404, 'Restaurante não encontrado.');
  const itens = (await db.query(
    `SELECT id, nome, descricao, preco, foto_url FROM itens_cardapio
     WHERE restaurante_id = $1 AND visivel AND removido_em IS NULL ORDER BY nome`, [id])).rows;
  res.json({ restaurante: rest, itens });
}));

module.exports = router;
