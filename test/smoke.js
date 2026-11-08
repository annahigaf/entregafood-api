// Teste de ponta a ponta. Com a API rodando e o banco com dados de exemplo:  npm run smoke
const BASE = process.env.API_URL || 'http://localhost:3000';
let ok = 0, falhou = 0;

async function api(metodo, caminho, token, corpo) {
  const r = await fetch(BASE + caminho, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  const texto = await r.text();
  let dados; try { dados = JSON.parse(texto); } catch { dados = texto; }
  return { status: r.status, dados };
}
function checa(nome, cond, extra = '') {
  if (cond) { ok++; console.log('  ok  ' + nome); } else { falhou++; console.log('  ERRO ' + nome + ' ' + extra); }
}
async function login(email, senha = '123456') {
  const r = await api('POST', '/auth/login', null, { email, password: senha });
  return r.status === 200 ? r.dados.token : null;
}

(async () => {
  console.log('Login e perfis');
  const admin = await login('admin@entregafood.com');
  const cliente = await login('cliente@entregafood.com');
  const rest = await login('restaurante@entregafood.com');
  const moto = await login('motoboy@entregafood.com');
  const moto2 = await login('motoboy2@entregafood.com');
  checa('4 perfis conseguem entrar', admin && cliente && rest && moto && moto2);
  checa('senha errada -> 401', (await api('POST', '/auth/login', null, { email: 'admin@entregafood.com', password: 'x' })).status === 401);
  const lg = await api('POST', '/auth/login', null, { email: 'cliente@entregafood.com', password: '123456' });
  checa('login devolve o perfil do servidor', lg.dados.usuario.papel === 'CLIENTE');
  checa('sem token -> 401', (await api('GET', '/restaurantes')).status === 401);
  checa('token falso -> 401', (await api('GET', '/restaurantes', 'abc.def.ghi')).status === 401);
  checa('cliente em rota de admin -> 403', (await api('GET', '/admin/usuarios', cliente)).status === 403);
  checa('restaurante em rota de cliente -> 403', (await api('GET', '/cliente/enderecos', rest)).status === 403);
  checa('motoboy em rota de restaurante -> 403', (await api('GET', '/restaurante/pedidos', moto)).status === 403);
  checa('cliente em rota de motoboy -> 403', (await api('GET', '/motoboy/corridas', cliente)).status === 403);

  console.log('Cliente: restaurantes, cardápio, endereço e pagamento');
  const lista = await api('GET', '/restaurantes', cliente);
  checa('lista 6 restaurantes', lista.dados.length === 6);
  const burger = lista.dados.find((r) => r.nome === 'Burger do Zé');
  checa('nota média calculada', burger && burger.nota >= 3);
  const card = await api('GET', `/restaurantes/${burger.id}/cardapio`, cliente);
  checa('cardápio esconde itens ocultos (3 de 4)', card.dados.itens.length === 3 && !card.dados.itens.some((i) => i.nome === 'Milkshake'));
  const duplo = card.dados.itens.find((i) => i.nome === 'Burger duplo');
  const batata = card.dados.itens.find((i) => i.nome === 'Batata frita');
  const ends = await api('GET', '/cliente/enderecos', cliente);
  const end = ends.dados[0];
  const novoEnd = await api('POST', '/cliente/enderecos', cliente, { apelido: 'Trabalho', logradouro: 'Av. Faria Lima, 100', cidade: 'São Paulo', uf: 'SP', latitude: -23.5, longitude: -46.7 });
  checa('adiciona endereço', novoEnd.status === 201);
  checa('rejeita cartão completo', (await api('POST', '/cliente/meios-pagamento', cliente, { tipo: 'CARTAO_CREDITO', bandeira: 'Visa', ultimos4: '1234', numero: '4111111111111111' })).status === 400);
  const cartao = await api('POST', '/cliente/meios-pagamento', cliente, { tipo: 'CARTAO_CREDITO', bandeira: 'Visa', ultimos4: '1234' });
  checa('adiciona cartão (bandeira + 4 dígitos)', cartao.status === 201);

  console.log('Pedido');
  const ped = await api('POST', '/cliente/pedidos', cliente, {
    restaurante_id: burger.id, endereco_id: end.id, tipo_pagamento: 'PIX', chave: 'teste-chave-0001',
    itens: [{ item_id: duplo.id, quantidade: 2 }, { item_id: batata.id, quantidade: 1 }],
  });
  checa('cria pedido', ped.status === 201, JSON.stringify(ped.dados));
  const repetido = await api('POST', '/cliente/pedidos', cliente, {
    restaurante_id: burger.id, endereco_id: end.id, tipo_pagamento: 'PIX', chave: 'teste-chave-0001',
    itens: [{ item_id: duplo.id, quantidade: 2 }, { item_id: batata.id, quantidade: 1 }],
  });
  checa('mesmo envio repetido devolve o MESMO pedido (sem duplicar)', repetido.status === 200 && repetido.dados.id === ped.dados.id && repetido.dados.repetido === true, JSON.stringify(repetido.dados));
  const paralelo = await Promise.all([1, 2].map(() => api('POST', '/cliente/pedidos', cliente, {
    restaurante_id: burger.id, endereco_id: end.id, tipo_pagamento: 'PIX', chave: 'teste-chave-0001',
    itens: [{ item_id: duplo.id, quantidade: 2 }, { item_id: batata.id, quantidade: 1 }],
  })));
  checa('dois envios simultâneos também não duplicam', paralelo.every((r) => r.dados.id === ped.dados.id));
  checa('chave curta demais -> 400', (await api('POST', '/cliente/pedidos', cliente, { restaurante_id: burger.id, endereco_id: end.id, tipo_pagamento: 'PIX', chave: 'x', itens: [{ item_id: duplo.id, quantidade: 1 }] })).status === 400);
  checa('total calculado no servidor (2x28,90 + 14 + 5,90 = 77,70)', ped.dados.total === 77.7, String(ped.dados.total));
  const lista2 = await api('GET', '/restaurantes', cliente);
  const milk = (await api('GET', '/restaurante/cardapio', rest)).dados.find((i) => i.nome === 'Milkshake');
  checa('pedido com item oculto -> 409', (await api('POST', '/cliente/pedidos', cliente, { restaurante_id: burger.id, endereco_id: end.id, tipo_pagamento: 'PIX', itens: [{ item_id: milk.id, quantidade: 1 }] })).status === 409);
  checa('pedido com endereço de outra pessoa -> 400', (await api('POST', '/cliente/pedidos', cliente, { restaurante_id: burger.id, endereco_id: '00000000-0000-0000-0000-000000000000', tipo_pagamento: 'PIX', itens: [{ item_id: duplo.id, quantidade: 1 }] })).status === 400);
  const doce = lista2.dados.find((r) => r.nome === 'Doce Encanto');
  const cardDoce = await api('GET', `/restaurantes/${doce.id}/cardapio`, cliente);
  checa('restaurante fechado -> 409', (await api('POST', '/cliente/pedidos', cliente, { restaurante_id: doce.id, endereco_id: end.id, tipo_pagamento: 'PIX', itens: [{ item_id: cardDoce.dados.itens[0].id, quantidade: 1 }] })).status === 409);
  checa('endereço usado em pedido não é apagado -> 409', (await api('DELETE', `/cliente/enderecos/${end.id}`, cliente)).status === 409);

  console.log('Restaurante: pedido -> pronto');
  const abertos = await api('GET', '/restaurante/pedidos', rest);
  checa('restaurante vê o pedido novo', abertos.dados.some((p) => p.id === ped.dados.id && p.itens.includes('2x Burger duplo')));
  checa('PRONTO direto de CRIADO -> 409', (await api('PATCH', `/restaurante/pedidos/${ped.dados.id}/status`, rest, { status: 'PRONTO' })).status === 409);
  checa('CRIADO -> EM_PREPARO', (await api('PATCH', `/restaurante/pedidos/${ped.dados.id}/status`, rest, { status: 'EM_PREPARO' })).status === 200);
  checa('EM_PREPARO -> PRONTO', (await api('PATCH', `/restaurante/pedidos/${ped.dados.id}/status`, rest, { status: 'PRONTO' })).status === 200);
  checa('outro restaurante não mexe no pedido', (await api('PATCH', `/restaurante/pedidos/${ped.dados.id}/status`, await login('napoli@entregafood.com'), { status: 'CANCELADO' })).status === 404);
  checa('cliente não cancela pedido em preparo -> 409', (await api('POST', `/cliente/pedidos/${ped.dados.id}/cancelar`, cliente)).status === 409);

  console.log('Motoboy: corrida');
  const pos = { lat: -23.5614, lng: -46.6559 };
  const corridas = await api('GET', `/motoboy/corridas?lat=${pos.lat}&lng=${pos.lng}`, moto);
  const minha = corridas.dados.find((c) => c.restaurante === 'Burger do Zé');
  checa('corrida aparece como disponível', !!minha);
  checa('lista não revela endereço exato do cliente', minha && minha.logradouro === undefined && minha.bairro === 'Consolação');
  const cfg = (await api('GET', '/admin/configuracoes', admin)).dados;
  const esperado = Math.round((cfg.valor_base_corrida + (minha.dist_coleta_km + minha.dist_entrega_km) * cfg.valor_por_km) * 100) / 100;
  checa('valor = base + km total x valor por km', Math.abs(minha.valor_motoboy - esperado) < 0.01, `${minha.valor_motoboy} vs ${esperado}`);
  const aceite1 = await api('POST', `/motoboy/corridas/${minha.id}/aceitar`, moto, pos);
  const aceite2 = await api('POST', `/motoboy/corridas/${minha.id}/aceitar`, moto2, pos);
  checa('1º motoboy aceita', aceite1.status === 200);
  checa('2º motoboy não consegue a mesma corrida -> 409', aceite2.status === 409);
  const ativa = await api('GET', '/motoboy/minha-corrida', moto);
  checa('vê endereço completo depois de aceitar', ativa.dados.corrida && ativa.dados.corrida.logradouro === 'Rua Augusta');
  checa('concluir sem coletar -> 409', (await api('POST', `/motoboy/corridas/${minha.id}/concluir`, moto)).status === 409);
  checa('coleta', (await api('POST', `/motoboy/corridas/${minha.id}/coletar`, moto)).status === 200);
  checa('outro motoboy não conclui corrida alheia -> 409', (await api('POST', `/motoboy/corridas/${minha.id}/concluir`, moto2)).status === 409);
  checa('conclui', (await api('POST', `/motoboy/corridas/${minha.id}/concluir`, moto)).status === 200);
  const ganhos = await api('GET', '/motoboy/ganhos', moto);
  checa('ganhos de hoje somam a corrida', ganhos.dados.corridas === 1 && Math.abs(ganhos.dados.total - minha.valor_motoboy) < 0.01);

  console.log('Pós-entrega: avaliação');
  const det = await api('GET', `/cliente/pedidos/${ped.dados.id}`, cliente);
  checa('pedido ENTREGUE', det.dados.status === 'ENTREGUE' && det.dados.entregador === 'Carlos');
  checa('pedido ainda não avaliado', det.dados.avaliado === false);
  checa('avalia pedido entregue', (await api('POST', `/cliente/pedidos/${ped.dados.id}/avaliar`, cliente, { nota: 5, comentario: 'Ótimo' })).status === 201);
  checa('não avalia duas vezes -> 409', (await api('POST', `/cliente/pedidos/${ped.dados.id}/avaliar`, cliente, { nota: 4 })).status === 409);

  checa('pedido passa a constar como avaliado', (await api('GET', `/cliente/pedidos/${ped.dados.id}`, cliente)).dados.avaliado === true);
  checa('alias /consultas/restaurantes', (await api('GET', '/consultas/restaurantes', cliente)).dados.length === 6);
  const viaPost = await fetch(BASE + '/restaurante/meu', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-HTTP-Method-Override': 'PATCH', Authorization: `Bearer ${rest}` }, body: JSON.stringify({ taxa_entrega: 5.9 }) });
  checa('PATCH via POST + override (app Android)', viaPost.status === 200);

  console.log('Posição absurda do entregador');
  const p3 = await api('POST', '/cliente/pedidos', cliente, { restaurante_id: burger.id, endereco_id: end.id, tipo_pagamento: 'PIX', itens: [{ item_id: duplo.id, quantidade: 2 }] });
  await api('PATCH', `/restaurante/pedidos/${p3.dados.id}/status`, rest, { status: 'EM_PREPARO' });
  await api('PATCH', `/restaurante/pedidos/${p3.dados.id}/status`, rest, { status: 'PRONTO' });
  const longe = (await api('GET', '/motoboy/corridas?lat=37.42&lng=-122.08', moto2)).dados.find((c) => c.restaurante === 'Burger do Zé');
  checa('posição a milhares de km -> coleta ignorada (null)', longe && longe.dist_coleta_km === null);
  checa('valor fica só base + entrega', longe && Math.abs(longe.valor_motoboy - (cfg.valor_base_corrida + longe.dist_entrega_km * cfg.valor_por_km)) < 0.01);
  await api('POST', `/motoboy/corridas/${longe.id}/aceitar`, moto2, { lat: 37.42, lng: -122.08 });
  await api('POST', `/motoboy/corridas/${longe.id}/coletar`, moto2);
  await api('POST', `/motoboy/corridas/${longe.id}/concluir`, moto2);

  console.log('Cancelamento');
  const abaixo = await api('POST', '/cliente/pedidos', cliente, { restaurante_id: burger.id, endereco_id: end.id, tipo_pagamento: 'DINHEIRO', itens: [{ item_id: batata.id, quantidade: 1 }] });
  checa('pedido abaixo do mínimo (R$ 20) -> 409', abaixo.status === 409);
  const p2 = await api('POST', '/cliente/pedidos', cliente, { restaurante_id: burger.id, endereco_id: end.id, tipo_pagamento: 'DINHEIRO', itens: [{ item_id: batata.id, quantidade: 2 }] });
  checa('cliente cancela pedido novo', (await api('POST', `/cliente/pedidos/${p2.dados.id}/cancelar`, cliente)).status === 200);

  console.log('Restaurante: cardápio, capa e relatório');
  const novo = await api('POST', '/restaurante/cardapio', rest, { nome: 'Combo teste', preco: 39.9 });
  checa('adiciona item', novo.status === 201);
  checa('edita preço', (await api('PATCH', `/restaurante/cardapio/${novo.dados.id}`, rest, { preco: 42.5 })).dados.preco === 42.5);
  checa('preço negativo -> 400', (await api('PATCH', `/restaurante/cardapio/${novo.dados.id}`, rest, { preco: -1 })).status === 400);
  await api('PATCH', `/restaurante/cardapio/${novo.dados.id}`, rest, { visivel: false });
  let c2 = await api('GET', `/restaurantes/${burger.id}/cardapio`, cliente);
  checa('item ocultado some para o cliente', !c2.dados.itens.some((i) => i.id === novo.dados.id));
  checa('remove item', (await api('DELETE', `/restaurante/cardapio/${novo.dados.id}`, rest)).status === 204);
  checa('restaurante não edita item de outro -> 404', (await api('PATCH', `/restaurante/cardapio/${duplo.id}`, await login('napoli@entregafood.com'), { preco: 1 })).status === 404);
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const capa = await api('PUT', '/restaurante/capa', rest, { imagem_base64: png });
  checa('envia foto de capa', capa.status === 200 && capa.dados.foto_capa_url.startsWith('/uploads/'));
  checa('foto fica acessível', (await fetch(BASE + capa.dados.foto_capa_url)).status === 200);
  checa('arquivo que não é imagem -> 400', (await api('PUT', '/restaurante/capa', rest, { imagem_base64: Buffer.from('<script>x</script>').toString('base64') })).status === 400);
  const rel = await api('GET', '/restaurante/relatorio', rest);
  checa('relatório do restaurante', rel.dados.resumo.qtd_pedidos > 0 && rel.dados.pagamentos.length > 0 && rel.dados.mais_vendidos.length > 0);
  checa('relatório traz a comissão (Financeiro)', typeof rel.dados.comissao_percentual === 'number');
  checa('data inválida -> 400', (await api('GET', '/restaurante/relatorio?inicio=ontem', rest)).status === 400);

  console.log('Admin: relatórios, usuários e ajustes');
  const rec = await api('GET', '/admin/relatorio/receita', admin);
  const somaPct = rec.dados.restaurantes.reduce((s, r) => s + r.percentual, 0);
  checa('receita por restaurante: % soma ~100', rec.dados.restaurantes.length === 6 && Math.abs(somaPct - 100) < 0.6, String(somaPct));
  checa('pedidos por restaurante (ordenado)', (await api('GET', '/admin/relatorio/pedidos', admin)).dados.length === 6);
  checa('pagamentos (rosca)', (await api('GET', '/admin/relatorio/pagamentos', admin)).dados.length >= 3);
  const novoU = await api('POST', '/admin/usuarios', admin, { nome: 'Teste', email: 'teste@x.com', senha: 'abcdef', papel: 'MOTOBOY' });
  checa('admin cria usuário', novoU.status === 201);
  checa('e-mail repetido -> 409', (await api('POST', '/admin/usuarios', admin, { nome: 'Teste', email: 'teste@x.com', senha: 'abcdef', papel: 'MOTOBOY' })).status === 409);
  checa('novo usuário entra', !!(await login('teste@x.com', 'abcdef')));
  await api('PATCH', `/admin/usuarios/${novoU.dados.id}`, admin, { ativo: false });
  checa('usuário bloqueado não entra', !(await login('teste@x.com', 'abcdef')));
  const eu = (await api('GET', '/admin/usuarios?papel=ADMIN', admin)).dados[0];
  checa('admin não bloqueia a si mesmo -> 400', (await api('PATCH', `/admin/usuarios/${eu.id}`, admin, { ativo: false })).status === 400);
  const donoRuim = await api('POST', '/admin/restaurantes', admin, { dono_id: eu.id, nome: 'X', endereco: 'Y' });
  checa('restaurante com dono que não é RESTAURANTE -> 400 (regra do banco)', donoRuim.status === 400);
  const cfg2 = await api('PUT', '/admin/configuracoes', admin, { valor_por_km: 2 });
  checa('admin altera valor por km', cfg2.dados.valor_por_km === 2);
  checa('cliente não altera ajustes -> 403', (await api('PUT', '/admin/configuracoes', cliente, { valor_por_km: 0 })).status === 403);
  await api('PUT', '/admin/configuracoes', admin, { valor_por_km: cfg.valor_por_km });

  console.log('Foto dos produtos');
  const PNG1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const fotoOk = await api('PUT', `/restaurante/cardapio/${duplo.id}/foto`, rest, { imagem_base64: PNG1 });
  checa('restaurante envia foto do produto', fotoOk.status === 200 && /^\/uploads\/item-/.test(fotoOk.dados.foto_url), JSON.stringify(fotoOk.dados));
  const cardFoto = await api('GET', `/restaurantes/${burger.id}/cardapio`, cliente);
  checa('cliente vê foto no cardápio', cardFoto.dados.itens.find((i) => i.id === duplo.id).foto_url === fotoOk.dados.foto_url);
  const arq = await fetch(`${BASE}${fotoOk.dados.foto_url}`);
  checa('arquivo da foto é servido', arq.status === 200);
  checa('foto que não é imagem -> 400', (await api('PUT', `/restaurante/cardapio/${duplo.id}/foto`, rest, { imagem_base64: Buffer.from('texto qualquer').toString('base64') })).status === 400);
  checa('foto sem imagem -> 400', (await api('PUT', `/restaurante/cardapio/${duplo.id}/foto`, rest, {})).status === 400);
  checa('outro restaurante não mexe na foto -> 404', (await api('PUT', `/restaurante/cardapio/${duplo.id}/foto`, await login('napoli@entregafood.com'), { imagem_base64: PNG1 })).status === 404);
  checa('cliente não envia foto -> 403', (await api('PUT', `/restaurante/cardapio/${duplo.id}/foto`, cliente, { imagem_base64: PNG1 })).status === 403);
  checa('remove foto do produto', (await api('DELETE', `/restaurante/cardapio/${duplo.id}/foto`, rest)).status === 204);
  checa('cardápio volta sem foto', (await api('GET', `/restaurantes/${burger.id}/cardapio`, cliente)).dados.itens.find((i) => i.id === duplo.id).foto_url == null);

  console.log('Cadastro público');
  const cad = await api('POST', '/auth/cadastro', null, { nome: 'Nova Pessoa', email: 'nova@x.com', senha: '123456', papel: 'ADMIN' });
  checa('cadastro público cria CLIENTE (ignora papel enviado)', cad.status === 201 && cad.dados.usuario.papel === 'CLIENTE');

  console.log(`\n${ok} testes ok, ${falhou} com erro`);
  process.exit(falhou ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
