# Real Terms — ações brasileiras, em termos reais

*Brazilian stocks, in real terms.* (Nome anterior: Lastro.)

Fundamentos, cotações, múltiplos (P/L, P/VP, DY, EV/EBITDA) e um índice de previsibilidade (0–100) das empresas listadas na B3, em reais ou em dólar, pensado para o investidor estrangeiro. Usa só dados públicos: CVM, B3 e Banco Central.

## Rodando

```bash
python3 scripts/processar.py      # baixa o que faltar da CVM, B3 e BCB e gera data/empresas.js
python3 ../financas-pessoais/dev-server.py 8750
```

Abra http://localhost:8750. Como `data/empresas.js` é um script clássico, o `index.html` também abre direto pelo arquivo (`file://`).

A CVM regera os ZIPs dos últimos anos quando há reapresentação. Use `python3 scripts/processar.py --rebaixar` para buscar de novo os anos recentes.

## Estrutura

| Caminho | O que é |
|---|---|
| `scripts/processar.py` | Lê DFP e FCA da CVM, cotações e fichas de emissores da B3 e a PTAX do BCB e gera `data/empresas.js`. A docstring explica os cuidados com a base. |
| `scripts/auditar.py` | Audita a base contra as fontes e gera `auditoria.md` (resumo) e `auditoria.json` (todas as ocorrências). Com `--trava`, sai com código 2 se a base piorou em relação a `auditoria_resumo.json`. |
| `scripts/mudancas.py` | Compara a base nova com a commitada e escreve `mudancas.md` (entradas e saídas, balanços novos, cotações que mudaram mais de 15% em papéis com liquidez de pelo menos R$ 1 mi/dia, índice que mudou 5 pontos ou mais). |
| `scripts/versionar.py` | Atualiza o `?v=` dos assets no `index.html` com o hash do conteúdo. Roda sozinho no fim do processamento. |
| `docs/arquitetura-comercial.md` | Proposta de arquitetura para vender acesso: formato da base (bruto → staging → Postgres), modelo de dados, API, planos, bloqueios jurídicos e fases. |
| `tests/` | `test_regras.py` (regras com dados sintéticos), `test_dados.py` (invariantes da base gerada) e `test_base.py` (base em Postgres; precisa de `DATABASE_URL_TESTE`). `python3 -m unittest discover -s tests` |
| `db/schema.sql` | Esquema da base em PostgreSQL (histórico por intervalo de cargas, retratos diários, catálogo de métricas). |
| `scripts/carregar_base.py` | Carrega `data/empresas.js` no Postgres numa transação, remonta a base a partir do banco e compara campo a campo; se divergir, desfaz tudo. |
| `requirements.txt` | Única dependência externa: `psycopg` (só para a base em Postgres; o processamento continua só com a biblioteca padrão). |
| `.github/workflows/atualizar.yml` | Atualização diária no GitHub Actions |
| `scripts/sources/` | ZIPs e JSON brutos baixados (fora do git, ~300 MB) |
| `auditoria.md`, `auditoria.json` | Saída da auditoria (regerada a cada execução) |
| `data/empresas.js` | `window.DADOS` com séries anuais em R$ mil, PTAX e índice. Gerado, não edite. |
| `index.html`, `app.js`, `style.css` | Rotas: entrada (`#/`), ranking (`#/acoes`), teia (`#/teia/PETR4,VALE3`; o antigo `#/mapa` cai nela) e página da empresa (`#/PETR4`), com cabeçalho-resumo, selos e navegação por seções. Gráficos em SVG próprio. `app.js` expõe `window.RealTerms` (dados, formatos, textos) para os módulos abaixo. |
| `inicio.js` | Página de entrada em cinco capítulos (o mercado em números, previsibilidade, real × dólar, glossário, três passos), calculada da base. |
| `teia.js` | Aba Comparar (`#/comparar/PETR4,VALE3`; os antigos `#/teia` e `#/mapa` caem nela): até quatro empresas lado a lado. Placar (indicadores × empresas, valor real e cor pela posição entre as ações líquidas), régua do mercado (valor real contra a faixa do meio, a mediana e os extremos do mercado), previsibilidade por componente em barras, qualidade × preço (ROE × P/VP), receita em base 100, margem líquida por ano e tamanho/liquidez. Tudo em posição ou comprimento numa escala comum; o radar saiu porque ângulo e área enganam. As empresas escolhidas ficam no endereço. |
| `agenda.js` | Agenda de proventos (`#/agenda`): dividendos e JCP aprovados e ainda por pagar, das fichas da B3 (`e.agenda`, gravado pelo processamento). A página da empresa mostra os pagamentos dela. |
| `termos.js` | Glossário PT/EN com dica ao passar o mouse (no celular, ao tocar): o que o termo é, como ler, exemplo de valor bom e ruim e a mediana atual das ações líquidas. Os termos são achados pelo texto depois de cada renderização (`MutationObserver` em `#app`); termo novo é uma linha em `LISTA`, com os nomes em PT e EN. |
| `scripts/gerar_paginas.py` | Páginas estáticas indexáveis por empresa (`acao/PETR4/`), índice por setor (`acao/`), `sitemap.xml` e `robots.txt`, em inglês, com título, descrição, Open Graph e schema.org. Roda todo dia no Actions. O endereço público fica em `SITE_URL`. |
| `scripts/gerar_imagens.swift` | Gera `og.png` (imagem de compartilhamento 1200×630) e os ícones `icon-180.png`/`icon-512.png` com AppKit: `swift scripts/gerar_imagens.swift`. `favicon.svg` e `manifest.webmanifest` são escritos à mão. |
| `i18n.js` | Textos da interface em português e inglês (seletor PT/EN no topo; o padrão segue o idioma do navegador). Setor em inglês vem da B3; controle, segmento e país têm tradução em `I18N_MAPAS`. |

Depois de editar `app.js` ou `style.css`, rode `python3 scripts/versionar.py` (o processamento já faz isso).

## Automação

O GitHub Actions roda `.github/workflows/atualizar.yml` em todo dia útil, às 20h17 de Brasília (e sob demanda pela aba Actions):

1. `processar.py` baixa só o que falta ou venceu: pregões novos todo dia; fichas e lista da B3, DFP e ITR recentes a cada 7 dias. As fontes ficam no cache do Actions.
2. `gerar_paginas.py` reescreve as páginas indexáveis (`acao/`) e o sitemap.
3. Testes de regressão.
4. `auditar.py --externo --trava`: se a cobertura cair abaixo de 97%, a base encolher mais de 5% ou surgirem mais de 5 ocorrências graves novas, o job falha e nada é publicado.
5. `mudancas.py` resume o que mudou desde o último commit.
6. Commit de `data/empresas.js`, `index.html`, das páginas indexáveis e da auditoria; o GitHub Pages publica o commit.
7. Um issue avisa quando há mudanças relevantes ou quando a atualização falha (o GitHub manda por e-mail).
8. Se o segredo `DATABASE_URL` existir, `carregar_base.py` grava a mesma base no Postgres. Se a carga falhar, o site já foi publicado e um issue próprio avisa; nada fica gravado pela metade.

Os dados trimestrais (ITR) entram nos indicadores de 12 meses: último exercício + acumulado do ano − acumulado do mesmo período do ano anterior.

## Base em PostgreSQL

Primeiro passo da Fase 1 de [`docs/arquitetura-comercial.md`](docs/arquitetura-comercial.md): a mesma base do site, agora num Postgres com histórico. O site continua lendo `data/empresas.js`; nada muda para quem usa.

- **Histórico por carga.** Cada atualização é uma carga. Cadastro, tickers, fundamentos, ajustes, preços de fim de exercício e PTAX têm `carga_de`/`carga_ate`: só ganha linha nova o que mudou (uma reapresentação, por exemplo), e qualquer carga passada pode ser remontada. Cotação, valor de mercado e índice ficam em retratos por carga (`retrato_empresa`, `retrato_papel`, `indice`), o que guarda o histórico diário desde a primeira carga.
- **Correções como dado.** Ações estimadas pelo LPA e ações com escala corrigida viram linhas da tabela `ajuste`.
- **Reais, não R$ mil.** Valores monetários são gravados em reais. O catálogo `metrica` diz unidade, natureza (fluxo ou saldo, que decide a PTAX) e nome em português e inglês.
- **Conferência.** Antes de confirmar, o script remonta o JSON a partir do banco e compara campo a campo (345 empresas, ~133 mil valores). Qualquer diferença desfaz a transação.

Para ligar em produção:

1. Crie um Postgres gerenciado (Supabase ou Neon têm plano grátis) e copie a string de conexão.
2. No GitHub: *Settings → Secrets and variables → Actions → New repository secret*, nome `DATABASE_URL`.
3. A próxima atualização diária cria as tabelas e faz a primeira carga. Para carregar já:

```bash
DATABASE_URL='postgresql://…' python3 scripts/carregar_base.py
```

Consultas de exemplo:

```sql
-- maiores empresas hoje
select ticker_principal, nome, valor_mercado, indice_brl from empresa_atual order by valor_mercado desc nulls last limit 10;

-- receita anual da WEGE, em reais
select f.exercicio, f.valor from fundamento_anual_atual f join empresa_atual e using (empresa_id)
where e.ticker_principal = 'WEGE3' and f.metrica = 'receita' order by 1;

-- valores reapresentados: o que mudou e em que carga
select * from fundamento_anual where carga_ate is not null order by carga_ate desc limit 20;
```

O esquema é idempotente (`create … if not exists`) e roda a cada carga. Mudança em tabela que já existe pede um `alter table` à mão até a base ganhar uma ferramenta de migração.

## Fontes

- DFP: https://dados.cvm.gov.br/dados/CIA_ABERTA/DOC/DFP/DADOS/
- FCA (tickers, setor, segmento, controle, negociação no exterior): https://dados.cvm.gov.br/dados/CIA_ABERTA/DOC/FCA/DADOS/
- Cotações: série histórica da B3 (COTAHIST), https://bvmf.bmfbovespa.com.br/InstDados/SerHist/. Arquivos diários a partir de 2018 (último pregão de cada ano e os 21 pregões mais recentes, para preço atual e liquidez); anuais de 2009 a 2017.
- Lista de emissores da B3 (CNPJ, código CVM, raiz do ticker) e ficha de cada emissor (ações ON/PN atuais, proventos com data-com): API pública `sistemaswebb3-listados.b3.com.br`
- PTAX venda diária: API SGS do Banco Central, série 1

## Índice de previsibilidade

Calculado sobre os últimos 10 exercícios (mínimo de 5), em R$ e em US$:

| Componente | Peso | Regra |
|---|---|---|
| Lucro positivo | 30 | fração dos anos com lucro > 0 |
| Margem estável | 25 | 1 − desvio-padrão da margem líquida / 15 p.p. |
| Receita estável | 15 | 1 − desvio-padrão do crescimento anual / 30 p.p. |
| Crescimento constante | 15 | R² da tendência linear da receita (0 se cai) |
| Dividendos regulares | 15 | fração dos anos com dividendos/JCP pagos |

## Validação

```bash
python3 scripts/auditar.py --externo
```

A auditoria tem três camadas:

1. **Cobertura.** Parte do que a B3 negocia de fato (ações ON/PN/units com negócio nos últimos 21 pregões) e diz, para cada emissor ausente, em que etapa ele caiu. Também lista o caminho inverso: empresas da base sem negócio.
2. **Consistência interna.** Cada empresa passa por regras que comparam números entre si: identidade do fluxo de caixa (operacional + investimento + financiamento + câmbio = variação do caixa), LPA calculado × LPA declarado na DRE (pelas ações do fim do ano e pela média do ano), ações B3 × DFP, PL × ativo, saltos de ações e receita, margens e múltiplos fora de faixa, DY de 12 meses × DY do exercício, cotação parada, preço que muda de escala depois do balanço.
3. **Referência externa.** Contagens públicas de empresas listadas e, com `--externo`, cotação e valor de mercado de PETR4, VALE3, ITUB4 e MGLU3 na brapi.dev (os únicos liberados sem chave).

Problemas que a auditoria revelou e que o processamento já trata:

| Problema | Exemplo | Tratamento |
|---|---|---|
| Empresa sem controladas só publica a demonstração individual | Sanepar, TIM (consolidado zerado) | consolidado quando existe e não está zerado; senão individual |
| Código de negociação errado ou ausente no FCA | BTG ("000000"), CSN ("4030"), Marfrig ("ADR"), B3 (sem linha) | tickers pela lista de emissores da B3, casada por código CVM |
| B3 cadastra o CNPJ de uma filial | Tupy | casamento pelo código CVM |
| Ações declaradas em escala errada | CSN Mineração 2025 (×10), Vivo 2020–21 (em milhares), IMC 2025 (×20) | continuidade do valor de mercado + LPA declarado + mediana da série |
| Lucro da controladora preenchido com zero | CSN Mineração 2023–24 | usa o lucro consolidado |
| Ações mudaram depois do balanço | Gafisa, Azul, Light, Toky | valor de mercado com a quantidade atual da B3 |
| Raiz de ticker com dígito | B3SA3 | classe pelo número após os 4 primeiros caracteres |
| Caixa operacional muito acima do EBITDA | Sanepar 2025 (R$ 7,1 bi × EBITDA de R$ 3,0 bi) | auditoria explica a diferença por capital de giro ou por itens sem efeito no caixa (impairment, provisões); a página da empresa avisa quando o capital de giro infla o fluxo de caixa livre |

O que sobra no relatório são, em geral, erros de preenchimento das próprias empresas (LPA com sinal trocado ou por lote de mil ações) ou situações reais (holdings com receita zero, empresas em recuperação com múltiplos extremos).

## Limitações conhecidas

- Preços sem ajuste por desdobramento ou grupamento. Os múltiplos históricos usam preço e ações da mesma data, então ficam certos; o gráfico de cotação pode ter saltos.
- Valor de mercado atual = ações ON e PN da B3, menos a tesouraria do último balanço, × cotação de cada classe (units divididas pela composição). No histórico, ações da DFP; antes de 2020 a DFP não traz a quantidade e ela é estimada pelo LPA declarado.
- Número de ações (`acoes_cvm`): composição do capital do formulário mais recente entregue à CVM (ITR do trimestre ou DFP), com ON e PN emitidas e as em tesouraria. Usa a mesma correção de escala da série anual; quando DFP e B3 concordam e o ITR difere delas por potência exata de 10, é escala trocada no formulário e é corrigida (BGIP4 e FIEI3 em 2026). Diferença maior que 5% para a B3 aparece na página como aviso: em geral é grupamento, desdobramento ou emissão depois do formulário.
- Últimos 12 meses só para empresas com exercício de janeiro a dezembro e ITR posterior ao último balanço anual.
- DY 12 meses = proventos com data-com nos últimos 12 meses segundo a ficha da B3. Para quem paga uma vez por ano perto da virada do período, a janela pode pegar zero ou dois pagamentos; o DY do exercício (DFP) fica ao lado para comparar.
- Empresas sem negócio na B3 no último mês ficam sem cotação e múltiplos.
- Bancos e seguradoras têm outro plano de contas, então margens operacionais e dívida ficam em branco.
- O ticker principal é o de maior volume no último mês.
- A quantidade de ações vem sem escala na CVM. O script corrige pelo LPA e pela continuidade entre anos, mas empresas pequenas podem ter erro.

Ferramenta de dados, não recomendação de investimento.
