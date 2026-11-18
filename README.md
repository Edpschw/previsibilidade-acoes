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
| `tests/` | `test_regras.py` (regras com dados sintéticos) e `test_dados.py` (invariantes da base gerada). `python3 -m unittest discover -s tests` |
| `.github/workflows/atualizar.yml` | Atualização diária no GitHub Actions |
| `scripts/sources/` | ZIPs e JSON brutos baixados (fora do git, ~300 MB) |
| `auditoria.md`, `auditoria.json` | Saída da auditoria (regerada a cada execução) |
| `data/empresas.js` | `window.DADOS` com séries anuais em R$ mil, PTAX e índice. Gerado, não edite. |
| `index.html`, `app.js`, `style.css` | Rotas: entrada (`#/`), ranking (`#/acoes`), teia (`#/teia/PETR4,VALE3`; o antigo `#/mapa` cai nela) e página da empresa (`#/PETR4`), com cabeçalho-resumo, selos e navegação por seções. Gráficos em SVG próprio. `app.js` expõe `window.RealTerms` (dados, formatos, textos) para os módulos abaixo. |
| `inicio.js` | Página de entrada em cinco capítulos (o mercado em números, previsibilidade, real × dólar, glossário, três passos), calculada da base. |
| `teia.js` | Gráfico de teia (radar) em SVG: até quatro empresas lado a lado contra a mediana das ações líquidas. Dois conjuntos de eixos: fundamentos (oito indicadores em percentil, com P/L, P/VP e dívida invertidos para que mais para fora seja sempre melhor) e os cinco componentes do índice de previsibilidade. As empresas escolhidas ficam no endereço. |
| `i18n.js` | Textos da interface em português e inglês (seletor PT/EN no topo; o padrão segue o idioma do navegador). Setor em inglês vem da B3; controle, segmento e país têm tradução em `I18N_MAPAS`. |

Depois de editar `app.js` ou `style.css`, rode `python3 scripts/versionar.py` (o processamento já faz isso).

## Automação

O GitHub Actions roda `.github/workflows/atualizar.yml` em todo dia útil, às 20h30 de Brasília (e sob demanda pela aba Actions):

1. `processar.py` baixa só o que falta ou venceu: pregões novos todo dia; fichas e lista da B3, DFP e ITR recentes a cada 7 dias. As fontes ficam no cache do Actions.
2. Testes de regressão.
3. `auditar.py --externo --trava`: se a cobertura cair abaixo de 97%, a base encolher mais de 5% ou surgirem mais de 5 ocorrências graves novas, o job falha e nada é publicado.
4. `mudancas.py` resume o que mudou desde o último commit.
5. Commit de `data/empresas.js`, `index.html` e da auditoria; o GitHub Pages publica o commit.
6. Um issue avisa quando há mudanças relevantes ou quando a atualização falha (o GitHub manda por e-mail).

Os dados trimestrais (ITR) entram nos indicadores de 12 meses: último exercício + acumulado do ano − acumulado do mesmo período do ano anterior.

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
- Últimos 12 meses só para empresas com exercício de janeiro a dezembro e ITR posterior ao último balanço anual.
- DY 12 meses = proventos com data-com nos últimos 12 meses segundo a ficha da B3. Para quem paga uma vez por ano perto da virada do período, a janela pode pegar zero ou dois pagamentos; o DY do exercício (DFP) fica ao lado para comparar.
- Empresas sem negócio na B3 no último mês ficam sem cotação e múltiplos.
- Bancos e seguradoras têm outro plano de contas, então margens operacionais e dívida ficam em branco.
- O ticker principal é o de maior volume no último mês.
- A quantidade de ações vem sem escala na CVM. O script corrige pelo LPA e pela continuidade entre anos, mas empresas pequenas podem ter erro.

Ferramenta de dados, não recomendação de investimento.
