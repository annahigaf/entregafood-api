// Cria as tabelas e os dados de exemplo.
//   npm run db:init     -> cria (se o banco estiver vazio)
//   npm run db:reset    -> APAGA TUDO e recria (só para desenvolvimento!)
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { Client } = require('pg');

const forcar = process.argv.includes('--force');
const semDados = process.argv.includes('--sem-dados');

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('Falta DATABASE_URL no arquivo .env');
  const db = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
  });
  await db.connect();
  try {
    const existe = (await db.query("SELECT to_regclass('public.usuarios') AS t")).rows[0].t;
    if (existe && !forcar) {
      console.log('O banco já tem tabelas. Nada foi alterado. (Para recriar tudo: npm run db:reset)');
      return;
    }
    if (existe && forcar) {
      console.log('Apagando tudo e recriando...');
      await db.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    }
    await db.query(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
    console.log('Tabelas criadas.');
    if (!semDados) {
      await semear(db);
      console.log('Dados de exemplo criados. Todas as contas usam a senha 123456.');
    }
  } finally {
    await db.end();
  }
}

async function semear(db) {
  const hash = await bcrypt.hash('123456', 10);
  const usuario = async (nome, email, papel) =>
    (await db.query(
      'INSERT INTO usuarios (nome, email, senha_hash, papel) VALUES ($1,$2,$3,$4) RETURNING id', [nome, email, hash, papel])).rows[0].id;

  await usuario('Anna', 'admin@entregafood.com', 'ADMIN');
  const clienteId = await usuario('Cliente', 'cliente@entregafood.com', 'CLIENTE');
  await usuario('Carlos', 'motoboy@entregafood.com', 'MOTOBOY');
  await usuario('Rafael', 'motoboy2@entregafood.com', 'MOTOBOY');

  const restaurantes = [
    // nome, e-mail do dono, categoria, endereço, lat, lng, taxa, mín, tempo, aberto, itens [nome, preço, visível]
    ['Burger do Zé', 'restaurante@entregafood.com', 'Lanches', 'Av. Paulista, 1000', -23.5649, -46.6527, 5.9, 20, [25, 35], true,
      [['Burger duplo', 28.9, true], ['Batata frita', 14, true], ['Refrigerante', 6.5, true], ['Milkshake', 16, false]]],
    ['Forno a Lenha Napoli', 'napoli@entregafood.com', 'Pizza', 'Rua Oscar Freire, 300', -23.5617, -46.6697, 0, 30, [35, 50], true,
      [['Pizza Margherita', 49.9, true], ['Pizza Calabresa', 54.9, true], ['Refrigerante 2L', 12, true]]],
    ['Sushi Kaze', 'kaze@entregafood.com', 'Japonesa', 'Rua da Liberdade, 200', -23.5584, -46.6355, 7.5, 40, [40, 55], true,
      [['Combo 20 peças', 79.9, true], ['Temaki de salmão', 28, true], ['Missoshiru', 12, true]]],
    ['Marmitaria da Vó', 'marmitaria@entregafood.com', 'Brasileira', 'Rua Augusta, 500', -23.553, -46.658, 4, 15, [20, 30], true,
      [['Marmita tradicional', 24.9, true], ['Marmita fit', 27.9, true], ['Suco natural', 8, true]]],
    ['Doce Encanto', 'doce@entregafood.com', 'Doces', 'Rua Haddock Lobo, 400', -23.5575, -46.663, 6, 0, [30, 40], false,
      [['Brigadeiro gourmet (6 un.)', 29.9, true], ['Bolo no pote', 14.9, true]]],
    ['Verde Bowl', 'verde@entregafood.com', 'Saudável', 'Alameda Santos, 700', -23.57, -46.651, 3.5, 0, [25, 35], true,
      [['Bowl proteico', 32.9, true], ['Salada Caesar', 26.9, true], ['Suco verde', 11.9, true]]],
  ];
  for (const [nome, email, cat, end, lat, lng, taxa, min, [t1, t2], aberto, itens] of restaurantes) {
    const donoId = await usuario(nome, email, 'RESTAURANTE');
    const rid = (await db.query(
      `INSERT INTO restaurantes (dono_id, nome, categoria, endereco, latitude, longitude, taxa_entrega, pedido_minimo, tempo_min, tempo_max, aberto)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
      [donoId, nome, cat, end, lat, lng, taxa, min, t1, t2, aberto])).rows[0].id;
    for (const [n, preco, visivel] of itens) {
      await db.query('INSERT INTO itens_cardapio (restaurante_id, nome, preco, visivel) VALUES ($1,$2,$3,$4)', [rid, n, preco, visivel]);
    }
  }

  const endId = (await db.query(
    `INSERT INTO enderecos (usuario_id, apelido, logradouro, numero, bairro, cidade, uf, cep, latitude, longitude, principal)
     VALUES ($1,'Casa','Rua Augusta','1500','Consolação','São Paulo','SP','01304-001',-23.5539,-46.6588,true) RETURNING id`, [clienteId])).rows[0].id;
  await db.query("INSERT INTO meios_pagamento (usuario_id, tipo, principal) VALUES ($1,'PIX',true)", [clienteId]);

  // Histórico fictício (últimos 25 dias) para os relatórios não ficarem vazios.
  await db.query(
    `WITH novos AS (
       INSERT INTO pedidos (cliente_id, restaurante_id, endereco_entrega_id, status, subtotal, taxa_entrega, total, criado_em)
       SELECT $1, r.id, $2, 'ENTREGUE', s.v, r.taxa_entrega, s.v + r.taxa_entrega, now() - ((random() * 25) || ' days')::interval
       FROM restaurantes r
       CROSS JOIN LATERAL (SELECT round((30 + random() * 90)::numeric, 2) AS v
                           FROM generate_series(1, 20 + (abs(hashtext(r.nome)) % 40))) s
       RETURNING id, total
     )
     INSERT INTO pagamentos (pedido_id, tipo, valor, status)
     SELECT id, (ARRAY['PIX','PIX','CARTAO_CREDITO','CARTAO_CREDITO','CARTAO_DEBITO','DINHEIRO'])[1 + floor(random() * 6)::int]::tipo_pagamento,
            total, 'APROVADO' FROM novos`, [clienteId, endId]);
  await db.query(
    `INSERT INTO avaliacoes (pedido_id, cliente_id, restaurante_id, nota)
     SELECT id, cliente_id, restaurante_id, 3 + floor(random() * 3)::int FROM pedidos WHERE status = 'ENTREGUE' AND random() < 0.3`);
}

main().catch((e) => { console.error('Erro:', e.message); process.exit(1); });
