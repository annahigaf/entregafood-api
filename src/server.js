const config = require('./config');
const app = require('./app');
const { aplicarMigracoes } = require('./migrate');

aplicarMigracoes()
  .then(() => {
    app.listen(config.port, '0.0.0.0', () => {
      console.log(`API Entrega Food rodando em http://localhost:${config.port}`);
    });
  })
  .catch((e) => {
    console.error('Não foi possível conectar ao banco de dados: ' + e.message);
    console.error('Confira o DATABASE_URL (e DATABASE_SSL=true se for Neon/Supabase) no arquivo .env.');
    process.exit(1);
  });
