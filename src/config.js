require('dotenv').config();

const faltando = ['DATABASE_URL', 'JWT_SECRET'].filter((k) => !process.env[k]);
if (faltando.length) {
  console.error('Faltam variáveis no arquivo .env: ' + faltando.join(', '));
  process.exit(1);
}
if (process.env.JWT_SECRET.length < 16) {
  console.error('JWT_SECRET muito curto: use pelo menos 16 caracteres (ideal 40+).');
  process.exit(1);
}

module.exports = {
  port: Number(process.env.PORT) || 3000,
  jwtSecret: process.env.JWT_SECRET,
  uploadDir: require('path').join(__dirname, '..', 'uploads'),
};
