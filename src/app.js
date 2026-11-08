const express = require('express');
const helmet = require('helmet');
const config = require('./config');
const { authenticate, requireRole } = require('./auth');
const { HttpError } = require('./util');

const app = express();
app.disable('x-powered-by');
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(express.json({ limit: '8mb' }));

// O app Android (HttpURLConnection) não envia PATCH direto: aceita POST + "X-HTTP-Method-Override: PATCH".
app.use((req, res, next) => {
  if (req.method === 'POST' && req.headers['x-http-method-override'] === 'PATCH') req.method = 'PATCH';
  next();
});

app.get('/saude', (req, res) => res.json({ ok: true }));
app.use('/uploads', express.static(config.uploadDir)); // fotos de capa

app.use('/auth', require('./routes/auth'));
const publico = require('./routes/publico');
app.use('/restaurantes', authenticate, publico);                  // qualquer perfil logado
app.use('/consultas/restaurantes', authenticate, publico);        // mesmo recurso, nome alternativo
app.use('/cliente', authenticate, requireRole('CLIENTE'), require('./routes/cliente'));
app.use('/restaurante', authenticate, requireRole('RESTAURANTE'), require('./routes/restaurante'));
app.use('/motoboy', authenticate, requireRole('MOTOBOY'), require('./routes/motoboy'));
app.use('/admin', authenticate, requireRole('ADMIN'), require('./routes/admin'));

app.use((req, res, next) => next(new HttpError(404, 'Rota não encontrada.')));

// Tratador central de erros: sempre responde { erro: "mensagem" }.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err instanceof HttpError) return res.status(err.status).json({ erro: err.message });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ erro: 'JSON inválido.' });
  if (err.type === 'entity.too.large') return res.status(413).json({ erro: 'Arquivo grande demais.' });
  switch (err.code) {
    case '23505':
      if (err.constraint === 'usuarios_email_key') return res.status(409).json({ erro: 'Este e-mail já está cadastrado.' });
      if (err.constraint === 'uq_motoboy_corrida_ativa') return res.status(409).json({ erro: 'Você já tem uma corrida em andamento.' });
      return res.status(409).json({ erro: 'Este registro já existe.' });
    case '23503': return res.status(409).json({ erro: 'Este registro está em uso e não pode ser alterado/removido.' });
    case '22P02': case '22007': case '22008': case '23514': return res.status(400).json({ erro: 'Valor inválido.' });
    case 'P0001': return res.status(400).json({ erro: err.message }); // regras de perfil criadas no banco
    default:
  }
  console.error(err);
  res.status(500).json({ erro: 'Erro interno do servidor.' });
});

module.exports = app;
