const db = require('./db');

/**
 * Atualiza um banco criado por uma versão antiga (idempotente: pode rodar sempre).
 * Roda sozinho quando a API liga. Se o banco ainda está vazio, não faz nada (use "npm run db:init").
 */
async function aplicarMigracoes() {
  const { rows } = await db.query("SELECT to_regclass('public.pedidos') AS t");
  if (!rows[0].t) {
    console.log('Aviso: o banco ainda não tem tabelas. Rode "npm run db:init".');
    return;
  }
  await db.query('ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS chave_idempotencia text');
  await db.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS uq_pedido_chave ON pedidos (cliente_id, chave_idempotencia)
     WHERE chave_idempotencia IS NOT NULL`);
}

module.exports = { aplicarMigracoes };
