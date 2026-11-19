-- Real Terms — base de serviço em PostgreSQL (Fase 1 de docs/arquitetura-comercial.md).
--
-- Recebe, a cada atualização, o mesmo conteúdo de data/empresas.js (scripts/carregar_base.py)
-- e guarda o histórico de tudo:
--   * tabelas "_vigente" por intervalo de cargas (carga_de, carga_ate): uma linha só muda
--     quando o valor muda, e o estado de qualquer carga passada pode ser remontado;
--   * tabelas "retrato_" com o que muda todo dia (cotação, valor de mercado, índice),
--     uma linha por carga.
-- Valores monetários em reais (a base em JSON usa R$ mil). Idempotente: pode rodar de novo.

-- ---------------------------------------------------------------- cargas

create table if not exists carga (
  id               bigint generated always as identity primary key,
  publicada_em     timestamptz not null default now(),
  gerado_em        text not null,                -- carimbo do processar.py ("2026-11-18 00:05")
  ano_final        smallint not null,
  cotacoes_em      date,
  ptax_atual_data  date,
  ptax_atual_valor numeric,
  resumo           jsonb                         -- contagens da carga (empresas, linhas novas…)
);

-- ---------------------------------------------------------------- catálogo

create table if not exists metrica (
  codigo    text primary key,
  ordem     smallint not null,
  nome_pt   text not null,
  nome_en   text not null,
  unidade   text not null check (unidade in ('brl', 'acoes', 'brl_por_acao')),
  natureza  text not null check (natureza in ('fluxo', 'saldo'))  -- dólar: PTAX média × PTAX do fim
);

-- ---------------------------------------------------------------- identidade

create table if not exists empresa (
  id     bigint generated always as identity primary key,
  cd_cvm text not null unique,
  cnpj   text not null
);

create table if not exists papel (
  id         bigint generated always as identity primary key,
  empresa_id bigint not null references empresa,
  ticker     text not null unique
);

-- ---------------------------------------------------------------- dados com histórico por intervalo de cargas

create table if not exists cadastro (
  empresa_id bigint not null references empresa,
  nome       text not null,
  setor      text, segmento text, controle text, site text,
  setor_b3   jsonb,                               -- {"pt": …, "en": …}
  exterior   jsonb not null,                      -- países onde também negocia
  units      jsonb not null,                      -- composição das units, como vem do FCA
  carga_de   bigint not null references carga,
  carga_ate  bigint references carga
);
create unique index if not exists cadastro_vigente on cadastro (empresa_id) where carga_ate is null;

create table if not exists listagem (                -- tickers de cada empresa, na ordem da base
  papel_id  bigint not null references papel,
  ordem     smallint not null,
  carga_de  bigint not null references carga,
  carga_ate bigint references carga
);
create unique index if not exists listagem_vigente on listagem (papel_id) where carga_ate is null;

create table if not exists fundamento_anual (
  empresa_id bigint not null references empresa,
  exercicio  smallint not null,                   -- ano do fim do exercício na DFP
  metrica    text not null references metrica,
  valor      numeric,                      -- null: o exercício existe, a conta não veio
  carga_de   bigint not null references carga,
  carga_ate  bigint references carga
);
create unique index if not exists fundamento_anual_vigente on fundamento_anual (empresa_id, exercicio, metrica) where carga_ate is null;

create table if not exists fundamento_12m (          -- últimos 12 meses (DFP + ITR)
  empresa_id bigint not null references empresa,
  ate        date not null,
  metrica    text not null references metrica,
  valor      numeric,
  carga_de   bigint not null references carga,
  carga_ate  bigint references carga
);
create unique index if not exists fundamento_12m_vigente on fundamento_12m (empresa_id, ate, metrica) where carga_ate is null;

create table if not exists ajuste (                  -- correções e estimativas feitas pelo processamento
  empresa_id bigint not null references empresa,
  exercicio  smallint not null,
  metrica    text not null references metrica,
  regra      text not null check (regra in ('acoes_estimadas_pelo_lpa', 'acoes_escala_corrigida_pelo_preco')),
  ordem      smallint,                           -- ordem em que o processamento aplicou a correção
  carga_de   bigint not null references carga,
  carga_ate  bigint references carga
);
create unique index if not exists ajuste_vigente on ajuste (empresa_id, exercicio, metrica, regra) where carga_ate is null;

create table if not exists preco_fim_exercicio (     -- fechamento no último pregão de cada exercício
  papel_id   bigint not null references papel,
  exercicio  smallint not null,
  fechamento numeric not null,
  carga_de   bigint not null references carga,
  carga_ate  bigint references carga
);
create unique index if not exists preco_fim_exercicio_vigente on preco_fim_exercicio (papel_id, exercicio) where carga_ate is null;

create table if not exists ptax_anual (
  ano       smallint not null,
  media     numeric not null,
  fim       numeric not null,
  carga_de  bigint not null references carga,
  carga_ate bigint references carga
);
create unique index if not exists ptax_anual_vigente on ptax_anual (ano) where carga_ate is null;

-- ---------------------------------------------------------------- retratos de cada carga

create table if not exists retrato_empresa (
  carga_id          bigint not null references carga,
  empresa_id        bigint not null references empresa,
  ticker_principal  text not null,
  financeiro        boolean not null,
  individual        boolean not null,
  valor_mercado     numeric,
  valor_mercado_dfp numeric,
  acoes_on          bigint, acoes_pn bigint, tesouraria bigint,  -- quantidade vigente na B3
  acoes_cvm         jsonb,                  -- formulário mais recente da CVM: data, fonte, on, pn, tesouraria_on, tesouraria_pn
  eventos_acoes     jsonb,                  -- desdobramentos, grupamentos e bonificações (B3): data, tipo, fator
  proventos_12m     numeric,
  liquidez          numeric not null,       -- volume médio diário, R$
  primary key (carga_id, empresa_id)
);

-- bases criadas antes da coluna
alter table retrato_empresa add column if not exists acoes_cvm jsonb;
alter table retrato_empresa add column if not exists eventos_acoes jsonb;

create table if not exists retrato_papel (
  carga_id bigint not null references carga,
  papel_id bigint not null references papel,
  preco    numeric not null,
  data     date not null,
  volume   numeric not null,
  dy12m    numeric,
  primary key (carga_id, papel_id)
);

create table if not exists indice (                  -- índice de previsibilidade
  carga_id    bigint not null references carga,
  empresa_id  bigint not null references empresa,
  moeda       text not null check (moeda in ('brl', 'usd')),
  metodologia text not null default 'v1',
  total       smallint not null,
  componentes jsonb not null,
  ano_ini     smallint not null,
  ano_fim     smallint not null,
  primary key (carga_id, empresa_id, moeda)
);

-- ---------------------------------------------------------------- consultas prontas (estado atual)

create or replace view carga_atual as
  select * from carga order by id desc limit 1;

create or replace view fundamento_anual_atual as
  select e.cd_cvm, f.empresa_id, f.exercicio, f.metrica, f.valor
  from fundamento_anual f join empresa e on e.id = f.empresa_id
  where f.carga_ate is null;

create or replace view empresa_atual as
  select e.id as empresa_id, e.cd_cvm, e.cnpj, c.nome, c.setor, r.ticker_principal, r.financeiro,
         r.valor_mercado, r.liquidez, i.total as indice_brl
  from empresa e
  join cadastro c on c.empresa_id = e.id and c.carga_ate is null
  join retrato_empresa r on r.empresa_id = e.id and r.carga_id = (select id from carga_atual)
  left join indice i on i.empresa_id = e.id and i.carga_id = r.carga_id and i.moeda = 'brl';
