const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { gerarToken, usuarioPublico } = require('../auth');
const { HttpError, wrap, texto } = require('../util');

const router = express.Router();

// Limite simples de tentativas de login (em memória): 8 erros / 15 min por IP+e-mail.
const falhas = new Map();
const JANELA_MS = 15 * 60 * 1000;
function bloqueado(chave) {
  const f = falhas.get(chave);
  if (!f) return false;
  if (Date.now() - f.desde > JANELA_MS) { falhas.delete(chave); return false; }
  return f.n >= 8;
}
function registrarFalha(chave) {
  const f = falhas.get(chave);
  if (!f || Date.now() - f.desde > JANELA_MS) falhas.set(chave, { n: 1, desde: Date.now() });
  else f.n += 1;
}

const HASH_FALSO = bcrypt.hashSync('senha-falsa-para-igualar-tempo', 10);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

router.post('/login', wrap(async (req, res) => {
  const email = texto(req.body.email, 'e-mail', { max: 150 }).toLowerCase();
  const senha = typeof req.body.password === 'string' ? req.body.password : req.body.senha;
  if (typeof senha !== 'string' || !senha) throw new HttpError(400, 'Informe a senha.');

  const chave = `${req.ip}|${email}`;
  if (bloqueado(chave)) throw new HttpError(429, 'Muitas tentativas. Aguarde alguns minutos.');

  const { rows } = await db.query(
    'SELECT id, nome, email, papel, ativo, senha_hash FROM usuarios WHERE lower(email) = $1', [email]);
  const u = rows[0];
  const ok = await bcrypt.compare(senha, u ? u.senha_hash : HASH_FALSO); // mesmo tempo com ou sem usuário
  if (!u || !ok || !u.ativo) {
    registrarFalha(chave);
    throw new HttpError(401, 'E-mail ou senha incorretos.');
  }
  falhas.delete(chave);
  res.json({ token: gerarToken(u), usuario: usuarioPublico(u) });
}));

// Cadastro público: SEMPRE cria um CLIENTE. Restaurantes/entregadores/admins são criados pelo ADMIN.
router.post('/cadastro', wrap(async (req, res) => {
  const nome = texto(req.body.nome, 'nome', { min: 2, max: 100 });
  const email = texto(req.body.email, 'e-mail', { max: 150 }).toLowerCase();
  const telefone = texto(req.body.telefone, 'telefone', { max: 30, obrigatorio: false });
  const senha = req.body.senha ?? req.body.password;
  if (!EMAIL_RE.test(email)) throw new HttpError(400, 'Digite um e-mail válido.');
  if (typeof senha !== 'string' || senha.length < 6 || senha.length > 100) {
    throw new HttpError(400, 'A senha deve ter de 6 a 100 caracteres.');
  }
  const hash = await bcrypt.hash(senha, 10);
  const { rows } = await db.query(
    `INSERT INTO usuarios (nome, email, telefone, senha_hash, papel)
     VALUES ($1, $2, $3, $4, 'CLIENTE') RETURNING id, nome, email, papel`,
    [nome, email, telefone, hash]);
  res.status(201).json({ token: gerarToken(rows[0]), usuario: usuarioPublico(rows[0]) });
}));

module.exports = router;
