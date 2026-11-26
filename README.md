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
| `scripts/historico.py` | Histórico diário da aba Simular: fechamento de cada ticker desde 2010 (COTAHIST, com códigos antigos colados pelo FCA), desdobramentos com data (ficha da B3 conferida pelo preço; os achados pelo LPA ou pela contagem ganham a data do salto do preço), proventos em dinheiro desde 2010 (página de eventos corporativos da B3, com a ficha por cima nos últimos 12 meses), CDI, IPCA e PTAX do Banco Central. Grava `data/historico/<TICKER>.js` e `data/historico/_indices.js`. Roda depois de `processar.py`. |
| `scripts/versionar.py` | Atualiza o `?v=` dos assets no `index.html` com o hash do conteúdo. Roda sozinho no fim do processamento. |
| `docs/arquitetura-comercial.md` | Proposta de arquitetura para vender acesso: formato da base (bruto → staging → Postgres), modelo de dados, API, planos, bloqueios jurídicos e fases. |
| `docs/metodologia-simulacao.md` | Metodologia do simulador: dados e tratamento, regras da simulação do passado (proventos, reinvestimento, IR do JCP, CDI e IPCA), modelo de blocos do retorno de referência, volatilidade e correlações, cenários e probabilidades, limites e referências. |
| `docs/metodologia-ranking.md` | Análise teórica do que olhar antes de comprar uma ação, setor a setor, e a metodologia completa da nota da aba Ranking: pilares, indicadores e fórmulas, indicadores futuros, perfis setoriais com pesos e travas, exemplos trabalhados, limites e referências. |
| `tests/` | `test_regras.py` (regras com dados sintéticos), `test_historico.py` (histórico diário com dados sintéticos), `test_simular.py` (contas do simulador em `simular_contas.js`; precisa do Node), `test_resumo.py` (resumo diário com dados sintéticos e invariantes das edições publicadas), `test_dados.py` (invariantes da base gerada) e `test_base.py` (base em Postgres; precisa de `DATABASE_URL_TESTE`). `python3 -m unittest discover -s tests` |
| `db/schema.sql` | Esquema da base em PostgreSQL (histórico por intervalo de cargas, retratos diários, catálogo de métricas). |
| `scripts/carregar_base.py` | Carrega `data/empresas.js` no Postgres numa transação, remonta a base a partir do banco e compara campo a campo; se divergir, desfaz tudo. |
| `requirements.txt` | Única dependência externa: `psycopg` (só para a base em Postgres; o processamento continua só com a biblioteca padrão). |
| `.github/workflows/atualizar.yml` | Atualização diária no GitHub Actions |
| `scripts/sources/` | ZIPs e JSON brutos baixados (fora do git, ~300 MB) |
| `auditoria.md`, `auditoria.json` | Saída da auditoria (regerada a cada execução) |
| `data/empresas.js` | `window.DADOS` com séries anuais em R$ mil, PTAX e índice. Gerado, não edite. |
| `data/historico/` | Um arquivo por ticker (`window.HIST`: datas e fechamentos compactos, eventos e proventos) e `_indices.js` (`window.INDICES`: CDI e PTAX diários, IPCA mensal). Gerados por `historico.py`; o navegador só baixa os da simulação. |
| `index.html`, `app.js`, `style.css` | Rotas: entrada (`#/`), lista de ações (`#/acoes`), ranking por fundamentos (`#/ranking`), agenda de proventos (`#/agenda`), comparar (`#/comparar/PETR4,VALE3`; os antigos `#/teia` e `#/mapa` caem nela), simulador (`#/simular`) e página da empresa (`#/PETR4`), com cabeçalho-resumo, selos e navegação por seções. Gráficos em SVG próprio. Filtro de setor numa faixa sob o cabeçalho: vale para todas as abas (início, ranking, agenda e comparar, que passa a comparar o setor inteiro), fica gravado no navegador e usa a classificação da B3. `app.js` expõe `window.RealTerms` (dados, formatos, textos, `visiveis()` e `setorAtivo()`) para os módulos abaixo. |
| `inicio.js` | Página de entrada (`#/`, `#/curso/7`): curso do básico ao avançado em 18 aulas e uma capa, em telas, num palco escuro inspirado em experiências de slides (grade fina, partículas de traços, título que se decodifica, contador, setas circulares e menu de aulas). Três níveis: o básico (empresa, ação, bolsa, preço, dividendos), ler a empresa (balanço, resultado, patrimônio, caixa, múltiplos, retorno, dívida) e avançado (diluição, ciclo, câmbio, governança, valor, método). Cada aula mostra "na prática" os números reais de uma empresa que o usuário escolhe no seletor Exemplo, com um desenho em SVG que se traça na entrada. Setas, teclado (← →), deslizar no celular; aulas vistas ficam marcadas no navegador. |
| `teia.js` | Aba Comparar (`#/comparar/PETR4,VALE3`; os antigos `#/teia` e `#/mapa` caem nela): até quatro empresas lado a lado. Placar (indicadores × empresas, valor real e cor pela posição entre as ações líquidas), régua do mercado (valor real contra a faixa do meio, a mediana e os extremos do mercado), previsibilidade por componente em barras, qualidade × preço (ROE × P/VP), receita em base 100, margem líquida por ano e tamanho/liquidez. Tudo em posição ou comprimento numa escala comum; o radar saiu porque ângulo e área enganam. As empresas escolhidas ficam no endereço. |
| `agenda.js` | Agenda de proventos (`#/agenda`): dividendos e JCP aprovados e ainda por pagar, das fichas da B3 (`e.agenda`, gravado pelo processamento). A página da empresa mostra os pagamentos dela. |
| `ranking.js` | Aba Ranking (`#/ranking`, `#/ranking/PETR4` abre a explicação da empresa): nota de fundamentos de 0 a 100 por empresa, em quatro pilares (qualidade, preço, solidez e futuro). Cada indicador vira percentil (metade contra os pares do mesmo perfil setorial, metade contra o mercado); 14 perfis setoriais cobrem os 59 segmentos da B3, com pesos, limite de dívida e pontos de análise próprios; travas para recuperação judicial, patrimônio negativo, prejuízo e dívida alta. Explicação por empresa (fatores a favor e contra, pilares, indicadores futuros) e metodologia na própria aba. Respeita o filtro de setor. Detalhes em `docs/metodologia-ranking.md`. Métrica quantitativa, não é recomendação. |
| `simular.js` | Aba Simular (`#/simular/PETR4,VALE3/2020-01-02/10000`): compra de uma ou mais ações num dia ou ano, com valorização, desdobramentos, dividendos e JCP (com ou sem reinvestimento e IR) até o último pregão, contra o CDI e o IPCA; projeção de 5 anos da carteira de hoje em três cenários (percentis 10, 50 e 90), com retorno de referência pelos fundamentos (dividend yield sustentável + crescimento do lucro por ação + reprecificação parcial do P/L), volatilidade e correlações semanais de 3 anos e os pressupostos por ação à mostra. Detalhes em `docs/metodologia-simulacao.md`. Não é recomendação. |
| `termos.js` | Glossário PT/EN com dica ao passar o mouse (no celular, ao tocar): o que o termo é, como ler, exemplo de valor bom e ruim e a mediana atual das ações líquidas. Os termos são achados pelo texto depois de cada renderização (`MutationObserver` em `#app`); termo novo é uma linha em `LISTA`, com os nomes em PT e EN (texto exato ou expressão regular, para rótulos com números como "Desdobramento 1:2"). Termo que só vale numa aba leva um seletor de escopo: "Price" é o pilar no Ranking e a cotação na lista de ações. Cobre indicadores, demonstrações, eventos de ações, a nota e os pilares do Ranking e os termos do Simular. |
| `scripts/gerar_paginas.py` | Páginas estáticas indexáveis por empresa (`acao/PETR4/`), índice por setor (`acao/`), `sitemap.xml` e `robots.txt`, em inglês, com título, descrição, Open Graph e schema.org. Roda todo dia no Actions. O endereço público fica em `SITE_URL`. |
| `scripts/resumo.py` | Resumo diário em inglês (Real Terms Daily) em `resumo/`: uma edição por pregão (`resumo/2026-11-24/`), o arquivo com a mais recente (`resumo/index.html`) e o feed RSS 2.0 (`resumo/feed.xml`), com cada edição completa em HTML de e-mail. Cada edição traz o câmbio do dia, quantas ações subiram e caíram, as cinco maiores altas e quedas em dólares, os proventos do pregão seguinte, o que mudou desde a edição anterior (proventos anunciados, balanços entregues, índice que mudou 3 pontos ou mais, quem entrou ou saiu da base) e uma aula do curso. O conteúdo fica em `resumo.json` e o retrato da base, em `estado.json`, que a edição seguinte compara; as páginas e o feed são redesenhados a partir deles. A edição sai na primeira execução que traz o pregão novo (`cotacoes_em`), até 4 dias depois dele, e espera se o histórico diário ainda não tem o fechamento do dia; `--data AAAA-MM-DD` gera um pregão específico, `--refazer` refaz a edição que já existe e `--enviar` manda a mais recente pelo Buttondown (veja Newsletter). A primeira edição (2026-11-20) é semanal, de quando a newsletter era semanal; `semana/` só redireciona para `resumo/`. |
| `scripts/gerar_imagens.swift` | Gera `og.png` (imagem de compartilhamento 1200×630) e os ícones `icon-180.png`/`icon-512.png` com AppKit: `swift scripts/gerar_imagens.swift`. `favicon.svg` e `manifest.webmanifest` são escritos à mão. |
| `i18n.js` | Textos da interface em português e inglês (seletor PT/EN no topo; o padrão segue o idioma do navegador). Setor em inglês vem da B3; controle, segmento e país têm tradução em `I18N_MAPAS`. |

Depois de editar `app.js` ou `style.css`, rode `python3 scripts/versionar.py` (o processamento já faz isso).

## Automação

O GitHub Actions roda `.github/workflows/atualizar.yml` em todo dia útil, às 20h17 de Brasília (e sob demanda pela aba Actions):

1. `processar.py` baixa só o que falta ou venceu: pregões novos todo dia; fichas e lista da B3, DFP e ITR recentes a cada 7 dias. As fontes ficam no cache do Actions.
2. `historico.py` atualiza o histórico diário da aba Simular. Se falhar, a base sai do mesmo jeito, com o histórico da véspera, e um issue avisa.
3. `resumo.py` publica a edição do resumo em inglês quando um pregão novo entra na base; sem pregão novo, só redesenha `resumo/`. O agendamento do GitHub atrasa umas cinco horas, então o pregão de cada dia sai na madrugada seguinte.
4. `gerar_paginas.py` reescreve as páginas indexáveis (`acao/`) e o sitemap, com as edições do resumo.
5. Testes de regressão.
6. `auditar.py --externo --trava`: se a cobertura cair abaixo de 97%, a base encolher mais de 5% ou surgirem mais de 5 ocorrências graves novas, o job falha e nada é publicado.
7. `mudancas.py` resume o que mudou desde o último commit.
8. Commit de `data/empresas.js`, `data/historico/`, `index.html`, das páginas indexáveis, de `resumo/` e da auditoria; o GitHub Pages publica o commit.
9. Um issue avisa quando há mudanças relevantes ou quando a atualização falha (o GitHub manda por e-mail).
10. Se o segredo `DATABASE_URL` existir, `carregar_base.py` grava a mesma base no Postgres. Se a carga falhar, o site já foi publicado e um issue próprio avisa; nada fica gravado pela metade.
11. Se o segredo `BUTTONDOWN_API_KEY` existir, `resumo.py --enviar` confere a chave e cria a edição nova no Buttondown e commita o registro do envio (veja Newsletter). Roda mesmo se a carga no Postgres falhar; se o envio falhar, um issue avisa.

Os dados trimestrais (ITR) entram nos indicadores de 12 meses: último exercício + acumulado do ano − acumulado do mesmo período do ano anterior.

## Newsletter (Buttondown)

O resumo diário também sai por e-mail pelo [Buttondown](https://buttondown.com) (newsletter `RealTerms`, "Real Terms Daily"), sem script de terceiros no site.

- **Inscrição.** Formulário em HTML puro no fim das páginas de empresa (`acao/`), no arquivo (`resumo/`) e em cada edição. O endereço usa `BUTTONDOWN` em `scripts/gerar_paginas.py`, o nome da newsletter no Buttondown; vazio, as páginas ficam só com o RSS. O campo oculto `metadata__origem` guarda de que página veio a inscrição.
- **Envio.** O passo "Resumo diário por e-mail" do Actions roda `resumo.py --enviar` depois da publicação. Ele confere a chave a cada execução (chave recusada abre um issue no mesmo dia). Ele cria a edição mais recente pela API (`POST /v1/emails`, com a versão da API fixa em `VERSAO_API`) e grava `resumo/<pregão>/envio.json`. Com `ENVIO_AUTOMATICO = False`, a edição entra como rascunho, para conferir no Buttondown, e um issue avisa; com `True`, sai direto para os inscritos.
- **Uma vez só.** Não manda se já existe `envio.json`, se o Buttondown já tem um e-mail com o mesmo assunto (o registro pode não ter chegado ao git) ou se a edição tem mais de 4 dias.
- **Chave.** `BUTTONDOWN_API_KEY` fica nos segredos do repositório (Settings → Secrets and variables → Actions). Sem ela, o passo não roda.

## Base em PostgreSQL

Primeiro passo da Fase 1 de [`docs/arquitetura-comercial.md`](docs/arquitetura-comercial.md): a mesma base do site, agora num Postgres com histórico. O site continua lendo `data/empresas.js`; nada muda para quem usa.

- **Histórico por carga.** Cada atualização é uma carga. Cadastro, tickers, fundamentos, ajustes, preços de fim de exercício e PTAX têm `carga_de`/`carga_ate`: só ganha linha nova o que mudou (uma reapresentação, por exemplo), e qualquer carga passada pode ser remontada. Cotação, valor de mercado e índice ficam em retratos por carga (`retrato_empresa`, `retrato_papel`, `indice`), o que guarda o histórico diário desde a primeira carga.
- **Correções como dado.** Ações estimadas pelo LPA e ações com escala corrigida viram linhas da tabela `ajuste`.
- **Reais, não R$ mil.** Valores monetários são gravados em reais. O catálogo `metrica` diz unidade, natureza (fluxo ou saldo, que decide a PTAX) e nome em português e inglês.
- **Conferência.** Antes de confirmar, o script remonta o JSON a partir do banco e compara campo a campo (188 empresas depois do corte de liquidez). Qualquer diferença desfaz a transação.

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

## Escopo: corte de liquidez

Só entram empresas com volume médio diário (todas as classes, últimos 21 pregões) de **R$ 1 mi ou mais**. Quem já está na base só sai abaixo de **R$ 500 mil**, para não entrar e sair a cada mês por oscilação de volume. Em nov/2026 o corte deixou 188 de 345 empresas, com 99,95% do volume negociado e 96,9% do valor de mercado; abaixo dele ficam papéis que quase não negociam (em geral, ações de controladas e estatais com free float mínimo, como MRSA3B e REDE3), em que preço e múltiplos não são confiáveis e que um investidor estrangeiro não consegue comprar nem vender.

Abaixo do corte, a empresa fica fora de tudo: `processar.py` aplica o corte logo depois do cadastro (`aplicar_corte`, antes de fichas da B3, DFP e ITR), o site e as páginas de `acao/` não a mostram, `auditar.py` mede a cobertura só contra os emissores acima do corte e `carregar_base.py` apaga do Postgres, com o histórico, toda empresa que não está no JSON (`expurgar`). Para aplicar o corte sem a folga (como na primeira vez): `python3 scripts/processar.py --corte-estrito`.

## Fontes

- DFP: https://dados.cvm.gov.br/dados/CIA_ABERTA/DOC/DFP/DADOS/
- FCA (tickers, setor, segmento, controle, negociação no exterior): https://dados.cvm.gov.br/dados/CIA_ABERTA/DOC/FCA/DADOS/
- Cotações: série histórica da B3 (COTAHIST), https://bvmf.bmfbovespa.com.br/InstDados/SerHist/. Arquivos diários a partir de 2018 (último pregão de cada ano e os 21 pregões mais recentes, para preço atual e liquidez); anuais de 2009 a 2017.
- Lista de emissores da B3 (CNPJ, código CVM, raiz do ticker) e ficha de cada emissor (ações ON/PN atuais, proventos com data-com): API pública `sistemaswebb3-listados.b3.com.br`
- PTAX venda diária: API SGS do Banco Central, série 1
- CDI diário (série 12) e IPCA mensal (série 433): API SGS do Banco Central, para a aba Simular
- Proventos em dinheiro desde 2010, para a aba Simular: página de eventos corporativos de cada emissor na mesma API da B3 (`GetListedCashDividends`); a ficha só traz os últimos 12 meses
- Cotações diárias desde 2010 para a aba Simular: arquivos anuais da COTAHIST (os de 2018 em diante são lidos uma vez e guardados resumidos no cache) e os diários recentes

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

- Preços guardados sem ajuste (`precos_ano`). O gráfico e a tabela por ação ajustam pelos eventos de `eventos_acoes` a partir do `ano_preco`; evento que nenhuma fonte mostra, ou ajuste que só corrige a contagem, deixa salto no gráfico. Os múltiplos históricos usam preço e ações na mesma base.
- Valor de mercado atual = ações ON e PN da B3, menos a tesouraria do último balanço, × cotação de cada classe (units divididas pela composição). No histórico, ações da DFP; antes de 2020 a DFP não traz a quantidade e ela é estimada pelo LPA declarado.
- Número de ações (`acoes_cvm`): composição do capital do formulário mais recente entregue à CVM (ITR do trimestre ou DFP), com ON e PN emitidas e as em tesouraria. Usa a mesma correção de escala da série anual; quando DFP e B3 concordam e o ITR difere delas por potência exata de 10, é escala trocada no formulário e é corrigida (BGIP4 e FIEI3 em 2026). Diferença maior que 5% para a B3 aparece na página como aviso: em geral é grupamento, desdobramento ou emissão depois do formulário.
- Ações por ano e métricas por ação: a série `acoes` (fim de cada exercício, sem tesouraria; antes de 2020 estimada pelo LPA declarado, na escala do ano seguinte com quantidade) vai para a base de ações de hoje com `eventos_acoes`, em três fontes, nesta ordem:
  1. ficha da B3 (data "com" e fator), mantido só quando a contagem anual da CVM confirma o salto: folga de 15% de recompra e de emissão no mesmo ano (até 2,5×, ou qualquer tamanho se a contagem andou 2× ou mais no sentido do evento, como na Americanas em 2024). Nos anos estimados pelo LPA o salto pode vir no exercício seguinte; evento de janeiro a abril pode já estar na DFP do ano anterior (IRB, 2023). A ficha também lista eventos que a contagem não mostra (o Itaú tem um grupamento 100:1 em 2011), por isso a confirmação;
  2. LPA reapresentado (`origem: "lpa"`): cada DFP repete o LPA do ano anterior, refeito na base nova quando há desdobramento, grupamento ou bonificação (CPC 41), e emissão não muda esse número. Razão a 1% de um fator usual, confirmada pela contagem, vira evento com o fator exato;
  3. inferência pela contagem (`origem: "contagem"`): salto a 3% de um fator usual (1:2, 1:3… 10:1) que a cotação não desmente vira `ajuste` (Vivo em 2025, CSN Mineração em 2021); salto de 3× ou mais sem explicação, sem cotação ou com ano estimado e valor de mercado impossível, vira `base`: os anos anteriores ficam sem valor por ação (GPS na abertura de capital). Emissão com cotação (Casas Bahia, 2025) fica como está; ano que já tem evento da B3 ou do LPA não é inferido, e o LPA reapresentado igual veta a inferência.
  Cada evento tem `ano` (contagem) e `ano_preco` (primeiro fim de ano cotado na base nova); quando diferem, o valor de mercado daquele ano é refeito com as duas na mesma base. Ajuste sem `ano_preco` corrige só a contagem (erro na estimativa pelo LPA, como a Vale em 2009). Com a quantidade ajustada saem LPA, VPA, dividendo e FCL por ação ano a ano, a variação anual de ações (recompra × diluição), os CAGR de 5 anos de LPA, dividendo por ação e quantidade de ações, e a cotação histórica ajustada. Os eventos que não vieram da B3 aparecem na auditoria como `info`, para conferir.
- Últimos 12 meses só para empresas com exercício de janeiro a dezembro e ITR posterior ao último balanço anual.
- DY 12 meses = proventos com data-com nos últimos 12 meses segundo a ficha da B3. Para quem paga uma vez por ano perto da virada do período, a janela pode pegar zero ou dois pagamentos; o DY do exercício (DFP) fica ao lado para comparar.
- Empresas sem negócio na B3 no último mês ficam sem cotação e múltiplos.
- Bancos e seguradoras têm outro plano de contas, então margens operacionais e dívida ficam em branco.
- O ticker principal é o de maior volume no último mês.
- A quantidade de ações vem sem escala na CVM. O script corrige pelo LPA e pela continuidade entre anos, mas empresas pequenas podem ter erro.

Ferramenta de dados, não recomendação de investimento.
