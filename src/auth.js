const jwt = require('jsonwebtoken');
const config = require('./config');
const db = require('./db');
const { HttpError, wrap } = require('./util');

const PAPEIS = ['ADMIN', 'RESTAURANTE', 'MOTOBOY', 'CLIENTE'];

function gerarToken(usuario) {
  return jwt.sign({ sub: usuario.id }, config.jwtSecret, { expiresIn: '7d' });
}

/** Confere o token e carrega o usuário DO BANCO (o perfil nunca vem do app). */
const authenticate = wrap(async (req, res, next) => {
  const [tipo, token] = (req.headers.authorization || '').split(' ');
  if (tipo !== 'Bearer' || !token) throw new HttpError(401, 'Faça login para continuar.');
  let payload;
  try {
    payload = jwt.verify(token, config.jwtSecret);
  } catch {
    throw new HttpError(401, 'Sessão expirada. Entre novamente.');
  }
  const { rows } = await db.query('SELECT id, nome, email, papel, ativo FROM usuarios WHERE id = $1', [payload.sub]);
  const u = rows[0];
  if (!u || !u.ativo) throw new HttpError(401, 'Conta inexistente ou bloqueada.');
  req.user = u;
  next();
});

/** Só deixa passar quem tem um dos perfis informados. */
const requireRole = (...papeis) => (req, res, next) =>
  papeis.includes(req.user.papel)
    ? next()
    : next(new HttpError(403, 'Você não tem permissão para acessar este recurso.'));

const usuarioPublico = (u) => ({ id: u.id, nome: u.nome, email: u.email, papel: u.papel });

module.exports = { PAPEIS, gerarToken, authenticate, requireRole, usuarioPublico };
