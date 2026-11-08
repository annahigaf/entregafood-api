# Entrega Food – API

Node.js + Express + PostgreSQL. Login com JWT e 4 perfis: ADMIN, RESTAURANTE, MOTOBOY, CLIENTE.
O perfil é sempre conferido no servidor, em toda requisição.

## O que você precisa
1. **Node.js 18 ou mais novo** (baixe a versão LTS em nodejs.org).
2. **Um banco PostgreSQL**. Escolha UMA opção:
   - **Neon (grátis, na internet):** crie uma conta em neon.tech, crie um projeto e copie a *connection string*.
     No `.env` use `DATABASE_SSL=true`.
   - **No seu PC:** instale o PostgreSQL, crie um banco chamado `entregafood` e use
     `postgresql://postgres:SUA_SENHA@localhost:5432/entregafood` (com `DATABASE_SSL=false`).

## Passo a passo
Abra o terminal (PowerShell) dentro desta pasta e rode:

```
npm install
copy .env.example .env
```
Abra o arquivo `.env` e preencha `DATABASE_URL` e `JWT_SECRET` (um texto longo e aleatório, 40+ caracteres).

```
npm run db:init
npm start
```
Teste no navegador: http://localhost:3000/saude  → deve mostrar `{"ok":true}`.

- `npm run db:init`: cria as tabelas e os dados de exemplo (só se o banco estiver vazio).
- `npm run db:reset`: **apaga tudo** e recria (use só em desenvolvimento).
- `npm run smoke`: teste automático de ponta a ponta (com a API rodando). Deve terminar com "0 com erro".

### Contas de exemplo (senha 123456)
`admin@`, `cliente@`, `restaurante@`, `motoboy@`, `motoboy2@` + `entregafood.com`

### Usando no celular de verdade
O celular precisa estar no mesmo Wi-Fi do PC. No app, troque `BASE_URL` (AppConfig.kt) por
`http://IP-DO-SEU-PC:3000` e libere a porta 3000 no firewall do Windows.

## Rotas principais
| Perfil | Rotas |
|---|---|
| Público | `POST /auth/login`, `POST /auth/cadastro` (sempre cria CLIENTE), `GET /saude` |
| Qualquer logado | `GET /restaurantes` (também em `/consultas/restaurantes`), `GET /restaurantes/:id/cardapio` |
| CLIENTE | `/cliente/enderecos`, `/cliente/meios-pagamento`, `POST /cliente/pedidos`, `GET /cliente/pedidos`, `POST /cliente/pedidos/:id/cancelar`, `POST /cliente/pedidos/:id/avaliar` |
| RESTAURANTE | `/restaurante/cardapio` (criar, editar preço, ocultar, remover), `PUT /restaurante/capa`, `PUT`/`DELETE /restaurante/cardapio/:id/foto` (foto do produto), `GET /restaurante/pedidos`, `PATCH /restaurante/pedidos/:id/status`, `GET /restaurante/relatorio` |
| MOTOBOY | `GET /motoboy/corridas`, `POST /motoboy/corridas/:id/aceitar`, `.../coletar`, `.../concluir`, `GET /motoboy/minha-corrida`, `GET /motoboy/ganhos` |
| ADMIN | `/admin/relatorio/receita`, `/admin/relatorio/pedidos`, `/admin/relatorio/pagamentos`, `/admin/usuarios`, `/admin/restaurantes`, `/admin/configuracoes` |

O app Android envia PATCH como `POST` + cabeçalho `X-HTTP-Method-Override: PATCH` (a API entende os dois).

Erros sempre voltam como `{ "erro": "mensagem em português" }`.

## Antes de publicar na internet
- Use **HTTPS** (hospedagens como Render/Railway já fornecem) e um `JWT_SECRET` forte e secreto.
- Troque o pagamento simulado (`routes/cliente.js`, procure "TODO") por um gateway real (Mercado Pago, Stripe etc.).
- A distância da corrida é uma estimativa em linha reta (`util.js`, `distanciaRuaKm`). Para a rota real, use a Google Routes API **aqui no servidor**, para não expor a chave no app.
- Apague as contas de exemplo (`npm run db:init` cria contas com senha 123456!).
- **Pedido sem duplicar:** `POST /cliente/pedidos` aceita o campo `chave` (texto de 8 a 80 caracteres). Repetir o envio com a mesma chave devolve o mesmo pedido (status 200, `repetido: true`) em vez de criar outro.
- **Bancos antigos** ganham a coluna nova sozinhos quando a API liga (`src/migrate.js`); não precisa apagar nada.
- As fotos de capa e dos produtos ficam na pasta `uploads/`. Em hospedagens que apagam arquivos, use um armazenamento (S3, Cloudinary).
