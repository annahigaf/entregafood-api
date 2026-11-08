-- =====================================================================
-- Entrega Food – Modelo do banco de dados (PostgreSQL 14+)
-- Perfis: ADMIN, RESTAURANTE, MOTOBOY, CLIENTE
-- IMPORTANTE: o app NUNCA conecta direto ao banco. Quem acessa é o
-- backend (API), que confere o perfil do usuário em cada requisição.
-- =====================================================================

CREATE TYPE papel_usuario    AS ENUM ('ADMIN', 'RESTAURANTE', 'MOTOBOY', 'CLIENTE');
CREATE TYPE status_pedido    AS ENUM ('CRIADO', 'CONFIRMADO', 'EM_PREPARO', 'PRONTO',
                                      'SAIU_PARA_ENTREGA', 'ENTREGUE', 'CANCELADO');
CREATE TYPE tipo_pagamento   AS ENUM ('PIX', 'CARTAO_CREDITO', 'CARTAO_DEBITO', 'DINHEIRO');
CREATE TYPE status_pagamento AS ENUM ('PENDENTE', 'APROVADO', 'RECUSADO', 'ESTORNADO');
CREATE TYPE status_entrega   AS ENUM ('DISPONIVEL', 'ACEITA', 'COLETADA', 'CONCLUIDA', 'CANCELADA');

-- ---------------------------------------------------------------------
-- Usuários (todos os perfis fazem login aqui)
-- ---------------------------------------------------------------------
CREATE TABLE usuarios (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    nome        text        NOT NULL,
    email       text        NOT NULL UNIQUE,
    telefone    text,
    senha_hash  text        NOT NULL,              -- bcrypt/argon2, nunca a senha pura
    papel       papel_usuario NOT NULL,
    ativo       boolean     NOT NULL DEFAULT true, -- admin pode bloquear
    criado_em   timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- Restaurantes e cardápio
-- ---------------------------------------------------------------------
CREATE TABLE restaurantes (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    dono_id       uuid        NOT NULL REFERENCES usuarios(id),   -- usuário RESTAURANTE
    nome          text        NOT NULL,
    categoria     text,
    foto_capa_url text,
    endereco      text        NOT NULL,
    latitude      numeric(9,6),
    longitude     numeric(9,6),
    taxa_entrega  numeric(10,2) NOT NULL DEFAULT 0 CHECK (taxa_entrega >= 0),
    pedido_minimo numeric(10,2) NOT NULL DEFAULT 0 CHECK (pedido_minimo >= 0),
    tempo_min     int         NOT NULL DEFAULT 30,   -- estimativa de entrega (minutos)
    tempo_max     int         NOT NULL DEFAULT 45,
    aberto        boolean     NOT NULL DEFAULT true,
    ativo         boolean     NOT NULL DEFAULT true,
    criado_em     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE categorias_cardapio (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurante_id  uuid NOT NULL REFERENCES restaurantes(id) ON DELETE CASCADE,
    nome            text NOT NULL,
    ordem           int  NOT NULL DEFAULT 0
);

CREATE TABLE itens_cardapio (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurante_id  uuid NOT NULL REFERENCES restaurantes(id) ON DELETE CASCADE,
    categoria_id    uuid REFERENCES categorias_cardapio(id) ON DELETE SET NULL,
    nome            text NOT NULL,
    descricao       text,
    preco           numeric(10,2) NOT NULL CHECK (preco >= 0),
    foto_url        text,
    visivel         boolean NOT NULL DEFAULT true,   -- "ocultar" item
    removido_em     timestamptz                      -- "remover" = apagar sem perder histórico
);

-- ---------------------------------------------------------------------
-- Cliente: endereços e meios de pagamento
-- ---------------------------------------------------------------------
CREATE TABLE enderecos (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    usuario_id  uuid NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    apelido     text NOT NULL,
    logradouro  text NOT NULL,
    numero      text,
    complemento text,
    bairro      text,
    cidade      text NOT NULL,
    uf          char(2) NOT NULL,
    cep         text,
    latitude    numeric(9,6),
    longitude   numeric(9,6),
    principal   boolean NOT NULL DEFAULT false
);

-- Nunca guardar o número completo do cartão: só o token do gateway de pagamento.
CREATE TABLE meios_pagamento (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    usuario_id     uuid NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    tipo           tipo_pagamento NOT NULL,
    bandeira       text,
    ultimos4       char(4),
    token_gateway  text,
    principal      boolean NOT NULL DEFAULT false
);

-- ---------------------------------------------------------------------
-- Pedidos, itens, pagamentos e entregas
-- ---------------------------------------------------------------------
CREATE TABLE pedidos (
    id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    cliente_id           uuid NOT NULL REFERENCES usuarios(id),
    restaurante_id       uuid NOT NULL REFERENCES restaurantes(id),
    endereco_entrega_id  uuid NOT NULL REFERENCES enderecos(id),
    status               status_pedido NOT NULL DEFAULT 'CRIADO',
    subtotal             numeric(10,2) NOT NULL CHECK (subtotal >= 0),
    taxa_entrega         numeric(10,2) NOT NULL DEFAULT 0,
    desconto             numeric(10,2) NOT NULL DEFAULT 0,
    total                numeric(10,2) NOT NULL CHECK (total >= 0),
    criado_em            timestamptz NOT NULL DEFAULT now(),
    chave_idempotencia   text                      -- evita pedido duplicado se o app repetir o envio
);

-- Guarda nome e preço do momento da compra (o cardápio pode mudar depois).
CREATE TABLE itens_pedido (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    pedido_id       uuid NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
    item_id         uuid REFERENCES itens_cardapio(id) ON DELETE SET NULL,
    nome_item       text NOT NULL,
    preco_unitario  numeric(10,2) NOT NULL,
    quantidade      int  NOT NULL CHECK (quantidade > 0),
    observacao      text
);

-- Avaliação do pedido pelo cliente (uma por pedido, só depois de entregue).
CREATE TABLE avaliacoes (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    pedido_id       uuid NOT NULL UNIQUE REFERENCES pedidos(id) ON DELETE CASCADE,
    cliente_id      uuid NOT NULL REFERENCES usuarios(id),
    restaurante_id  uuid NOT NULL REFERENCES restaurantes(id),
    nota            int  NOT NULL CHECK (nota BETWEEN 1 AND 5),
    comentario      text,
    criado_em       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE pagamentos (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    pedido_id         uuid NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
    meio_pagamento_id uuid REFERENCES meios_pagamento(id) ON DELETE SET NULL,
    tipo              tipo_pagamento NOT NULL,
    valor             numeric(10,2) NOT NULL CHECK (valor >= 0),
    status            status_pagamento NOT NULL DEFAULT 'PENDENTE',
    criado_em         timestamptz NOT NULL DEFAULT now()
);

-- Corrida do motoboy: uma por pedido.
CREATE TABLE entregas (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    pedido_id        uuid NOT NULL UNIQUE REFERENCES pedidos(id) ON DELETE CASCADE,
    motoboy_id       uuid REFERENCES usuarios(id),    -- usuário MOTOBOY (vazio enquanto DISPONIVEL)
    status           status_entrega NOT NULL DEFAULT 'DISPONIVEL',
    dist_coleta_km   numeric(6,2),                    -- motoboy -> restaurante
    dist_entrega_km  numeric(6,2),                    -- restaurante -> cliente
    valor_motoboy    numeric(10,2),                   -- base + (km total x valor_por_km)
    aceita_em        timestamptz,
    concluida_em     timestamptz
);

-- Valores que só o ADMIN altera.
CREATE TABLE configuracoes (
    chave           text PRIMARY KEY,
    valor           text NOT NULL,
    atualizado_por  uuid REFERENCES usuarios(id),
    atualizado_em   timestamptz NOT NULL DEFAULT now()
);

INSERT INTO configuracoes (chave, valor) VALUES
    ('valor_base_corrida', '5.00'),
    ('valor_por_km',       '1.50'),
    ('comissao_plataforma','12.0');

-- ---------------------------------------------------------------------
-- Garante o perfil certo nas chaves (dono = RESTAURANTE, etc.)
-- ---------------------------------------------------------------------
CREATE FUNCTION exigir_papel() RETURNS trigger AS $$
DECLARE
    coluna text := TG_ARGV[0];
    esperado papel_usuario := TG_ARGV[1]::papel_usuario;
    uid uuid := (to_jsonb(NEW) ->> coluna)::uuid;
BEGIN
    IF uid IS NOT NULL AND NOT EXISTS (SELECT 1 FROM usuarios WHERE id = uid AND papel = esperado) THEN
        RAISE EXCEPTION 'O usuário % não tem o perfil %', uid, esperado;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_dono_restaurante BEFORE INSERT OR UPDATE ON restaurantes
    FOR EACH ROW EXECUTE FUNCTION exigir_papel('dono_id', 'RESTAURANTE');
CREATE TRIGGER trg_cliente_pedido BEFORE INSERT OR UPDATE ON pedidos
    FOR EACH ROW EXECUTE FUNCTION exigir_papel('cliente_id', 'CLIENTE');
CREATE TRIGGER trg_motoboy_entrega BEFORE INSERT OR UPDATE ON entregas
    FOR EACH ROW EXECUTE FUNCTION exigir_papel('motoboy_id', 'MOTOBOY');

-- ---------------------------------------------------------------------
-- Índices
-- ---------------------------------------------------------------------
CREATE INDEX idx_pedidos_restaurante_data ON pedidos (restaurante_id, criado_em);
CREATE INDEX idx_pedidos_cliente          ON pedidos (cliente_id);
CREATE UNIQUE INDEX uq_pedido_chave       ON pedidos (cliente_id, chave_idempotencia) WHERE chave_idempotencia IS NOT NULL;
CREATE INDEX idx_entregas_status          ON entregas (status);
CREATE INDEX idx_avaliacoes_restaurante   ON avaliacoes (restaurante_id);
-- Um motoboy só pode ter UMA corrida em andamento por vez.
CREATE UNIQUE INDEX uq_motoboy_corrida_ativa ON entregas (motoboy_id) WHERE status IN ('ACEITA', 'COLETADA');
CREATE INDEX idx_itens_restaurante        ON itens_cardapio (restaurante_id) WHERE removido_em IS NULL;

-- ---------------------------------------------------------------------
-- RELATÓRIOS (iguais ao protótipo/planilha). Contam só pedidos ENTREGUE.
-- ---------------------------------------------------------------------

-- 1) Receita bruta e % de participação por restaurante (admin)
CREATE FUNCTION relatorio_receita(p_inicio date, p_fim date)
RETURNS TABLE (restaurante text, receita_bruta numeric, percentual numeric) AS $$
    SELECT r.nome,
           COALESCE(SUM(p.total), 0),
           ROUND(100 * COALESCE(SUM(p.total), 0) / NULLIF(SUM(SUM(p.total)) OVER (), 0), 1)
    FROM restaurantes r
    LEFT JOIN pedidos p ON p.restaurante_id = r.id
                       AND p.status = 'ENTREGUE'
                       AND p.criado_em >= p_inicio
                       AND p.criado_em <  p_fim + 1
    GROUP BY r.id, r.nome
    ORDER BY 2 DESC;
$$ LANGUAGE sql STABLE;

-- 2) Qtd de pedidos, faturamento e ticket médio por restaurante, ordenado (admin)
CREATE FUNCTION relatorio_pedidos(p_inicio date, p_fim date)
RETURNS TABLE (restaurante text, qtd_pedidos bigint, faturamento numeric, ticket_medio numeric) AS $$
    SELECT r.nome,
           COUNT(p.id),
           COALESCE(SUM(p.total), 0),
           COALESCE(ROUND(AVG(p.total), 2), 0)
    FROM restaurantes r
    LEFT JOIN pedidos p ON p.restaurante_id = r.id
                       AND p.status = 'ENTREGUE'
                       AND p.criado_em >= p_inicio
                       AND p.criado_em <  p_fim + 1
    GROUP BY r.id, r.nome
    ORDER BY 2 DESC;
$$ LANGUAGE sql STABLE;

-- 3) Gráfico de rosca: pagamentos por tipo (qtd de pedidos e R$).
--    p_restaurante = NULL -> todos (admin); com id -> só aquele restaurante.
CREATE FUNCTION relatorio_pagamentos(p_inicio date, p_fim date, p_restaurante uuid DEFAULT NULL)
RETURNS TABLE (tipo tipo_pagamento, qtd_pedidos bigint, valor numeric) AS $$
    SELECT pg.tipo, COUNT(DISTINCT p.id), COALESCE(SUM(pg.valor), 0)
    FROM pagamentos pg
    JOIN pedidos p ON p.id = pg.pedido_id
    WHERE p.status = 'ENTREGUE'
      AND pg.status = 'APROVADO'
      AND p.criado_em >= p_inicio
      AND p.criado_em <  p_fim + 1
      AND (p_restaurante IS NULL OR p.restaurante_id = p_restaurante)
    GROUP BY pg.tipo
    ORDER BY 2 DESC;
$$ LANGUAGE sql STABLE;
