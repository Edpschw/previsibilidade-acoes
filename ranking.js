/* Real Terms — ranking por fundamentos (#/ranking): uma nota de 0 a 100 por empresa, calculada setor a setor.
 *
 * Quatro perguntas que a teoria de análise de ações faz antes de comprar uma ação viram quatro pilares:
 *   Qualidade   — o negócio cria valor? (retorno sobre o capital, margem, caixa, regularidade)
 *   Preço       — quanto se paga por isso? (lucro, patrimônio, EBITDA, caixa livre e dividendos sobre o preço)
 *   Solidez     — o balanço aguenta um ano ruim? (dívida, histórico de lucro, diluição, governança, liquidez)
 *   Futuro      — para onde os números estão indo? Os "indicadores futuros": momento do lucro e da receita,
 *                 tendência da margem, crescimento sustentável, desalavancagem.
 * Cada indicador vira percentil (metade contra os pares do mesmo perfil setorial, metade contra o mercado), cada
 * pilar é a média ponderada dos seus indicadores e a nota soma os pilares com os pesos do perfil setorial. Travas
 * limitam a nota de quem está em recuperação judicial, tem patrimônio negativo, prejuízo ou dívida acima do que o
 * setor suporta. Teoria, referências e todos os parâmetros: docs/metodologia-ranking.md.
 * Métrica quantitativa a partir de dados públicos; não é recomendação de investimento. */
(function () {
  "use strict";

  var K = 0.15;   // custo de capital próprio de referência, em reais (premissa): só no indicador informativo de crescimento embutido
  var IR = 0.34;  // IR + CSLL sobre o EBIT, no retorno sobre o capital investido
  var GOV = { "Novo Mercado": 100, "Nível 2 de Governança Corporativa": 80, "Nível 1 de Governança Corporativa": 60 };  // demais: 40
  var TETO = { rj: 15, plNeg: 25, prejuizo: 40, divida: 50 };

  var PILARES = [
    { id: "q", nome: ["Qualidade", "Quality"], pergunta: ["O negócio cria valor?", "Does the business create value?"] },
    { id: "p", nome: ["Preço", "Price"], pergunta: ["Quanto se paga por isso?", "How much are you paying for it?"] },
    { id: "s", nome: ["Solidez", "Strength"], pergunta: ["O balanço aguenta um ano ruim?", "Can the balance sheet take a bad year?"] },
    { id: "f", nome: ["Futuro", "Outlook"], pergunta: ["Para onde os números estão indo?", "Where are the numbers heading?"] },
  ];

  // ---------------------------------------------------------------- séries (valores da base em R$ mil)

  function fim(e, chave) { var s = e.series[chave]; return s ? s[s.length - 1] : null; }
  /** valor de 12 meses (DFP + ITR) quando existe; senão, o do último exercício */
  function atual(e, chave) { return e.ttm && e.ttm[chave] != null ? e.ttm[chave] : fim(e, chave); }
  function ultimos(e, chave, n) { var s = e.series[chave] || []; return s.slice(Math.max(0, s.length - n)); }
  function clip(v, a, b) { return v == null || !isFinite(v) ? null : Math.max(a, Math.min(b, v)); }
  function finito(v) { return v != null && isFinite(v); }
  function mediana(arr) {
    var a = arr.filter(finito).sort(function (x, y) { return x - y; });
    if (!a.length) return null;
    var m = a.length >> 1;
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  }
  /** 12 meses contra o último exercício; sem ITR, o último exercício contra o anterior */
  function momento(e, chave) {
    var s = e.series[chave], n = s.length;
    if (e.ttm && e.ttm[chave] != null) return { agora: e.ttm[chave], antes: s[n - 1], doze: true };
    return { agora: s[n - 1], antes: n > 1 ? s[n - 2] : null, doze: false };
  }

  // ---------------------------------------------------------------- indicadores
  // sentido: 1 = maior é melhor, -1 = menor é melhor. abs: já vem de 0 a 100 (não vira percentil).
  // nfin: não se aplica a bancos e seguradoras; fin: só para eles. soMercado: comparar só com o mercado.
  // peso: padrão dentro do pilar (os perfis setoriais podem trocar).

  var METRICAS = [
    { id: "q_roe", pilar: "q", peso: 1, sentido: 1, fmt: "pct", nome: ["ROE (retorno sobre o patrimônio)", "ROE (return on equity)"], curto: ["ROE", "ROE"],
      calc: function (e) { var l = atual(e, "lucro_controladora"), p = atual(e, "pl_controladora"); return p > 0 && l != null ? clip(l / p, -1, 1) : null; } },
    { id: "q_roic", pilar: "q", peso: 1.5, sentido: 1, nfin: 1, fmt: "pct", nome: ["ROIC (retorno sobre o capital investido)", "ROIC (return on invested capital)"], curto: ["ROIC", "ROIC"],
      calc: function (e) {
        var eb = atual(e, "ebit"), pl = atual(e, "pl_controladora"), dl = atual(e, "divida_liquida"), cap = (pl || 0) + (dl || 0);
        return eb != null && pl != null && cap > 0 ? clip(eb * (1 - IR) / cap, -0.5, 1) : null;
      } },
    { id: "q_margem", pilar: "q", peso: 1, sentido: 1, nfin: 1, fmt: "pct", nome: ["Margem EBIT", "EBIT margin"], curto: ["margem EBIT", "EBIT margin"],
      calc: function (e) { var eb = atual(e, "ebit"), r = atual(e, "receita"); return eb != null && r > 0 ? clip(eb / r, -1, 1) : null; } },
    { id: "q_caixa", pilar: "q", peso: 1, sentido: 1, nfin: 1, fmt: "x2", nome: ["Conversão do lucro em caixa (3 anos)", "Cash conversion (3 years)"], curto: ["conversão de caixa", "cash conversion"],
      calc: function (e) {
        var f = ultimos(e, "fco", 3), l = ultimos(e, "lucro_liquido", 3), sf = 0, sl = 0, n = 0;
        for (var k = 0; k < f.length; k++) if (f[k] != null && l[k] != null) { sf += f[k]; sl += l[k]; n++; }
        return n >= 2 && sl > 0 ? clip(sf / sl, -2, 3) : null;
      } },
    { id: "q_estab", pilar: "q", peso: 1, abs: 1, fmt: "n", nome: ["Índice de previsibilidade", "Predictability score"], curto: ["previsibilidade", "predictability"],
      calc: function (e, c) { var s = c.score(e); return s ? s.total : null; } },

    { id: "p_ey", pilar: "p", peso: 1.5, sentido: 1, fmt: "pl", nome: ["P/L (lucro sobre o preço)", "P/E (earnings yield)"], curto: ["P/L", "P/E"],
      calc: function (e) { var l = atual(e, "lucro_controladora"); return l != null && e.valor_mercado > 0 ? clip(l / e.valor_mercado, -0.5, 0.5) : null; } },
    { id: "p_eyn", pilar: "p", peso: 0, sentido: 1, fmt: "pl", nome: ["P/L normalizado (margem mediana de 7 anos)", "Normalized P/E (7-year median margin)"], curto: ["P/L normalizado", "normalized P/E"],
      calc: function (e) {
        var r = e.series.receita, l = e.series.lucro_controladora, ms = [];
        for (var k = Math.max(0, r.length - 7); k < r.length; k++) if (r[k] > 0 && l[k] != null) ms.push(l[k] / r[k]);
        var rec = atual(e, "receita");
        return ms.length >= 4 && rec > 0 && e.valor_mercado > 0 ? clip(rec * mediana(ms) / e.valor_mercado, -0.5, 0.5) : null;
      } },
    { id: "p_by", pilar: "p", peso: 0.5, sentido: 1, fmt: "pvp", nome: ["P/VP (patrimônio sobre o preço)", "P/B (book yield)"], curto: ["P/VP", "P/B"],
      calc: function (e) { var p = atual(e, "pl_controladora"); return p != null && e.valor_mercado > 0 ? clip(p / e.valor_mercado, -1, 3) : null; } },
    { id: "p_ev", pilar: "p", peso: 1, sentido: 1, nfin: 1, fmt: "ev", nome: ["EV/EBITDA", "EV/EBITDA"], curto: ["EV/EBITDA", "EV/EBITDA"],
      calc: function (e) {
        var eb = atual(e, "ebitda"), ev = (e.valor_mercado || 0) + (atual(e, "divida_liquida") || 0);
        return eb != null && e.valor_mercado > 0 && ev > 0 ? clip(eb / ev, -0.5, 0.6) : null;
      } },
    { id: "p_fcf", pilar: "p", peso: 1, sentido: 1, nfin: 1, fmt: "pct", nome: ["Caixa livre sobre o valor de mercado (média de 3 anos)", "Free cash flow yield (3-year average)"], curto: ["caixa livre sobre o preço", "free cash flow yield"],
      calc: function (e) {
        var f = ultimos(e, "fco", 3), c = ultimos(e, "capex", 3), soma = 0, n = 0;
        for (var k = 0; k < f.length; k++) if (f[k] != null) { soma += f[k] - (c[k] || 0); n++; }
        return n >= 2 && e.valor_mercado > 0 ? clip(soma / n / e.valor_mercado, -0.5, 0.5) : null;
      } },
    { id: "p_dy", pilar: "p", peso: 1, sentido: 1, fmt: "pct", nome: ["Dividend yield (12 meses)", "Dividend yield (TTM)"], curto: ["dividend yield", "dividend yield"],
      calc: function (e) {
        var vm = e.valor_mercado;
        if (!(vm > 0)) return null;
        if (e.proventos_12m != null) return clip(e.proventos_12m / vm, 0, 0.4);
        var d = fim(e, "dividendos_pagos");
        return d != null ? clip(d / vm, 0, 0.4) : null;
      } },

    { id: "s_div", pilar: "s", peso: 2, sentido: -1, nfin: 1, fmt: "alav", nome: ["Dívida líquida/EBITDA", "Net debt/EBITDA"], curto: ["dívida/EBITDA", "net debt/EBITDA"],
      calc: function (e) {
        var dl = atual(e, "divida_liquida"), eb = atual(e, "ebitda");
        if (dl == null) return null;
        if (eb > 0) return clip(dl / eb, -3, 15);
        return dl <= 0 ? -3 : 15;  // EBITDA zero ou negativo: com caixa líquido é o melhor caso; com dívida, o pior
      } },
    { id: "s_dpl", pilar: "s", peso: 0.5, sentido: -1, nfin: 1, fmt: "alavpl", nome: ["Dívida líquida/patrimônio", "Net debt/equity"], curto: ["dívida/patrimônio", "net debt/equity"],
      calc: function (e) {
        var dl = atual(e, "divida_liquida"), pl = atual(e, "pl_controladora");
        if (dl == null || pl == null) return null;
        return pl > 0 ? clip(dl / pl, -2, 5) : 5;
      } },
    { id: "s_cap", pilar: "s", peso: 1, sentido: 1, fin: 1, fmt: "pct", nome: ["Patrimônio sobre ativos (capital)", "Equity to assets (capital)"], curto: ["capital", "capital"],
      calc: function (e) { var p = atual(e, "pl"), a = atual(e, "ativo_total"); return p != null && a > 0 ? clip(p / a, -0.2, 0.6) : null; } },
    { id: "s_lucro", pilar: "s", peso: 1, abs: 1, fmt: "anos", nome: ["Anos com lucro (últimos 10)", "Profitable years (last 10)"], curto: ["anos com lucro", "profitable years"],
      calc: function (e) {
        var l = ultimos(e, "lucro_liquido", 10).filter(finito);
        return l.length >= 3 ? 100 * l.filter(function (v) { return v > 0; }).length / l.length : null;
      } },
    { id: "s_gov", pilar: "s", peso: 0.5, abs: 1, fmt: "gov", nome: ["Governança (segmento de listagem na B3)", "Governance (B3 listing segment)"], curto: ["governança", "governance"],
      calc: function (e) { return GOV[e.segmento] || 40; } },
    { id: "s_liq", pilar: "s", peso: 0.5, sentido: 1, soMercado: 1, fmt: "liq", nome: ["Liquidez (volume médio diário)", "Liquidity (average daily volume)"], curto: ["liquidez", "liquidity"],
      calc: function (e) { return e.liquidez > 0 ? e.liquidez : null; } },

    { id: "f_mom", pilar: "f", peso: 1.5, sentido: 1, fmt: "var", nome: ["Momento do lucro", "Earnings momentum"], curto: ["lucro recente", "recent earnings"],
      calc: function (e) {
        var m = momento(e, "lucro_controladora");
        if (m.agora == null || m.antes == null) return null;
        if (m.antes > 0) return m.agora > 0 ? clip(m.agora / m.antes - 1, -1, 1) : -1;
        if (m.agora > 0) return 1;  // saiu do prejuízo
        return clip((m.agora - m.antes) / (Math.abs(m.antes) || 1), -1, 1);  // prejuízo menor (+) ou maior (−)
      } },
    { id: "f_rec", pilar: "f", peso: 0.5, sentido: 1, fmt: "var", nome: ["Momento da receita", "Revenue momentum"], curto: ["receita recente", "recent revenue"],
      calc: function (e) { var m = momento(e, "receita"); return m.agora != null && m.antes > 0 ? clip(m.agora / m.antes - 1, -0.5, 0.5) : null; } },
    { id: "f_marg", pilar: "f", peso: 1, sentido: 1, fmt: "pp", nome: ["Tendência da margem líquida (contra a mediana de 5 anos)", "Net margin trend (vs. 5-year median)"], curto: ["margem", "margin"],
      calc: function (e) {
        var r = e.series.receita, l = e.series.lucro_liquido, n = r.length, agora, ate = n, hist = [];
        if (e.ttm && e.ttm.receita > 0 && e.ttm.lucro_liquido != null) agora = e.ttm.lucro_liquido / e.ttm.receita;
        else if (r[n - 1] > 0 && l[n - 1] != null) { agora = l[n - 1] / r[n - 1]; ate = n - 1; }
        else return null;
        for (var k = Math.max(0, ate - 5); k < ate; k++) if (r[k] > 0 && l[k] != null) hist.push(l[k] / r[k]);
        return hist.length >= 3 ? clip(agora - mediana(hist), -0.3, 0.3) : null;
      } },
    { id: "f_gs", pilar: "f", peso: 1, sentido: 1, fmt: "aa", nome: ["Crescimento sustentável (ROE × lucro retido)", "Sustainable growth (ROE × retention)"], curto: ["crescimento sustentável", "sustainable growth"],
      calc: function (e) {
        var l = atual(e, "lucro_controladora"), p = atual(e, "pl_controladora");
        if (l == null || !(p > 0)) return null;
        if (l <= 0) return clip(l / p, -0.3, 0.4);
        var d = e.ttm && e.ttm.dividendos_pagos != null ? e.ttm.dividendos_pagos : fim(e, "dividendos_pagos");
        return d == null ? null : clip(l / p * (1 - clip(d / l, 0, 1)), -0.3, 0.4);
      } },
    { id: "f_desal", pilar: "f", peso: 1, sentido: 1, nfin: 1, fmt: "desal", nome: ["Desalavancagem (queda da dívida/EBITDA no último ano)", "Deleveraging (drop in net debt/EBITDA over the last year)"], curto: ["alavancagem", "leverage"],
      calc: function (e) {
        var dl = e.series.divida_liquida, eb = e.series.ebitda, n = dl.length, agora, antes;
        var razao = function (a, b) { return a != null && b > 0 ? a / b : null; };
        if (e.ttm && e.ttm.ebitda != null && e.ttm.divida_liquida != null) { agora = [e.ttm.divida_liquida, e.ttm.ebitda]; antes = [dl[n - 1], eb[n - 1]]; }
        else { agora = [dl[n - 1], eb[n - 1]]; antes = n > 1 ? [dl[n - 2], eb[n - 2]] : [null, null]; }
        var ra = razao(antes[0], antes[1]), rn = razao(agora[0], agora[1]);
        if (ra == null) return null;
        if (rn == null) return agora[0] > 0 ? -3 : null;  // EBITDA sumiu com dívida: piora máxima
        return clip(ra - rn, -3, 3);
      } },
    { id: "f_cagr", pilar: "f", peso: 0.5, sentido: 1, fmt: "aa", nome: ["Crescimento da receita (5 anos, ao ano)", "Revenue growth (5-year CAGR)"], curto: ["receita em 5 anos", "5-year revenue growth"],
      calc: function (e, c) { return clip(c.cagrRec(e), -0.3, 0.5); } },
  ];
  var METRICA = {};
  METRICAS.forEach(function (m) { METRICA[m.id] = m; });

  // ---------------------------------------------------------------- perfis setoriais
  // Cada segmento da B3 (setor_b3) cai num perfil, com pesos dos pilares, pesos próprios de indicadores
  // (metr; o que não está lá usa o peso padrão), limite de dívida para a trava e o texto da metodologia.

  var PERFIS = [
    { id: "financeiro", nome: ["Bancos e serviços financeiros", "Banks and financial services"], curto: ["Bancos e financeiras", "Banks & financials"],
      segs: ["Bancos", "Serviços Financeiros Diversos", "Intermediários Financeiros", "Gestão de Recursos e Investimentos", "Securitizadoras de Recebíveis", "Sociedades de Crédito e Financiamento", "Soc. Crédito e Financiamento", "Intermediação Financeira"],
      pesos: { q: 30, p: 30, s: 15, f: 25 }, limite: { tipo: "ebitda", valor: 3.5 },
      metr: { q_roe: 2, q_estab: 1.5, p_ey: 1.5, p_by: 1.5, p_dy: 1, s_cap: 2, s_lucro: 2, f_mom: 1.5, f_gs: 1.5, f_rec: 0, f_marg: 0.5, f_cagr: 0.5 },
      valor: ["Um banco vale pelo retorno que tira do patrimônio (ROE) acima do custo de capital, ano após ano. Por isso o P/VP justo cresce com o ROE: P/VP ≈ (ROE − g) ÷ (k − g). Banco não tem EBITDA nem dívida no sentido usual: o dinheiro captado é a matéria-prima.",
        "A bank is worth the return it earns on equity (ROE) above its cost of capital, year after year. That is why fair P/B rises with ROE: P/B ≈ (ROE − g) ÷ (k − g). Banks have no EBITDA or debt in the usual sense: borrowed money is their raw material."],
      pontos: [
        ["ROE recorrente e sua estabilidade ao longo do ciclo de crédito.", "Recurring ROE and how steady it is through the credit cycle."],
        ["Qualidade da carteira: inadimplência acima de 90 dias, cobertura de provisões e custo do crédito (nos releases trimestrais; não estão nos dados padronizados da CVM).", "Loan book quality: 90-day delinquency, provision coverage and cost of risk (in quarterly releases; not in the CVM's standardized data)."],
        ["Capital: índice de Basileia e capital principal definem quanto o banco pode crescer e distribuir.", "Capital: Basel and CET1 ratios set how much the bank can grow and pay out."],
        ["Eficiência (despesas sobre receitas) e mix de receitas: tarifas e seguros são mais estáveis que a margem com crédito.", "Efficiency (costs over revenue) and revenue mix: fees and insurance are steadier than lending margins."],
        ["Custo e estabilidade da captação; sensibilidade da margem à Selic.", "Cost and stability of funding; how margins react to the Selic rate."],
        ["Payout e JCP: quanto do lucro volta ao acionista.", "Payout and interest on equity: how much of earnings goes back to shareholders."],
      ],
      futuro: [
        ["Selic e desemprego, que guiam a inadimplência e o custo do crédito.", "The Selic rate and unemployment, which drive delinquency and credit costs."],
        ["Crescimento da carteira e projeções de provisão.", "Loan growth and provisioning guidance."],
        ["Provisão por perda esperada (Resolução CMN 4.966, em vigor desde 2025) e mudanças nas regras de capital.", "Expected-loss provisioning (CMN Resolution 4,966, in force since 2025) and capital rule changes."],
      ],
      nota: ["Dívida/EBITDA, ROIC e caixa livre não se aplicam a bancos; pesam ROE, regularidade do lucro, P/L, P/VP e dividendos. Sem o índice de Basileia nos dados padronizados, a solidez usa patrimônio sobre ativos, a medida mais simples de alavancagem de um banco. Empresas não financeiras do grupo (bolsa, meios de pagamento) recebem os indicadores gerais.",
        "Net debt/EBITDA, ROIC and free cash flow do not apply to banks; ROE, earnings consistency, P/E, P/B and dividends carry the weight. With no Basel ratio in the standardized data, strength uses equity to assets, the simplest measure of a bank's leverage. Non-financial members (exchange, payments) get the general indicators."] },

    { id: "seguros", nome: ["Seguros e previdência", "Insurance"], curto: ["Seguros", "Insurance"],
      segs: ["Seguradoras", "Resseguradoras", "Corretoras de Seguros e Resseguros", "Corretoras de Seguros", "Previdência e Seguros"],
      pesos: { q: 30, p: 35, s: 10, f: 25 }, limite: { tipo: "ebitda", valor: 3.5 },
      metr: { q_roe: 2, q_estab: 1.5, p_ey: 1, p_by: 1, p_dy: 2, s_cap: 1.5, s_lucro: 2, f_mom: 1.5, f_gs: 1, f_marg: 0.5, f_rec: 0.5 },
      valor: ["A seguradora ganha duas vezes: na operação (prêmios menos sinistros e despesas) e na aplicação das reservas, o float. Selic alta infla o resultado financeiro; quando ela cai, sobra o que a operação entrega. Costumam distribuir quase todo o lucro.",
        "An insurer earns twice: on underwriting (premiums minus claims and expenses) and on investing its reserves, the float. A high Selic rate inflates investment income; when it falls, what is left is underwriting. Insurers usually pay out most of their earnings."],
      pontos: [
        ["Índice combinado (sinistros mais despesas sobre prêmios ganhos): abaixo de 100%, a operação dá lucro.", "Combined ratio (claims plus expenses over earned premiums): below 100%, underwriting is profitable."],
        ["Peso do resultado financeiro no lucro e sensibilidade à Selic.", "Share of investment income in earnings and sensitivity to the Selic rate."],
        ["Canais de venda: quem vende pela agência de um banco depende do acordo de distribuição e do seu prazo.", "Distribution: insurers that sell through a bank's branches depend on the distribution agreement and its term."],
        ["ROE, payout e solvência (capital mínimo exigido pela Susep).", "ROE, payout and solvency (Susep capital requirements)."],
      ],
      futuro: [
        ["Trajetória da Selic.", "The path of the Selic rate."],
        ["Renovação dos acordos de distribuição e crescimento dos prêmios.", "Renewal of distribution agreements and premium growth."],
        ["Eventos climáticos e catástrofes (resseguro e seguro rural).", "Weather events and catastrophes (reinsurance and crop insurance)."],
      ],
      nota: ["Como nos bancos, sem dívida/EBITDA e com patrimônio sobre ativos na solidez; dividendos pesam mais, porque o retorno ao acionista vem sobretudo deles.",
        "As with banks, no net debt/EBITDA and equity to assets for strength; dividends weigh more, since most of the shareholder return comes from them."] },

    { id: "utilities", nome: ["Energia, saneamento e gás", "Power, water and gas utilities"], curto: ["Energia e saneamento", "Utilities"],
      segs: ["Energia Elétrica", "Água e Saneamento", "Gás", "Saneamento, Serv. Água e Gás"],
      pesos: { q: 20, p: 35, s: 30, f: 15 }, limite: { tipo: "ebitda", valor: 5 },
      metr: { q_estab: 2, q_roic: 1.5, q_roe: 1, q_margem: 0.5, p_dy: 2, p_ev: 1.5, p_ey: 1, p_fcf: 0.5, p_by: 0.5, s_div: 2, s_gov: 1, f_desal: 1.5, f_mom: 1, f_marg: 0.5, f_gs: 0.5 },
      valor: ["Receita regulada ou contratada e corrigida pela inflação: o valor está na previsibilidade do caixa e em quanto dele chega ao acionista. Comportam-se como títulos longos, que sobem quando os juros reais caem, e toleram mais dívida que a média.",
        "Regulated or contracted revenue indexed to inflation: value lies in predictable cash flow and how much of it reaches shareholders. They behave like long bonds, rising when real rates fall, and can carry more debt than average."],
      pontos: [
        ["Tipo de negócio: transmissão (receita anual permitida, pouco risco), distribuição (revisão tarifária, perdas e inadimplência), geração (preço dos contratos e risco hidrológico), saneamento (metas de universalização).", "Business type: transmission (allowed annual revenue, low risk), distribution (tariff reviews, losses and bad debt), generation (contract prices and hydrology risk), water (universal-service targets)."],
        ["Indexação dos contratos (IPCA ou IGP-M) e retorno regulatório frente ao custo de capital.", "Contract indexation (IPCA or IGP-M) and allowed return versus cost of capital."],
        ["Alavancagem: dívida de 3 a 4 vezes o EBITDA é comum por causa da estabilidade; acima disso, o investimento obrigatório disputa caixa com os dividendos.", "Leverage: 3 to 4 times EBITDA is common thanks to stable cash flow; above that, mandatory capex competes with dividends."],
        ["Investimento obrigatório: no saneamento, as metas de 2033 do Marco Legal (Lei 14.026/2020).", "Mandatory capex: in water, the 2033 targets of the sanitation framework (Law 14,026/2020)."],
        ["Risco político: tarifas e dividendos de estatais.", "Political risk: tariffs and dividends at state-owned companies."],
      ],
      futuro: [
        ["Calendário de revisões tarifárias e renovações de concessões.", "Tariff review calendar and concession renewals."],
        ["Juros reais (NTN-B) e inflação.", "Real interest rates (NTN-B) and inflation."],
        ["Hidrologia e preço da energia no mercado de curto prazo (PLD).", "Hydrology and spot power prices (PLD)."],
      ],
      nota: ["Preço (dividendos e EV/EBITDA) e solidez somam 65% da nota; a trava de dívida só entra acima de 5 vezes o EBITDA.",
        "Price (dividends and EV/EBITDA) and strength make up 65% of the score; the debt cap only applies above 5 times EBITDA."] },

    { id: "commodities", nome: ["Commodities: petróleo, mineração, siderurgia, papel e química", "Commodities: oil, mining, steel, pulp and chemicals"], curto: ["Commodities", "Commodities"], ciclico: 1,
      segs: ["Exploração, Refino e Distribuição", "Equipamentos e Serviços", "Distribuição de Combustíveis", "Minerais Metálicos", "Minerais Não Metálicos", "Siderurgia", "Artefatos de Cobre", "Artefatos de Ferro e Aço", "Papel e Celulose", "Embalagens", "Petroquímicos", "Químicos Diversos", "Fertilizantes e Defensivos", "Petróleo e Gás", "Extração Mineral", "Metalurgia e Siderurgia", "Petroquímicos e Borracha"],
      pesos: { q: 20, p: 30, s: 30, f: 20 }, limite: { tipo: "ebitda", valor: 3 },
      metr: { q_roic: 1.5, q_margem: 0.5, q_caixa: 1, q_estab: 0.5, p_eyn: 1.5, p_ey: 0.5, p_ev: 1.5, p_fcf: 1, p_dy: 0.5, p_by: 0.5, s_div: 2.5, s_dpl: 1, f_desal: 1.5, f_mom: 1, f_marg: 0.5, f_gs: 0.5, f_cagr: 0 },
      valor: ["O lucro segue o preço da commodity e o câmbio, que a empresa não controla. No pico do ciclo o P/L parece baixo justamente porque o lucro está no alto; no vale, parece caro. O que diferencia as empresas é o custo de produção, um balanço que atravesse o vale e a disciplina com o caixa.",
        "Earnings follow the commodity price and the exchange rate, which the company does not control. At the top of the cycle the P/E looks low precisely because earnings are high; at the bottom it looks expensive. What sets companies apart is production cost, a balance sheet that survives the trough and discipline with cash."],
      pontos: [
        ["Posição na curva de custo: custo caixa por barril ou tonelada frente aos concorrentes globais.", "Position on the cost curve: cash cost per barrel or ton against global peers."],
        ["Lucro normalizado: a margem média de um ciclo inteiro, não a do ano.", "Normalized earnings: the average margin over a full cycle, not this year's."],
        ["Balanço: dívida baixa no pico, porque o EBITDA encolhe no vale.", "Balance sheet: low debt at the top, because EBITDA shrinks at the bottom."],
        ["Alocação de capital: investimentos frente a dividendos e recompras; reservas e vida útil dos ativos (petróleo e mineração).", "Capital allocation: capex versus dividends and buybacks; reserves and asset life (oil and mining)."],
        ["Específicos: política de preços e royalties (petróleo), spreads e aço importado (siderurgia), preço da celulose e câmbio (papel), spread da nafta (química).", "Specifics: pricing policy and royalties (oil), spreads and imported steel (steel), pulp price and FX (pulp), naphtha spreads (chemicals)."],
      ],
      futuro: [
        ["Demanda da China (minério, aço, celulose) e preço do Brent.", "Chinese demand (iron ore, steel, pulp) and Brent crude."],
        ["Câmbio: receita em dólar, parte dos custos em reais.", "Exchange rate: revenue in dollars, part of costs in reais."],
        ["Projeções de produção e custo; capacidade nova no mundo.", "Production and cost guidance; new global capacity."],
      ],
      nota: ["Preço medido também pelo lucro normalizado (receita de 12 meses × margem mediana dos últimos 7 exercícios) e pelo EV/EBITDA; solidez pesa 30% e a trava de dívida entra acima de 3 vezes o EBITDA.",
        "Price also uses normalized earnings (trailing revenue × median margin of the last 7 fiscal years) and EV/EBITDA; strength weighs 30% and the debt cap applies above 3 times EBITDA."] },

    { id: "agro", nome: ["Agronegócio e alimentos", "Agribusiness and food"], curto: ["Agro e alimentos", "Agri & food"], ciclico: 1,
      segs: ["Agricultura", "Carnes e Derivados", "Açúcar e Álcool", "Alimentos Diversos", "Grãos e Derivados", "Laticínios", "Agricultura (Açúcar, Álcool e Cana)"],
      pesos: { q: 25, p: 30, s: 25, f: 20 }, limite: { tipo: "ebitda", valor: 3.5 },
      metr: { q_roic: 1.5, q_caixa: 1, q_estab: 1, q_margem: 0.5, p_eyn: 1, p_ey: 1, p_ev: 1, p_fcf: 1, p_dy: 0.5, p_by: 0.5, s_div: 2, s_dpl: 0.5, f_mom: 1, f_desal: 1, f_marg: 0.5, f_gs: 0.5, f_cagr: 0.5 },
      valor: ["Margens dependem de preços agrícolas (grãos, boi, açúcar e etanol), do clima e do câmbio. Os ciclos são menos extremos que os do minério, mas existem: frigoríficos vivem de spread, produtores de terra e produtividade, e a indústria de alimentos de marca e custo de matéria-prima.",
        "Margins depend on farm prices (grains, cattle, sugar and ethanol), weather and the exchange rate. Cycles are milder than iron ore's but real: meatpackers live on spreads, farmers on land and yields, and food processors on brands and input costs."],
      pontos: [
        ["Ciclo do boi e spread das carnes; abertura de mercados e questões sanitárias na exportação.", "The cattle cycle and meat spreads; market access and sanitary issues for exports."],
        ["Açúcar e etanol: preço internacional do açúcar, paridade do etanol com a gasolina e produtividade da cana.", "Sugar and ethanol: world sugar prices, ethanol parity with gasoline and cane yields."],
        ["Terras: valor de mercado das fazendas frente ao valor da empresa.", "Land: market value of the farmland against the company's value."],
        ["Capital de giro e estoques, que consomem caixa em safras cheias.", "Working capital and inventories, which absorb cash in big harvests."],
        ["Alavancagem e moeda da dívida.", "Leverage and the currency of debt."],
      ],
      futuro: [
        ["Clima e safra (El Niño, La Niña) e preços internacionais.", "Weather and harvests (El Niño, La Niña) and world prices."],
        ["Câmbio e política de biocombustíveis (mistura obrigatória de etanol e biodiesel).", "Exchange rate and biofuel policy (mandatory ethanol and biodiesel blends)."],
        ["Ciclo pecuário e custo da ração.", "The cattle cycle and feed costs."],
      ],
      nota: ["Mistura o lucro corrente com o normalizado, por ser setor cíclico; solidez pesa 25%.",
        "Blends current and normalized earnings, since the sector is cyclical; strength weighs 25%."] },

    { id: "varejo", nome: ["Varejo e consumo", "Retail and consumer"], curto: ["Varejo e consumo", "Retail & consumer"],
      segs: ["Produtos Diversos", "Tecidos, Vestuário e Calçados", "Eletrodomésticos", "Calçados", "Alimentos", "Cervejas e Refrigerantes", "Produtos de Uso Pessoal", "Produtos de Limpeza", "Vestuário", "Acessórios", "Atividades Esportivas", "Viagens e Turismo", "Hotelaria", "Restaurantes e Similares", "Utensílios Domésticos", "Bicicletas", "Brinquedos e Jogos", "Produção de Eventos e Shows", "Bebidas", "Comércio (Atacado e Varejo)", "Têxtil e Vestuário"],
      pesos: { q: 30, p: 25, s: 20, f: 25 }, limite: { tipo: "ebitda", valor: 3 },
      metr: { q_roic: 2, q_margem: 1, q_caixa: 1.5, q_estab: 1, p_ey: 1.5, p_ev: 1, p_fcf: 1, p_dy: 0.5, p_by: 0.5, s_div: 2, f_mom: 1.5, f_rec: 1, f_marg: 1, f_cagr: 1, f_gs: 0.5, f_desal: 0.5 },
      valor: ["Vale quem cresce com retorno: vende mais sem perder margem e sem prender caixa em estoques e recebíveis. Juros altos pesam duas vezes, porque encarecem o crediário do cliente e a dívida da empresa.",
        "Value comes from growth with returns: selling more without losing margin or tying up cash in inventory and receivables. High rates hurt twice, raising both consumer credit costs and the company's own debt."],
      pontos: [
        ["Vendas nas mesmas lojas e abertura de lojas; participação do digital.", "Same-store sales and new stores; online share."],
        ["Margem bruta e despesas; ROIC acima do custo de capital.", "Gross margin and expenses; ROIC above the cost of capital."],
        ["Capital de giro: dias de estoque e prazos de recebíveis e de fornecedores.", "Working capital: inventory days, receivable and payable terms."],
        ["Dívida completa, incluindo antecipação de recebíveis e risco sacado (o caso Americanas, de 2023, começou aí).", "Full debt, including receivable discounting and supplier finance (the Americanas case in 2023 started there)."],
        ["Força da marca e concorrência de plataformas estrangeiras.", "Brand strength and competition from foreign platforms."],
      ],
      futuro: [
        ["Juros, renda e emprego das famílias.", "Interest rates, household income and jobs."],
        ["Inflação de alimentos (supermercados) e câmbio (importados).", "Food inflation (grocers) and the exchange rate (imported goods)."],
        ["Datas fortes do varejo (Black Friday, Natal) e planos de abertura de lojas.", "Peak retail dates (Black Friday, Christmas) and store opening plans."],
      ],
      nota: ["Qualidade (ROIC e conversão de caixa) pesa 30% e futuro 25%; dívida acima de 3 vezes o EBITDA trava a nota.",
        "Quality (ROIC and cash conversion) weighs 30% and outlook 25%; debt above 3 times EBITDA caps the score."] },

    { id: "incorporacao", nome: ["Incorporação e construção", "Homebuilders and construction"], curto: ["Construção", "Homebuilders"],
      segs: ["Incorporações", "Construção Pesada", "Engenharia Consultiva", "Construção Civil, Mat. Constr. e Decoração"],
      pesos: { q: 25, p: 30, s: 25, f: 20 }, limite: { tipo: "pl", valor: 1 },
      metr: { q_roe: 2, q_roic: 0.5, q_margem: 1, q_caixa: 0.5, q_estab: 1, p_ey: 1.5, p_by: 1.5, p_dy: 1, p_ev: 0, p_fcf: 0.5, s_div: 0.5, s_dpl: 2, f_mom: 1.5, f_rec: 1, f_marg: 1, f_gs: 1, f_desal: 0 },
      valor: ["A construtora vende na planta e recebe ao longo da obra; o lucro contábil, reconhecido pelo avanço da obra, chega antes do caixa. Vale pelo patrimônio e pelo ROE que tira dele, e sofre quando os juros sobem.",
        "Homebuilders sell off-plan and collect during construction; accounting profit, booked as work progresses, arrives before cash. They are worth their book value and the ROE earned on it, and suffer when rates rise."],
      pontos: [
        ["Lançamentos e velocidade de vendas; distratos.", "Launches and sales speed; cancellations."],
        ["Margem bruta e banco de terrenos.", "Gross margin and land bank."],
        ["Dívida líquida sobre patrimônio (o EBITDA engana quando o lucro segue o avanço da obra) e geração de caixa.", "Net debt to equity (EBITDA misleads when profit follows construction progress) and cash generation."],
        ["Segmento: baixa renda, com recursos do FGTS e do Minha Casa, Minha Vida, ou média e alta renda, dependente da poupança e dos juros.", "Segment: low income, funded by the FGTS and the Minha Casa, Minha Vida programme, or middle and high income, tied to savings deposits and rates."],
      ],
      futuro: [
        ["Juros e oferta de crédito imobiliário (poupança/SBPE e FGTS).", "Rates and mortgage funding (savings deposits/SBPE and FGTS)."],
        ["INCC (custo da obra) e política habitacional.", "INCC (construction costs) and housing policy."],
        ["Prévias trimestrais de lançamentos e vendas.", "Quarterly launch and sales previews."],
      ],
      nota: ["Preço por P/L e P/VP; solidez pela dívida líquida sobre o patrimônio, com trava quando a dívida passa do patrimônio.",
        "Price by P/E and P/B; strength by net debt to equity, capped when debt exceeds equity."] },

    { id: "renda", nome: ["Shoppings e renda imobiliária", "Malls and property income"], curto: ["Shoppings e renda", "Malls & property"],
      segs: ["Exploração de Imóveis", "Intermediação Imobiliária"],
      pesos: { q: 20, p: 35, s: 30, f: 15 }, limite: { tipo: "ebitda", valor: 6 },
      metr: { q_roic: 1, q_margem: 1.5, q_estab: 1.5, q_roe: 0.5, p_dy: 2, p_by: 1, p_ev: 1.5, p_ey: 0.5, p_fcf: 1, s_div: 1.5, s_dpl: 1.5, f_mom: 1, f_desal: 1, f_rec: 1, f_marg: 0.5, f_cagr: 0.5 },
      valor: ["Imóveis alugados geram renda estável e corrigida pela inflação; o portfólio vale a renda líquida (NOI) dividida pela taxa de capitalização (cap rate). Como os títulos longos, sobe quando os juros reais caem.",
        "Leased property produces steady, inflation-linked income; a portfolio is worth its net operating income (NOI) divided by the cap rate. Like long bonds, it rises when real rates fall."],
      pontos: [
        ["NOI, margem e reajuste dos aluguéis nas mesmas lojas.", "NOI, margin and same-store rent growth."],
        ["Vacância e inadimplência dos lojistas; vendas por metro quadrado.", "Vacancy and tenant defaults; sales per square metre."],
        ["Cap rate implícito no preço frente aos juros reais.", "Cap rate implied by the share price against real rates."],
        ["Reciclagem de portfólio: vender ativos acima do valor contábil sinaliza desconto na ação.", "Portfolio recycling: asset sales above book value signal a discount in the shares."],
      ],
      futuro: [
        ["Juros reais e inflação (reajustes por IGP-M ou IPCA).", "Real rates and inflation (IGP-M or IPCA rent resets)."],
        ["Vendas do varejo físico e transações de ativos no mercado.", "Brick-and-mortar sales and asset deals in the market."],
      ],
      nota: ["Dividendos e EV/EBITDA lideram o preço; solidez pesa 30%, com tolerância maior de dívida (até 6 vezes o EBITDA).",
        "Dividends and EV/EBITDA lead price; strength weighs 30%, with more room for debt (up to 6 times EBITDA)."] },

    { id: "industria", nome: ["Indústria e bens de capital", "Industrials and capital goods"], curto: ["Indústria", "Industrials"],
      segs: ["Material Rodoviário", "Máq. e Equip. Industriais", "Máquinas e Equipamentos Industriais", "Máq. e Equip. Construção e Agrícolas", "Motores, Compressores e Outros", "Automóveis e Motocicletas", "Material Aeronáutico e de Defesa", "Material Ferroviário", "Armas e Munições", "Serviços Diversos", "Madeira", "Produtos para Construção", "Equipamentos Elétricos", "Máquinas, Equipamentos, Veículos e Peças", "Máqs., Equip., Veíc. e Peças"],
      pesos: { q: 30, p: 25, s: 20, f: 25 }, limite: { tipo: "ebitda", valor: 3.5 },
      metr: { q_roic: 1.5, q_margem: 1, q_caixa: 1, q_estab: 1, p_ey: 1.5, p_ev: 1, p_fcf: 1, p_dy: 0.5, p_by: 0.5, s_div: 2, f_mom: 1.5, f_rec: 0.5, f_marg: 1, f_gs: 1, f_desal: 1, f_cagr: 0.5 },
      valor: ["Vale a capacidade de transformar ciclos de investimento em pedidos com margem. Exportação e câmbio pesam; o retorno sobre o capital mostra se a empresa cria valor ou só acompanha o ciclo.",
        "Value lies in turning investment cycles into profitable orders. Exports and the exchange rate matter; return on capital shows whether the company creates value or just rides the cycle."],
      pontos: [
        ["Carteira de pedidos e entrada de pedidos sobre faturamento (nos releases; não padronizados na CVM).", "Order backlog and book-to-bill (in releases; not standardized at the CVM)."],
        ["ROIC e margem EBIT ao longo do ciclo.", "ROIC and EBIT margin through the cycle."],
        ["Capital de giro e conversão do lucro em caixa.", "Working capital and cash conversion."],
        ["Exposição ao exterior e ao câmbio; ciclos de caminhões, máquinas agrícolas e construção.", "Foreign and FX exposure; truck, farm machinery and construction cycles."],
      ],
      futuro: [
        ["Investimento na economia, produção de veículos e safra.", "Business investment, vehicle output and harvests."],
        ["Câmbio e juros.", "Exchange rate and interest rates."],
        ["Entrada de pedidos no trimestre.", "Quarterly order intake."],
      ],
      nota: ["Pesos equilibrados, com qualidade em 30%; trava de dívida acima de 3,5 vezes o EBITDA.",
        "Balanced weights, with quality at 30%; debt cap above 3.5 times EBITDA."] },

    { id: "transporte", nome: ["Transporte, logística e concessões", "Transport, logistics and concessions"], curto: ["Transporte", "Transport"],
      segs: ["Exploração de Rodovias", "Aluguel de carros", "Transporte Rodoviário", "Transporte Aéreo", "Transporte Ferroviário", "Transporte Hidroviário", "Serviços de Apoio e Armazenagem", "Serviços Transporte e Logística"],
      pesos: { q: 20, p: 25, s: 35, f: 20 }, limite: { tipo: "ebitda", valor: 4.5 },
      metr: { q_roic: 1.5, q_margem: 1, q_estab: 1, q_caixa: 0.5, p_ev: 2, p_ey: 1, p_fcf: 0.5, p_dy: 0.5, p_by: 0.5, s_div: 2.5, s_dpl: 1, f_desal: 1.5, f_mom: 1, f_rec: 0.5, f_marg: 0.5, f_gs: 0.5 },
      valor: ["Negócios intensivos em capital e financiados com dívida: o valor depende de investir com retorno acima do custo da dívida e de manter o balanço de pé quando os juros sobem.",
        "Capital-intensive businesses funded with debt: value depends on investing at returns above the cost of debt and keeping the balance sheet intact when rates rise."],
      pontos: [
        ["Alavancagem, custo da dívida (CDI mais spread) e prazo dos vencimentos.", "Leverage, cost of debt (CDI plus spread) and maturity profile."],
        ["ROIC frente ao custo da dívida.", "ROIC against the cost of debt."],
        ["Concessões: prazo restante, reajustes e reequilíbrio econômico-financeiro.", "Concessions: remaining term, tariff resets and contractual rebalancing."],
        ["Locadoras: preço do carro usado, depreciação e custo de compra da frota; aéreas: combustível e câmbio.", "Car rental: used-car prices, depreciation and fleet costs; airlines: fuel and the exchange rate."],
      ],
      futuro: [
        ["Selic e CDI (custo da dívida).", "Selic and CDI (cost of debt)."],
        ["Leilões e renovações de concessões; volume de carga e safra.", "Concession auctions and renewals; freight volumes and harvests."],
        ["Preço de carros novos e usados.", "New and used car prices."],
      ],
      nota: ["Solidez é o pilar mais pesado (35%); preço pelo EV/EBITDA; trava de dívida acima de 4,5 vezes o EBITDA.",
        "Strength is the heaviest pillar (35%); price by EV/EBITDA; debt cap above 4.5 times EBITDA."] },

    { id: "saude", nome: ["Saúde", "Healthcare"], curto: ["Saúde", "Healthcare"],
      segs: ["Serv.Méd.Hospit..Análises e Diagnósticos", "Serv. Méd. Hospit., Análises e Diagnósticos", "Medicamentos e Outros Produtos", "Equipamentos", "Serviços médicos", "Farmacêutico e Higiene"],
      pesos: { q: 30, p: 25, s: 20, f: 25 }, limite: { tipo: "ebitda", valor: 3.5 },
      metr: { q_roic: 1.5, q_margem: 1, q_caixa: 1, q_estab: 1, p_ey: 1.5, p_ev: 1, p_fcf: 1, p_dy: 0.5, s_div: 2, f_mom: 1.5, f_rec: 1, f_marg: 1, f_cagr: 1, f_gs: 0.5, f_desal: 0.5 },
      valor: ["Demanda estrutural, com o envelhecimento da população, e pressão constante de custos. Hospitais e laboratórios dependem das operadoras de planos; operadoras, da sinistralidade; farmácias, de abrir lojas com retorno; farmacêuticas, do portfólio e de preços regulados.",
        "Structural demand from an ageing population, and constant cost pressure. Hospitals and labs depend on health plans; health plans on their loss ratio; pharmacies on opening stores at a return; drugmakers on their portfolio and regulated prices."],
      pontos: [
        ["Sinistralidade (operadoras), ocupação e ticket (hospitais).", "Medical loss ratio (health plans), occupancy and ticket (hospitals)."],
        ["Crescimento orgânico frente a aquisições, e o ágio que fica no balanço.", "Organic growth against acquisitions, and the goodwill left on the balance sheet."],
        ["Alavancagem depois de aquisições e diluição por emissão de ações.", "Leverage after acquisitions and dilution from share issues."],
        ["Regulação: reajustes da ANS e preços de medicamentos definidos pela CMED.", "Regulation: ANS plan price caps and drug prices set by CMED."],
      ],
      futuro: [
        ["Reajuste dos planos e sinistralidade trimestral.", "Health plan price resets and quarterly loss ratios."],
        ["Integração de aquisições e abertura de lojas.", "Integration of acquisitions and store openings."],
        ["Juros, pelo custo das dívidas de aquisição.", "Interest rates, through acquisition debt."],
      ],
      nota: ["Qualidade pesa 30% e futuro 25%; trava de dívida acima de 3,5 vezes o EBITDA.",
        "Quality weighs 30% and outlook 25%; debt cap above 3.5 times EBITDA."] },

    { id: "educacao", nome: ["Educação", "Education"], curto: ["Educação", "Education"],
      segs: ["Serviços Educacionais", "Educação"],
      pesos: { q: 25, p: 25, s: 25, f: 25 }, limite: { tipo: "ebitda", valor: 3.5 },
      metr: { q_roic: 1.5, q_caixa: 1.5, q_margem: 1, q_estab: 1, p_ey: 1.5, p_ev: 1, p_fcf: 1, p_dy: 0.5, s_div: 2, f_mom: 1.5, f_rec: 1, f_marg: 1, f_gs: 0.5, f_desal: 1, f_cagr: 0.5 },
      valor: ["Mensalidade recorrente, mas com evasão e inadimplência; o ensino a distância derrubou o ticket médio. Caixa importa mais que lucro: provisão para devedores e prazos de recebimento distorcem o resultado.",
        "Recurring tuition, but with dropouts and bad debt; distance learning pushed average tickets down. Cash matters more than earnings: bad-debt provisions and collection terms distort profit."],
      pontos: [
        ["Captação de alunos, evasão e ticket médio.", "Student intake, dropouts and average ticket."],
        ["Provisão para devedores duvidosos e prazo de recebíveis.", "Bad-debt provisions and receivable terms."],
        ["Mix: presencial, a distância e medicina (vagas reguladas e margem maior).", "Mix: on-campus, online and medicine (regulated seats and higher margins)."],
        ["Alavancagem e regulação: FIES e regras do MEC para cursos a distância.", "Leverage and regulation: FIES student loans and MEC rules for online courses."],
      ],
      futuro: [
        ["Captação de cada semestre.", "Intake each semester."],
        ["Mudanças regulatórias no MEC e no FIES.", "Regulatory changes at the MEC and in FIES."],
        ["Juros e emprego, que definem a renda dos alunos.", "Rates and jobs, which set student income."],
      ],
      nota: ["Pesos iguais nos quatro pilares; conversão de caixa pesa mais dentro da qualidade.",
        "Equal weights across the four pillars; cash conversion weighs more within quality."] },

    { id: "tecnologia", nome: ["Tecnologia", "Technology"], curto: ["Tecnologia", "Technology"],
      segs: ["Programas e Serviços", "Computadores e Equipamentos", "Comunicação e Informática"],
      pesos: { q: 30, p: 20, s: 15, f: 35 }, limite: { tipo: "ebitda", valor: 3 },
      metr: { q_roic: 1, q_margem: 1.5, q_caixa: 1, q_estab: 1, p_ey: 1, p_ev: 1, p_fcf: 1.5, p_dy: 0.5, p_by: 0, s_div: 1, f_mom: 1.5, f_rec: 1.5, f_cagr: 1.5, f_marg: 1, f_gs: 0.5, f_desal: 0.5 },
      valor: ["Crescimento com margem: receita recorrente, retenção de clientes e escala. Boa parte do preço depende do crescimento futuro; se ele não vem, o múltiplo encolhe.",
        "Growth with margins: recurring revenue, customer retention and scale. Much of the price rests on future growth; if it fails to come, the multiple shrinks."],
      pontos: [
        ["Receita recorrente e crescimento orgânico, sem aquisições.", "Recurring revenue and organic growth, excluding acquisitions."],
        ["Regra de 40: crescimento da receita mais margem acima de 40%.", "Rule of 40: revenue growth plus margin above 40%."],
        ["Conversão de caixa e diluição pela remuneração em ações.", "Cash conversion and dilution from stock-based pay."],
        ["Concentração de clientes e aquisições.", "Customer concentration and acquisitions."],
      ],
      futuro: [
        ["Crescimento da receita recorrente e cancelamentos (churn).", "Recurring revenue growth and churn."],
        ["Juros: múltiplos de crescimento são os mais sensíveis.", "Interest rates: growth multiples are the most sensitive."],
        ["Demanda de TI das empresas.", "Corporate IT demand."],
      ],
      nota: ["O pilar futuro pesa 35%; preço pesa menos (20%), porque múltiplos altos são esperados quando o crescimento é real.",
        "Outlook weighs 35%; price weighs less (20%), since high multiples are expected when growth is real."] },

    { id: "telecom", nome: ["Telecomunicações", "Telecommunications"], curto: ["Telecom", "Telecom"],
      segs: ["Telecomunicações"],
      pesos: { q: 25, p: 30, s: 25, f: 20 }, limite: { tipo: "ebitda", valor: 4 },
      metr: { q_roic: 1.5, q_margem: 1, q_estab: 1.5, q_caixa: 1, p_ey: 1, p_ev: 1.5, p_fcf: 1.5, p_dy: 1.5, p_by: 0.5, s_div: 2, s_dpl: 0.5, f_desal: 1, f_mom: 1, f_rec: 0.5, f_marg: 0.5, f_gs: 0.5 },
      valor: ["Grandes bases de assinantes, receita estável e investimento alto e contínuo (fibra, 5G). O valor está no caixa livre depois do investimento e em quanto dele vira dividendo.",
        "Large subscriber bases, stable revenue and heavy, continuous capex (fibre, 5G). Value lies in free cash flow after capex and how much of it becomes dividends."],
      pontos: [
        ["Receita média por usuário (ARPU) e cancelamentos (churn).", "Average revenue per user (ARPU) and churn."],
        ["Investimento sobre receita e caixa livre.", "Capex to revenue and free cash flow."],
        ["Alavancagem, incluindo arrendamentos de torres.", "Leverage, including tower leases."],
        ["Competição e consolidação; regulação da Anatel e espectro.", "Competition and consolidation; Anatel regulation and spectrum."],
      ],
      futuro: [
        ["Reajustes de preço e adoção de fibra e 5G.", "Price increases and fibre and 5G adoption."],
        ["Leilões de espectro e juros.", "Spectrum auctions and interest rates."],
      ],
      nota: ["Preço (30%) por caixa livre, dividendos e EV/EBITDA; trava de dívida acima de 4 vezes o EBITDA.",
        "Price (30%) by free cash flow, dividends and EV/EBITDA; debt cap above 4 times EBITDA."] },

    { id: "outros", nome: ["Holdings e outros", "Holdings and others"], curto: ["Outros", "Other"],
      segs: ["Holdings Diversificadas"],
      pesos: { q: 25, p: 25, s: 25, f: 25 }, limite: { tipo: "ebitda", valor: 3.5 }, metr: {},
      valor: ["Holdings valem a soma das participações menos o custo da estrutura; costumam negociar com desconto, que diminui quando a holding distribui caixa ou simplifica a estrutura.",
        "Holding companies are worth the sum of their stakes minus the cost of the structure; they usually trade at a discount that narrows when they distribute cash or simplify."],
      pontos: [
        ["Desconto sobre a soma das partes.", "Discount to the sum of the parts."],
        ["Custos e dívida da holding.", "Holding-level costs and debt."],
        ["Governança e alinhamento com o controlador.", "Governance and alignment with the controlling shareholder."],
      ],
      futuro: [["Distribuições das controladas e movimentos no portfólio.", "Dividends from subsidiaries and portfolio moves."]],
      nota: ["Pesos iguais nos quatro pilares.", "Equal weights across the four pillars."] },
  ];
  var PERFIL = {};
  PERFIS.forEach(function (p) { PERFIL[p.id] = p; });

  function normaliza(s) { return String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); }
  var POR_SEGMENTO = {};
  PERFIS.forEach(function (p) { p.segs.forEach(function (s) { POR_SEGMENTO[normaliza(s)] = p; }); });
  // holdings cujo negócio principal tem perfil claro
  var POR_RAIZ = { ITSA: "financeiro", SIMH: "transporte" };

  function segmentoDe(e) { return e.setor_b3 ? e.setor_b3.pt : e.setor.replace(/^Emp\. Adm\. Part\. ?- ?/, ""); }
  function perfilDe(e) {
    var raiz = POR_RAIZ[(e.ticker || "").slice(0, 4)];
    if (raiz) return PERFIL[raiz];
    return POR_SEGMENTO[normaliza(segmentoDe(e))] || PERFIL.outros;
  }
  function pesoMetrica(p, m) { return p.metr[m.id] != null ? p.metr[m.id] : m.peso; }
  function aplica(m, e) { return !(m.nfin && e.financeiro) && !(m.fin && !e.financeiro); }

  // ---------------------------------------------------------------- cálculo

  /** fração do universo que fica atrás do valor (empates contam meio), de 0 a 100 */
  function percentil(v, universo, sentido) {
    var atras = 0, empate = 0;
    universo.forEach(function (u) {
      if (u === v) empate++;
      else if (sentido > 0 ? u < v : u > v) atras++;
    });
    return universo.length ? (atras + empate / 2) / universo.length * 100 : null;
  }
  /** peso dos pares: metade em grupos de 8 ou mais; um quarto de 4 a 7; nada abaixo disso */
  function pesoPares(n) { return n >= 8 ? 0.5 : n >= 4 ? 0.25 : 0; }

  function travas(r) {
    var e = r.e, t = [], p = r.perfil;
    if (/recupera[cç][aã]o judicial/i.test(e.nome)) t.push({ id: "rj", teto: TETO.rj });
    var pl = atual(e, "pl_controladora"), lc = atual(e, "lucro_controladora");
    if (pl != null && pl <= 0) t.push({ id: "plNeg", teto: TETO.plNeg });
    if (lc != null && lc <= 0) t.push({ id: "prejuizo", teto: TETO.prejuizo });
    if (!e.financeiro && p.limite) {
      var x = p.limite.tipo === "pl" ? r.v.s_dpl : r.v.s_div;
      if (x != null && x > p.limite.valor) t.push({ id: "divida", teto: TETO.divida, valor: x, limite: p.limite });
    }
    return t;
  }

  function avisos(r, ctx) {
    var e = r.e, a = [];
    if (/^Estatal/.test(e.controle || "")) a.push("estatal");
    if (!e.ttm) a.push("sem12m");
    if (!ctx.score(e)) a.push("semHistorico");
    if (r.cobertura < 0.6) a.push("poucosDados");
    return a;
  }

  /** Nota de todas as empresas. ctx: score(e) (índice de previsibilidade na moeda) e cagrRec(e) (crescimento da receita na moeda). */
  function calcularBase(empresas, ctx) {
    var regs = empresas.map(function (e) {
      var v = {};
      METRICAS.forEach(function (m) {
        var x = aplica(m, e) ? m.calc(e, ctx) : null;
        v[m.id] = finito(x) ? x : null;
      });
      return { e: e, perfil: perfilDe(e), v: v };
    });

    // universos: mercado inteiro e cada perfil
    var merc = {}, par = {};
    METRICAS.forEach(function (m) { merc[m.id] = []; par[m.id] = {}; });
    regs.forEach(function (r) {
      METRICAS.forEach(function (m) {
        var x = r.v[m.id];
        if (x == null) return;
        merc[m.id].push(x);
        (par[m.id][r.perfil.id] = par[m.id][r.perfil.id] || []).push(x);
      });
    });

    regs.forEach(function (r) {
      var p = r.perfil, notas = {}, pil = {}, possivel = 0, tem = 0;
      METRICAS.forEach(function (m) {
        var w = pesoMetrica(p, m);
        if (!(w > 0) || !aplica(m, r.e)) return;
        possivel += w;
        var x = r.v[m.id];
        if (x == null) return;
        tem += w;
        var info = { v: x, w: w };
        if (m.abs) info.nota = clip(x, 0, 100);
        else {
          var pares = par[m.id][p.id] || [];
          info.pMerc = percentil(x, merc[m.id], m.sentido);
          info.nPares = pares.length;
          info.wPar = m.soMercado ? 0 : pesoPares(pares.length);
          if (info.wPar > 0) info.pPar = percentil(x, pares, m.sentido);
          info.nota = info.wPar > 0 ? info.wPar * info.pPar + (1 - info.wPar) * info.pMerc : info.pMerc;
        }
        notas[m.id] = info;
      });
      PILARES.forEach(function (pl) {
        var soma = 0, pesos = 0;
        METRICAS.forEach(function (m) {
          var i = notas[m.id];
          if (m.pilar === pl.id && i) { soma += i.nota * i.w; pesos += i.w; }
        });
        pil[pl.id] = pesos ? { nota: soma / pesos, peso: p.pesos[pl.id] } : null;
      });
      var tot = 0, ptot = 0;
      PILARES.forEach(function (pl) { var x = pil[pl.id]; if (x) { tot += x.nota * x.peso; ptot += x.peso; } });
      r.notas = notas;
      r.pilares = pil;
      r.bruta = ptot ? tot / ptot : null;
      r.cobertura = possivel ? tem / possivel : 0;
      r.travas = travas(r);
      r.avisos = avisos(r, ctx);
      var teto = Math.min.apply(null, [100].concat(r.travas.map(function (t) { return t.teto; })));
      r.teto = teto < 100 ? teto : null;
      r.nota = r.bruta == null ? null : Math.round(Math.min(r.bruta, teto));
    });

    var lista = regs.filter(function (r) { return r.nota != null; }).sort(function (a, b) {
      return (b.nota - a.nota) || (b.bruta - a.bruta) || ((b.e.valor_mercado || 0) - (a.e.valor_mercado || 0));
    });
    var porTicker = {}, porPerfil = {};
    lista.forEach(function (r, k) {
      r.pos = k + 1;
      r.e.tickers.forEach(function (t) { porTicker[t] = r; });
      (porPerfil[r.perfil.id] = porPerfil[r.perfil.id] || []).push(r);
    });
    Object.keys(porPerfil).forEach(function (id) {
      porPerfil[id].forEach(function (r, k) { r.posPerfil = k + 1; r.nPerfil = porPerfil[id].length; });
    });
    return { lista: lista, porTicker: porTicker, porPerfil: porPerfil, total: lista.length };
  }

  var cache = {};
  /** nota de todas as empresas na moeda da tela (o índice de previsibilidade e o crescimento da receita mudam com ela) */
  function calcular() {
    var X = window.RealTerms, moeda = X.estado.moeda;
    if (cache[moeda]) return cache[moeda];
    var memo = new Map();
    var ind = function (e) { if (!memo.has(e)) memo.set(e, X.indicadores(e)); return memo.get(e); };
    cache[moeda] = calcularBase(X.EMPRESAS, {
      score: function (e) { return X.score(e); },
      cagrRec: function (e) { return ind(e).cagrRec; },
    });
    return cache[moeda];
  }

  // ---------------------------------------------------------------- tela

  var ui = { perfil: "", ordem: "nota", aberto: null };

  function render(app) {
    var X = window.RealTerms, L = X.L, esc = X.esc, nf = X.nf;
    var T = function (par) { return par[X.estado.lingua === "en" ? 1 : 0]; };
    var base = calcular(), ativo = X.setorAtivo();
    var visiveis = new Set(X.visiveis());
    var hoje = function (v) { return v == null || X.estado.moeda === "brl" ? v : v / X.D.ptax_atual.valor; };
    var ord = function (n) { return X.estado.lingua === "en" ? "#" + n : n + "ª"; };
    var faixa = function (n) {
      return n >= 70 ? { txt: L("fundamentos fortes", "strong fundamentals"), cor: "var(--pos)" }
        : n >= 50 ? { txt: L("fundamentos intermediários", "middling fundamentals"), cor: "var(--warn)" }
        : { txt: L("fundamentos fracos", "weak fundamentals"), cor: "var(--neg)" };
    };

    // deep link: #/ranking/PETR4 abre a explicação da empresa
    var m = location.hash.match(/^#\/ranking\/([A-Za-z0-9]+)/);
    if (m && base.porTicker[m[1].toUpperCase()]) ui.aberto = base.porTicker[m[1].toUpperCase()].e.ticker;
    if (ativo) ui.perfil = "";

    // ------------------------------------------------------------ formatos
    function mostra(mt, x, e) {
      var sinal = function (v, txt) { return (v > 0 ? "+" : v < 0 ? "−" : "") + txt; };
      switch (mt.fmt) {
        case "pct": return X.pct(x, 1);
        case "x2": return nf(2).format(x) + "x";
        case "n": return nf(0).format(x);
        case "pl": return x > 0 ? nf(1).format(1 / x) + "x" : L("prejuízo", "loss");
        case "pvp": return x > 0 ? nf(2).format(1 / x) + "x" : L("patrimônio negativo", "negative equity");
        case "ev": return x > 0 ? nf(1).format(1 / x) + "x" : L("EBITDA negativo", "negative EBITDA");
        case "alav": return x <= -3 ? L("caixa líquido", "net cash") : x >= 15 ? L("15x ou mais", "15x or more") : x < 0 ? L("caixa líquido", "net cash") + " (" + nf(1).format(x) + "x)" : nf(1).format(x) + "x";
        case "alavpl": return x >= 5 ? L("5x ou mais", "5x or more") : x < 0 ? L("caixa líquido", "net cash") : nf(2).format(x) + "x";
        case "anos": return nf(0).format(x) + L("% dos anos", "% of years");
        case "gov": {
          var seg = String(e.segmento || "").replace(/ de Governança Corporativa$/, "");
          return X.estado.lingua === "en" ? ({ "Nível 2": "Level 2", "Nível 1": "Level 1", "Básico": "Basic" }[seg] || seg) : seg;
        }
        case "liq": return X.dinheiro(hoje(x) / 1000) + L("/dia", "/day");
        case "var": return sinal(x, X.pct(Math.abs(x), 0));
        case "pp": return sinal(x, nf(1).format(Math.abs(x) * 100)) + " p.p.";
        case "aa": return X.pct(x, 1) + L(" ao ano", " a year");
        case "desal": return Math.abs(x) < 0.05 ? L("estável", "flat") : x > 0 ? L("caiu ", "down ") + nf(1).format(x) + "x" : L("subiu ", "up ") + nf(1).format(-x) + "x";
      }
      return String(x);
    }
    var corNota = function (n) { return n >= 70 ? "var(--pos)" : n >= 50 ? "var(--warn)" : "var(--neg)"; };
    var TRAVA = {
      rj: [["recuperação judicial", "bankruptcy"], ["Empresa em recuperação judicial: o acionista é o último a receber numa reestruturação.", "Company under bankruptcy protection (recuperação judicial): shareholders are last in line in a restructuring."]],
      plNeg: [["patrimônio negativo", "negative equity"], ["Patrimônio líquido negativo: o passivo supera o ativo.", "Negative shareholders' equity: liabilities exceed assets."]],
      prejuizo: [["prejuízo", "loss"], ["Prejuízo nos últimos 12 meses: sem lucro, os múltiplos de lucro não se aplicam e o risco é maior.", "Loss over the last 12 months: earnings multiples do not apply and risk is higher."]],
      divida: [["dívida alta", "high debt"], ["Dívida acima do que o setor suporta.", "Debt above what the sector can carry."]],
    };
    var AVISO = {
      estatal: [["estatal", "state-owned"], ["Controle estatal: há risco de interferência em preços, tarifas, investimentos e dividendos.", "State control: risk of interference in prices, tariffs, capex and dividends."]],
      sem12m: [["sem ITR", "no TTM"], ["Sem balanço trimestral posterior ao último exercício: os indicadores e o momento usam o exercício.", "No quarterly filing after the last fiscal year: indicators and momentum use the fiscal year."]],
      semHistorico: [["histórico curto", "short history"], ["Menos de 5 anos de balanço: sem índice de previsibilidade, a nota se apoia em menos indicadores.", "Under 5 years of filings: without a predictability score, the rating rests on fewer indicators."]],
      poucosDados: [["poucos dados", "thin data"], ["Menos de 60% dos indicadores previstos têm dado: nota menos confiável.", "Fewer than 60% of the expected indicators have data: a less reliable score."]],
    };

    // ------------------------------------------------------------ explicação de uma empresa
    function textoTrava(t) {
      var txt = T(TRAVA[t.id][1]);
      if (t.id === "divida") {
        var lim = t.limite.tipo === "pl" ? nf(1).format(t.limite.valor) + L("x o patrimônio", "x equity") : nf(1).format(t.limite.valor) + L("x o EBITDA", "x EBITDA");
        txt += " " + L("Hoje: ", "Now: ") + (t.limite.tipo === "pl" ? mostra(METRICA.s_dpl, t.valor) : mostra(METRICA.s_div, t.valor)) + L("; limite do setor: ", "; sector limit: ") + lim + ".";
      }
      return txt + " " + L("Nota limitada a ", "Score capped at ") + t.teto + ".";
    }

    function contribuicoes(r) {
      var lista = [];
      METRICAS.forEach(function (mt) {
        var i = r.notas[mt.id], pl = r.pilares[mt.pilar];
        if (!i || !pl) return;
        var pesoPilar = 0;
        METRICAS.forEach(function (o) { if (o.pilar === mt.pilar && r.notas[o.id]) pesoPilar += r.notas[o.id].w; });
        lista.push({ m: mt, i: i, c: (i.nota - 50) * i.w / pesoPilar * pl.peso / 100 });
      });
      return lista;
    }

    function fator(x, bom) {
      var mt = x.m, i = x.i, valor = mostra(mt, i.v, x.e);
      if (mt.id === "s_lucro") return L("lucro em ", "profit in ") + valor;
      if (mt.id === "s_gov") return L("governança: ", "governance: ") + valor;
      var txt = T(mt.curto) + " " + valor;
      if (mt.abs) return txt;
      // cita a comparação que sustenta o argumento: a mais alta quando é a favor, a mais baixa quando é contra
      var usaPar = i.wPar > 0 && (bom ? i.pPar >= i.pMerc : i.pPar <= i.pMerc);
      var p = Math.round(usaPar ? i.pPar : i.pMerc), quem = usaPar ? L("dos pares", "of peers") : L("do mercado", "of the market");
      return txt + " (" + (bom ? L("melhor que ", "better than ") + p : L("pior que ", "worse than ") + (100 - p)) + "% " + quem + ")";
    }

    function resumo(r) {
      var c = contribuicoes(r).map(function (x) { x.e = r.e; return x; });
      var bons = c.filter(function (x) { return x.i.nota >= 60 && x.c > 0; }).sort(function (a, b) { return b.c - a.c; }).slice(0, 3);
      var ruins = c.filter(function (x) { return x.i.nota <= 40 && x.c < 0; }).sort(function (a, b) { return a.c - b.c; }).slice(0, 3);
      var fx = faixa(r.nota), txt = "<b>" + r.nota + "/100, " + esc(fx.txt) + ".</b> " +
        esc(L(ord(r.pos) + " de " + base.total + " na base e " + ord(r.posPerfil) + " de " + r.nPerfil + " em " + T(r.perfil.nome) + ".",
          ord(r.pos) + " of " + base.total + " overall and " + ord(r.posPerfil) + " of " + r.nPerfil + " in " + T(r.perfil.nome) + "."));
      if (bons.length) txt += " " + esc(L("A favor: ", "In its favour: ") + bons.map(function (x) { return fator(x, true); }).join("; ") + ".");
      if (ruins.length) txt += " " + esc(L("Contra: ", "Against: ") + ruins.map(function (x) { return fator(x, false); }).join("; ") + ".");
      if (r.teto != null && Math.round(r.bruta) > r.teto) {
        txt += " " + esc(L("Sem as travas, a nota seria " + Math.round(r.bruta) + ".", "Without the caps, the score would be " + Math.round(r.bruta) + "."));
      }
      return txt;
    }

    function futuro(r) {
      var e = r.e, itens = [], v = r.v;
      var base12 = e.ttm ? L("12 meses até " + X.data(e.ttm.ate) + " contra o exercício " + e.anos[e.anos.length - 1], "12 months to " + X.data(e.ttm.ate) + " vs. fiscal " + e.anos[e.anos.length - 1])
        : L("exercício " + e.anos[e.anos.length - 1] + " contra o anterior", "fiscal " + e.anos[e.anos.length - 1] + " vs. the year before");
      if (v.f_mom != null) itens.push([L("Lucro", "Earnings"), mostra(METRICA.f_mom, v.f_mom) + " · " + base12]);
      if (v.f_rec != null) itens.push([L("Receita", "Revenue"), mostra(METRICA.f_rec, v.f_rec)]);
      if (v.f_marg != null) itens.push([L("Margem líquida", "Net margin"), mostra(METRICA.f_marg, v.f_marg) + L(" sobre a mediana dos 5 exercícios anteriores", " vs. the median of the previous 5 years")]);
      if (v.f_gs != null) {
        var l = atual(e, "lucro_controladora"), d = e.ttm && e.ttm.dividendos_pagos != null ? e.ttm.dividendos_pagos : fim(e, "dividendos_pagos");
        var ret = l > 0 && d != null ? 1 - clip(d / l, 0, 1) : null;
        itens.push([L("Crescimento sustentável", "Sustainable growth"), mostra(METRICA.f_gs, v.f_gs) +
          (ret != null && v.q_roe != null ? " (ROE " + X.pct(v.q_roe, 1) + " × " + X.pct(ret, 0) + L(" do lucro retido)", " of earnings retained)") : "")]);
      }
      if (v.f_desal != null) itens.push([L("Dívida/EBITDA", "Net debt/EBITDA"), mostra(METRICA.f_desal, v.f_desal) + L(" em um ano", " over one year")]);
      if (v.f_cagr != null) itens.push([L("Receita em 5 anos", "Revenue, 5 years"), mostra(METRICA.f_cagr, v.f_cagr)]);
      var lc = atual(e, "lucro_controladora");
      if (lc != null && e.valor_mercado > 0) {
        var ey = lc / e.valor_mercado;
        itens.push([L("Quanto do preço depende de crescimento", "Share of the price that relies on growth"), ey <= 0
          ? L("todo: sem lucro, o preço aposta na recuperação", "all of it: with no earnings, the price bets on a recovery")
          : ey >= K ? L("nada: o preço está abaixo do valor de uma empresa que nunca crescesse (lucro ÷ 15%)", "none: the price is below the value of a company that never grew (earnings ÷ 15%)")
          : X.pct(1 - ey / K, 0) + L(" (com custo de capital de 15% ao ano)", " (at a 15% cost of capital)")]);
      }
      var rec = aReceber(e);
      if (rec) {
        var preco = (e.cotacao[e.ticker] || {}).preco;
        itens.push([L("Proventos aprovados a receber", "Approved payouts still to be paid"),
          (X.estado.moeda === "usd" ? "US$ " + nf(2).format(rec.valor / X.D.ptax_atual.valor) : "R$ " + nf(2).format(rec.valor)) + L(" por ação", " per share") +
          (preco ? " (" + X.pct(rec.valor / preco, rec.valor / preco < 0.01 ? 2 : 1) + L(" do preço)", " of the price)") : "") + L(", até ", ", by ") + X.data(rec.ate)]);
      }
      return itens;
    }

    function detalhe(r) {
      var e = r.e, html = '<div class="rk-exp"><p class="rk-resumo">' + resumo(r) + "</p>";
      html += '<div class="rk-pilares">' + PILARES.map(function (pl) {
        var x = r.pilares[pl.id];
        var linhas = METRICAS.filter(function (mt) { return mt.pilar === pl.id && r.notas[mt.id]; }).map(function (mt) {
          var i = r.notas[mt.id], ref;
          if (mt.abs) ref = L("valor absoluto", "absolute value");
          else ref = (i.wPar > 0 ? L("pares", "peers") + " p" + Math.round(i.pPar) + " · " : "") + L("mercado", "market") + " p" + Math.round(i.pMerc);
          return '<li><span class="rk-m-nome" title="' + esc(T(mt.nome)) + '">' + esc(T(mt.curto)) + '</span><span class="rk-m-v num">' + esc(mostra(mt, i.v, e)) +
            '</span><span class="rk-m-ref mudo" title="' + esc(ref) + '">' + esc(ref) + '</span><span class="rk-m-n num"><i style="width:' + Math.round(i.nota) + '%;background:' + corNota(i.nota) + '"></i><b>' + Math.round(i.nota) + "</b></span></li>";
        }).join("");
        return '<div class="rk-pilar"><h4>' + esc(T(pl.nome)) + ' <span class="mudo">' + esc(L("peso ", "weight ")) + r.perfil.pesos[pl.id] + "%</span>" +
          '<b class="num" style="color:' + (x ? corNota(x.nota) : "var(--muted)") + '">' + (x ? Math.round(x.nota) : "–") + "</b></h4>" +
          (linhas ? "<ul>" + linhas + "</ul>" : '<p class="mudo">' + esc(L("Sem dados para este pilar; o peso vai para os outros.", "No data for this pillar; its weight goes to the others.")) + "</p>") + "</div>";
      }).join("") + "</div>";
      var fut = futuro(r);
      if (fut.length) {
        html += '<div class="rk-futuro"><h4>' + esc(L("Indicadores futuros", "Forward indicators")) + "</h4><dl>" + fut.map(function (x) {
          return "<div><dt>" + esc(x[0]) + "</dt><dd>" + esc(x[1]) + "</dd></div>";
        }).join("") + "</dl></div>";
      }
      var alertas = r.travas.map(function (t) { return '<li class="rk-trava">' + esc(textoTrava(t)) + "</li>"; })
        .concat(r.avisos.map(function (a) { return "<li>" + esc(T(AVISO[a][1])) + "</li>"; }));
      if (alertas.length) html += '<div class="rk-alertas"><h4>' + esc(L("Travas e avisos", "Caps and warnings")) + "</h4><ul>" + alertas.join("") + "</ul></div>";
      var pares = (base.porPerfil[r.perfil.id] || []).filter(function (x) { return x !== r; })
        .sort(function (a, b) { return (b.e.valor_mercado || 0) - (a.e.valor_mercado || 0); }).slice(0, 3).map(function (x) { return x.e.ticker; });
      html += '<p class="rk-links"><a href="#/' + e.ticker + '">' + esc(L("Abrir a página de ", "Open the page for ") + e.ticker) + " →</a>" +
        (pares.length ? '<a href="#/comparar/' + [e.ticker].concat(pares).join(",") + '">' + esc(L("Comparar com ", "Compare with ") + pares.join(", ")) + " →</a>" : "") + "</p>";
      return html + "</div>";
    }

    // ------------------------------------------------------------ tabela
    function linhas() {
      var lista = base.lista.filter(function (r) { return visiveis.has(r.e) && (!ui.perfil || r.perfil.id === ui.perfil); });
      var chave = ui.ordem;
      if (chave !== "nota") {
        lista = lista.slice().sort(function (a, b) {
          var va = a.pilares[chave] ? a.pilares[chave].nota : -1, vb = b.pilares[chave] ? b.pilares[chave].nota : -1;
          return (vb - va) || (b.nota - a.nota);
        });
      }
      return lista;
    }

    function linhaHtml(r, k) {
      var e = r.e, aberto = ui.aberto === e.ticker;
      var marcas = r.travas.map(function (t) { return '<span class="rk-selo trava" title="' + esc(textoTrava(t)) + '">' + esc(T(TRAVA[t.id][0])) + "</span>"; })
        .concat(r.avisos.filter(function (a) { return a === "estatal"; }).map(function (a) { return '<span class="rk-selo" title="' + esc(T(AVISO[a][1])) + '">' + esc(T(AVISO[a][0])) + "</span>"; }));
      var pils = PILARES.map(function (pl) {
        var x = r.pilares[pl.id], v = x ? Math.round(x.nota) : 0;
        return '<i title="' + esc(T(pl.nome) + ": " + (x ? v : "–")) + '"><b style="height:' + Math.max(4, v) + "%;background:" + (x ? corNota(v) : "var(--grid)") + '"></b></i>';
      }).join("");
      return '<tr class="rk-linha' + (aberto ? " aberta" : "") + '" data-t="' + e.ticker + '" tabindex="0" aria-expanded="' + aberto + '">' +
        '<td class="num mudo">' + (k + 1) + "</td>" +
        '<td class="esq"><div class="tk"><b>' + e.ticker + "</b><span>" + esc(X.nomeCurto(e.nome)) + "</span></div></td>" +
        '<td class="esq rk-perfil-cel"><span>' + esc(T(r.perfil.curto)) + "</span><small>" + esc(ord(r.posPerfil) + L(" de ", " of ") + r.nPerfil) + "</small></td>" +
        '<td><span class="rk-nota" style="--cor:' + corNota(r.nota) + '">' + r.nota + "</span></td>" +
        '<td><span class="rk-pils">' + pils + "</span></td>" +
        '<td class="esq rk-marcas">' + marcas.join("") + "</td></tr>" +
        (aberto ? '<tr class="rk-detalhe"><td colspan="6">' + detalhe(r) + "</td></tr>" : "");
    }

    function desenharTabela() {
      var lista = linhas();
      app.querySelector("#rk-corpo").innerHTML = lista.length ? lista.map(linhaHtml).join("") :
        '<tr><td colspan="6" class="vazio">' + esc(L("Nenhuma empresa.", "No companies.")) + "</td></tr>";
      app.querySelector("#rk-conta").textContent = L(lista.length + " empresas · cotações de " + X.data(X.D.cotacoes_em) + ", balanços até " + X.D.ano_final,
        lista.length + " companies · prices as of " + X.data(X.D.cotacoes_em) + ", statements through " + X.D.ano_final);
    }

    // ------------------------------------------------------------ páginas de texto
    var caps = [
      ["r-1", L("Ranking", "Ranking")],
      ["r-2", L("Como a nota é feita", "How the score works")],
      ["r-3", L("Indicadores futuros", "Forward indicators")],
      ["r-4", L("Setor a setor", "Sector by sector")],
      ["r-5", L("Limites", "Limits")],
    ];
    var num = function (k) { return (k < 9 ? "0" : "") + (k + 1); };
    var cap = function (k) { return '<span class="capitulo">' + num(k) + "</span>"; };
    var nav = '<nav class="secoes lateral" aria-label="' + esc(X.t("secoes")) + '"><div class="secoes-trilho"><i></i></div><ol>' +
      caps.map(function (c, k) {
        return '<li><a href="#" data-ir="' + c[0] + '"><span class="n">' + num(k) + '</span><span class="r">' + esc(c[1]) + "</span></a></li>";
      }).join("") + "</ol></nav>";

    var contagemPerfil = {};
    base.lista.forEach(function (r) { if (visiveis.has(r.e)) contagemPerfil[r.perfil.id] = (contagemPerfil[r.perfil.id] || 0) + 1; });
    var nVis = base.lista.filter(function (r) { return visiveis.has(r.e); }).length;
    var opcoesPerfil = '<option value="">' + esc(L("Todos os perfis", "All sector profiles")) + " (" + nVis + ")</option>" +
      PERFIS.filter(function (p) { return contagemPerfil[p.id]; }).map(function (p) {
        return '<option value="' + p.id + '"' + (ui.perfil === p.id ? " selected" : "") + ">" + esc(T(p.curto)) + " (" + contagemPerfil[p.id] + ")</option>";
      }).join("");
    var opcoesOrdem = [["nota", L("Nota", "Score")]].concat(PILARES.map(function (pl) { return [pl.id, T(pl.nome)]; })).map(function (o) {
      return '<option value="' + o[0] + '"' + (ui.ordem === o[0] ? " selected" : "") + ">" + esc(o[1]) + "</option>";
    }).join("");
    var letras = PILARES.map(function (pl) { return '<b title="' + esc(T(pl.nome)) + '">' + esc(T(pl.nome).charAt(0)) + "</b>"; }).join("");

    var s1 =
      '<section class="secao rk-cab" id="r-1">' +
      '<span class="olho">' + cap(0) + esc(L("Nota de fundamentos", "Fundamentals score")) + "</span>" +
      "<h1>" + esc(L("Ranking por fundamentos, setor a setor", "Ranking by fundamentals, sector by sector")) + "</h1>" +
      '<p class="mudo rk-intro">' + esc(L(
        "Uma nota de 0 a 100 para cada empresa, a partir de quatro perguntas: o negócio cria valor, quanto se paga por ele, o balanço aguenta um ano ruim e para onde os números estão indo. Cada setor tem pesos e pontos de atenção próprios. Clique numa empresa para ver o raciocínio por trás da nota.",
        "A 0–100 score for every company, built from four questions: does the business create value, how much are you paying for it, can the balance sheet take a bad year, and where are the numbers heading. Each sector has its own weights and points to watch. Click a company to see the reasoning behind its score.")) + "</p>" +
      (ativo ? '<p class="aviso-setor">' + esc(L(
        "Mostrando só " + ativo.nome + ". As posições são dentro do setor; a nota continua comparando cada empresa com o seu perfil setorial e com o mercado inteiro.",
        "Showing only " + ativo.nome + ". Positions are within the sector; the score still compares each company with its sector profile and the whole market.")) + "</p>" : "") +
      '<p class="rk-aviso">' + esc(L(
        "Métrica quantitativa calculada por regras públicas a partir de dados históricos e do preço de hoje. Não é recomendação de compra ou venda, nem relatório de análise.",
        "A quantitative metric computed with public rules from historical data and today's price. It is not a buy or sell recommendation, nor an equity research report.")) + "</p>" +
      '<div class="rk-controles">' +
      (ativo ? "" : '<label><span>' + esc(L("Perfil setorial", "Sector profile")) + '</span><select id="rk-perfil">' + opcoesPerfil + "</select></label>") +
      '<label><span>' + esc(L("Ordenar por", "Sort by")) + '</span><select id="rk-ordem">' + opcoesOrdem + "</select></label>" +
      '<span class="contagem" id="rk-conta"></span></div>' +
      '<div class="tabela-wrap"><table class="rk-tabela"><thead><tr><th class="num">#</th><th class="esq">' + esc(L("Empresa", "Company")) + '</th><th class="esq rk-perfil-cel">' +
      esc(L("Perfil · posição", "Profile · rank")) + "</th><th>" + esc(L("Nota", "Score")) + '</th><th><span class="rk-pils-cab">' + letras + '</span></th><th class="esq rk-marcas"></th></tr></thead><tbody id="rk-corpo"></tbody></table></div>' +
      '<p class="aviso">' + esc(L(
        "Barras: " + PILARES.map(function (pl) { return T(pl.nome); }).join(", ") + ". Cores: 70 ou mais, fundamentos fortes; 50 a 69, intermediários; abaixo de 50, fracos.",
        "Bars: " + PILARES.map(function (pl) { return T(pl.nome); }).join(", ") + ". Colours: 70 or more, strong fundamentals; 50–69, middling; below 50, weak.")) + "</p>" +
      "</section>";

    var pilaresTxt = [
      ["q", L("Retorno sobre o capital acima do custo, margem, conversão do lucro em caixa e regularidade. Empresas rentáveis e estáveis tendem a render mais com o tempo (fator qualidade: Novy-Marx, 2013; Asness, Frazzini e Pedersen, 2019); lucros que não viram caixa tendem a decepcionar (Sloan, 1996).",
        "Return on capital above its cost, margin, cash conversion and consistency. Profitable, steady companies tend to earn more over time (quality factor: Novy-Marx, 2013; Asness, Frazzini and Pedersen, 2019); earnings that do not turn into cash tend to disappoint (Sloan, 1996).")],
      ["p", L("Lucro, patrimônio, EBITDA, caixa livre e dividendos em relação ao preço. Comprar abaixo do valor dá margem de segurança (Graham) e ações baratas frente aos fundamentos renderam mais no longo prazo (fator valor: Fama e French, 1992; Lakonishok, Shleifer e Vishny, 1994). Em setores cíclicos usa-se o lucro normalizado do ciclo (Graham e Dodd; Campbell e Shiller).",
        "Earnings, book value, EBITDA, free cash flow and dividends relative to price. Buying below value gives a margin of safety (Graham), and stocks cheap relative to fundamentals have earned more over the long run (value factor: Fama and French, 1992; Lakonishok, Shleifer and Vishny, 1994). Cyclical sectors use cycle-normalized earnings (Graham and Dodd; Campbell and Shiller).")],
      ["s", L("Dívida frente à geração de caixa e ao patrimônio (nos bancos, patrimônio sobre ativos), histórico de lucro, governança e liquidez. Sinais simples de força financeira separam vencedoras de perdedoras entre as ações baratas (Piotroski, 2000); dívida alta transforma um ano ruim em um problema permanente.",
        "Debt against cash generation and equity (for banks, equity to assets), earnings history, governance and liquidity. Simple signals of financial strength separate winners from losers among cheap stocks (Piotroski, 2000); high debt turns a bad year into a lasting problem.")],
      ["f", L("Sinais calculados dos balanços mais recentes que antecipam o próximo resultado: momento do lucro e da receita, tendência da margem, crescimento sustentável e desalavancagem (capítulo 3).",
        "Signals from the latest filings that anticipate the next results: earnings and revenue momentum, margin trend, sustainable growth and deleveraging (chapter 3).")],
    ];
    var s2 =
      '<section class="cartao secao i-cap" id="r-2"><h2>' + cap(1) + esc(L("Como a nota é feita", "How the score works")) + "</h2>" +
      "<p>" + esc(L("Antes de comprar uma ação, a análise fundamentalista faz quatro perguntas. A nota dá um número a cada uma, compara a empresa com os pares do mesmo setor e com o mercado inteiro, e soma tudo com pesos que mudam de setor para setor.",
        "Before buying a stock, fundamental analysis asks four questions. The score puts a number on each, compares the company with its sector peers and with the whole market, and adds everything up with weights that change from sector to sector.")) + "</p>" +
      '<div class="rk-pil-grade">' + PILARES.map(function (pl) {
        var t = pilaresTxt.filter(function (x) { return x[0] === pl.id; })[0][1];
        var ms = METRICAS.filter(function (mt) { return mt.pilar === pl.id; }).map(function (mt) { return T(mt.curto); });
        return '<div class="rk-pil-card"><h3>' + esc(T(pl.nome)) + '</h3><p class="rk-pergunta">' + esc(T(pl.pergunta)) + "</p><p>" + esc(t) + '</p><p class="mudo pequeno">' + esc(ms.join(" · ")) + "</p></div>";
      }).join("") + "</div>" +
      "<h3>" + esc(L("Da conta à nota", "From the numbers to the score")) + '</h3><ol class="rk-passos">' + [
        L("Cada indicador vira um percentil de 0 a 100: a posição da empresa entre os pares do mesmo perfil setorial e entre todas as ações da base. Mais alto é sempre melhor, inclusive quando o indicador é do tipo menor-é-melhor (P/L, dívida).",
          "Each indicator becomes a 0–100 percentile: the company's position among peers in the same sector profile and among all stocks in the base. Higher is always better, including for lower-is-better indicators (P/E, debt)."),
        L("Pares e mercado pesam metade cada. Em perfis com 4 a 7 empresas com o dado, os pares pesam um quarto; com menos de 4, só vale o mercado. Previsibilidade, anos com lucro e governança entram pelo valor absoluto.",
          "Peers and market weigh half each. In profiles with 4 to 7 companies with the data, peers weigh a quarter; with fewer than 4, only the market counts. Predictability, profitable years and governance enter at their absolute value."),
        L("A nota de cada pilar é a média ponderada dos seus indicadores. Indicador que não se aplica (dívida/EBITDA de banco) ou sem dado fica de fora, e o peso vai para os demais.",
          "Each pillar's score is the weighted average of its indicators. An indicator that does not apply (a bank's net debt/EBITDA) or has no data is left out, and its weight goes to the rest."),
        L("A nota final soma os quatro pilares com os pesos do perfil setorial (tabela no capítulo 4).",
          "The final score adds the four pillars with the sector profile's weights (table in chapter 4)."),
        L("Travas: recuperação judicial limita a nota a " + TETO.rj + "; patrimônio negativo, a " + TETO.plNeg + "; prejuízo nos últimos 12 meses, a " + TETO.prejuizo + "; dívida acima do limite do setor, a " + TETO.divida + ". Evitam que um preço muito baixo esconda um problema sério (a armadilha de valor).",
          "Caps: bankruptcy protection limits the score to " + TETO.rj + "; negative equity, to " + TETO.plNeg + "; a loss over the last 12 months, to " + TETO.prejuizo + "; debt above the sector limit, to " + TETO.divida + ". They stop a very low price from hiding a serious problem (the value trap)."),
      ].map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ol>" +
      '<p class="mudo">' + esc(L("Faixas: 70 ou mais, fundamentos fortes; 50 a 69, intermediários; abaixo de 50, fracos. A nota é relativa: muda quando a empresa, os pares, o mercado ou o preço mudam.",
        "Bands: 70 or more, strong fundamentals; 50–69, middling; below 50, weak. The score is relative: it changes when the company, its peers, the market or the price change.")) + "</p></section>";

    var s3 =
      '<section class="cartao secao i-cap" id="r-3"><h2>' + cap(2) + esc(L("Indicadores futuros", "Forward indicators")) + "</h2>" +
      "<p>" + esc(L("A nota não usa projeções de analistas: elas não são públicas nem padronizadas. Usa sinais dos balanços mais recentes que, segundo a pesquisa acadêmica, antecipam o resultado seguinte, e mostra o que o preço de hoje já embute.",
        "The score does not use analyst forecasts: they are neither public nor standardized. It uses signals from the latest filings that, according to academic research, anticipate the next results, and shows what today's price already assumes.")) + "</p>" +
      '<dl class="i-glossario rk-futuro-lista">' + [
        [T(METRICA.f_mom.nome), L("Lucro dos últimos 12 meses contra o último exercício. Empresas que surpreendem para cima tendem a seguir surpreendendo por alguns trimestres (drift pós-resultado: Bernard e Thomas, 1989).",
          "Trailing-12-month earnings against the last fiscal year. Companies that surprise upwards tend to keep surprising for a few quarters (post-earnings drift: Bernard and Thomas, 1989).")],
        [T(METRICA.f_rec.nome), L("A mesma comparação para as vendas: mostra se o lucro vem de crescimento ou só de corte de custos.",
          "The same comparison for sales: it shows whether earnings come from growth or only from cost cuts.")],
        [T(METRICA.f_marg.nome), L("Margem dos últimos 12 meses menos a mediana dos 5 exercícios anteriores. Margem subindo indica ganho de escala ou de preço; caindo, pressão de custos ou de concorrência.",
          "Trailing margin minus the median of the previous 5 fiscal years. A rising margin points to scale or pricing power; a falling one to cost or competitive pressure.")],
        [T(METRICA.f_gs.nome), L("ROE vezes a parte do lucro que fica na empresa: quanto ela pode crescer só com o lucro retido, sem dívida nova nem emissão de ações (Gordon, 1962).",
          "ROE times the share of earnings kept in the business: how fast it can grow on retained earnings alone, without new debt or share issues (Gordon, 1962).")],
        [T(METRICA.f_desal.nome), L("Queda da dívida líquida/EBITDA em um ano. Balanço melhorando libera caixa para dividendos e reduz o risco; piorando, antecipa aperto.",
          "Fall in net debt/EBITDA over a year. An improving balance sheet frees cash for dividends and lowers risk; a worsening one signals strain ahead.")],
        [T(METRICA.f_cagr.nome), L("A tendência longa, com peso menor: crescimento passado se repete menos do que parece (Chan, Karceski e Lakonishok, 2003).",
          "The long trend, with a smaller weight: past growth persists less than it seems (Chan, Karceski and Lakonishok, 2003).")],
        [L("Quanto do preço depende de crescimento (informativo)", "Share of the price that relies on growth (informational)"), L("Uma empresa que nunca crescesse valeria lucro ÷ custo de capital. Com custo de 15% ao ano em reais (premissa), o que o preço tem acima disso é aposta no crescimento futuro (oportunidades de crescimento: Miller e Modigliani, 1961; expectativas no preço: Mauboussin e Rappaport, 2001). Aparece na explicação de cada empresa e não entra na nota.",
          "A company that never grew would be worth earnings ÷ cost of capital. At a 15% cost of capital in reais (an assumption), whatever the price holds above that is a bet on future growth (growth opportunities: Miller and Modigliani, 1961; expectations in the price: Mauboussin and Rappaport, 2001). It appears in each company's explanation and is not part of the score.")],
        [L("Proventos aprovados a receber (informativo)", "Approved payouts still to be paid (informational)"), L("Dividendos e JCP já declarados e ainda não pagos, segundo a B3: caixa que o acionista já tem a receber.",
          "Dividends and interest on equity already declared and not yet paid, according to B3: cash shareholders are already due.")],
      ].map(function (x) { return "<div><dt>" + esc(x[0]) + "</dt><dd>" + esc(x[1]) + "</dd></div>"; }).join("") + "</dl></section>";

    // perfis setoriais: tabela de pesos e um cartão por perfil
    var perfisComEmpresas = PERFIS.filter(function (p) { return (base.porPerfil[p.id] || []).length; });
    var destaque = {};
    if (ativo) X.visiveis().forEach(function (e) { destaque[perfilDe(e).id] = true; });
    if (ui.perfil) destaque[ui.perfil] = true;
    var barra = function (v) { return '<span class="rk-peso"><i style="width:' + v * 1.6 + 'px"></i><b class="num">' + v + "%</b></span>"; };
    var limiteTxt = function (p) {
      return p.limite.tipo === "pl" ? L("dívida > patrimônio", "debt > equity") : nf(1).format(p.limite.valor) + L("x o EBITDA", "x EBITDA");
    };
    var s4 =
      '<section class="secao" id="r-4"><div class="cartao i-cap"><h2>' + cap(3) + esc(L("Setor a setor", "Sector by sector")) + "</h2>" +
      "<p>" + esc(L("Os 59 segmentos da B3 se agrupam em perfis com a mesma lógica econômica. Cada perfil tem pesos próprios para os pilares e para os indicadores, um limite de dívida e uma lista do que olhar além dos números padronizados.",
        "B3's 59 segments are grouped into profiles that share the same economics. Each profile has its own pillar and indicator weights, a debt limit and a list of what to check beyond the standardized numbers.")) + "</p>" +
      '<div class="tabela-wrap"><table class="rk-pesos"><thead><tr><th>' + esc(L("Perfil", "Profile")) + '</th><th class="num">' + esc(L("Empresas", "Companies")) + "</th>" +
      PILARES.map(function (pl) { return "<th>" + esc(T(pl.nome)) + "</th>"; }).join("") + "<th>" + esc(L("Trava de dívida", "Debt cap")) + "</th></tr></thead><tbody>" +
      perfisComEmpresas.map(function (p) {
        return '<tr><td><a href="#rk-p-' + p.id + '" data-perfil="' + p.id + '">' + esc(T(p.curto)) + '</a></td><td class="num">' + base.porPerfil[p.id].length + "</td>" +
          PILARES.map(function (pl) { return "<td>" + barra(p.pesos[pl.id]) + "</td>"; }).join("") + "<td>" + esc(p.id === "financeiro" || p.id === "seguros" ? L("não se aplica a financeiras", "n/a for financials") : limiteTxt(p)) + "</td></tr>";
      }).join("") + "</tbody></table></div></div>" +
      '<div class="rk-perfis">' + perfisComEmpresas.map(function (p) {
        var membros = base.porPerfil[p.id];
        var segs = {};
        membros.forEach(function (r) { segs[X.setor(r.e)] = (segs[X.setor(r.e)] || 0) + 1; });
        var enfase = PILARES.map(function (pl) {
          var ms = METRICAS.filter(function (mt) { return mt.pilar === pl.id && pesoMetrica(p, mt) > 0; })
            .sort(function (a, b) { return pesoMetrica(p, b) - pesoMetrica(p, a); }).slice(0, 3).map(function (mt) { return T(mt.curto); });
          return "<li><b>" + esc(T(pl.nome)) + " " + p.pesos[pl.id] + "%:</b> " + esc(ms.join(", ")) + "</li>";
        }).join("");
        return '<details class="cartao rk-perfil" id="rk-p-' + p.id + '"' + (destaque[p.id] ? " open" : "") + "><summary><h3>" + esc(T(p.nome)) + '</h3><span class="mudo">' +
          esc(membros.length + L(membros.length === 1 ? " empresa" : " empresas", membros.length === 1 ? " company" : " companies") + " · " + Object.keys(segs).join(", ")) + "</span></summary>" +
          '<div class="rk-perfil-corpo"><p>' + esc(T(p.valor)) + "</p>" +
          '<div class="i-duas"><div><h4>' + esc(L("O que analisar", "What to analyse")) + "</h4><ul>" + p.pontos.map(function (x) { return "<li>" + esc(T(x)) + "</li>"; }).join("") + "</ul></div>" +
          "<div><h4>" + esc(L("O que acompanhar à frente", "What to watch ahead")) + "</h4><ul>" + p.futuro.map(function (x) { return "<li>" + esc(T(x)) + "</li>"; }).join("") + "</ul>" +
          "<h4>" + esc(L("Como a nota trata o setor", "How the score treats the sector")) + "</h4><p>" + esc(T(p.nota)) + '</p><ul class="rk-enfase">' + enfase + "</ul></div></div>" +
          '<p class="rk-membros">' + membros.map(function (r) {
            return '<a href="#/ranking/' + r.e.ticker + '" data-abrir="' + r.e.ticker + '"><b>' + r.e.ticker + '</b> <span class="rk-nota mini" style="--cor:' + corNota(r.nota) + '">' + r.nota + "</span></a>";
          }).join("") + "</p></div></details>";
      }).join("") + "</div></section>";

    var s5 =
      '<section class="cartao secao i-cap" id="r-5"><h2>' + cap(4) + esc(L("Limites", "Limits")) + "</h2><ul>" + [
        L("Só dados históricos e padronizados: não há projeções de analistas nem indicadores operacionais (inadimplência de bancos, velocidade de vendas de construtoras, sinistralidade de operadoras). Os pontos que a nota não mede estão em cada setor, para conferir nos relatórios das empresas.",
          "Only historical, standardized data: no analyst forecasts and no operating metrics (bank delinquency, homebuilder sales speed, health plan loss ratios). What the score does not measure is listed for each sector, to check in company reports."),
        L("A nota é relativa: compara com os pares e com o mercado de hoje, e muda quando eles mudam ou quando o preço anda.",
          "The score is relative: it compares with today's peers and market, and changes when they change or when the price moves."),
        L("Números como as empresas os entregaram à CVM; erros de preenchimento passam para a nota (a auditoria do Real Terms aponta os mais graves).",
          "Figures are as companies filed them with the CVM; filing errors flow into the score (the Real Terms audit flags the worst)."),
        L("O custo de capital de 15% é premissa apenas do indicador informativo de crescimento embutido no preço; não altera a nota.",
          "The 15% cost of capital is an assumption only for the informational growth-in-the-price indicator; it does not change the score."),
        L("Diluição por emissão de ações fica fora da nota: o histórico do número de ações nos dados públicos não registra todos os desdobramentos e bonificações, e a conta daria sinais falsos. Confira na página de cada empresa.",
          "Dilution from share issues is left out of the score: the share-count history in public data does not record every split and bonus issue, and the calculation would give false signals. Check it on each company page."),
        L("Não avalia gestão, estratégia, governança além do segmento de listagem, eventos futuros nem o seu perfil de investidor.",
          "It does not assess management, strategy, governance beyond the listing segment, future events or your own investor profile."),
      ].map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ul>" +
      '<p class="rk-aviso">' + esc(L(
        "Métrica quantitativa calculada por regras públicas a partir de dados históricos e do preço de hoje. Não é recomendação de compra ou venda, nem relatório de análise de valores mobiliários, e não considera objetivos, prazo ou tolerância a risco de quem investe.",
        "A quantitative metric computed with public rules from historical data and today's price. It is not a buy or sell recommendation or an equity research report, and it does not consider an investor's goals, horizon or risk tolerance.")) + "</p></section>";

    document.title = L("Ranking", "Ranking") + " · Real Terms";
    app.innerHTML = '<div class="pagina-lateral">' + nav + '<div class="rk">' + s1 + s2 + s3 + s4 + s5 + "</div></div>";

    // ------------------------------------------------------------ interação
    function abrir(tk, rolar) {
      ui.aberto = ui.aberto === tk ? null : tk;
      history.replaceState(null, "", ui.aberto ? "#/ranking/" + ui.aberto : "#/ranking");
      desenharTabela();
      var linha = ui.aberto && app.querySelector('tr.rk-linha[data-t="' + ui.aberto + '"]');
      if (linha && rolar) linha.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
    }
    app.querySelector("#rk-corpo").addEventListener("click", function (ev) {
      if (ev.target.closest("a")) return;
      var tr = ev.target.closest("tr.rk-linha");
      if (tr) abrir(tr.getAttribute("data-t"));
    });
    app.querySelector("#rk-corpo").addEventListener("keydown", function (ev) {
      var tr = ev.target.closest("tr.rk-linha");
      if (tr && (ev.key === "Enter" || ev.key === " ")) { ev.preventDefault(); abrir(tr.getAttribute("data-t")); }
    });
    var selPerfil = app.querySelector("#rk-perfil");
    if (selPerfil) selPerfil.addEventListener("change", function (ev) { ui.perfil = ev.target.value; ui.aberto = null; history.replaceState(null, "", "#/ranking"); desenharTabela(); });
    app.querySelector("#rk-ordem").addEventListener("change", function (ev) { ui.ordem = ev.target.value; desenharTabela(); });
    // empresas listadas nos cartões de setor abrem a explicação na tabela
    app.querySelector(".rk-perfis").addEventListener("click", function (ev) {
      var a = ev.target.closest("[data-abrir]");
      if (!a) return;
      ev.preventDefault();
      var r = base.porTicker[a.getAttribute("data-abrir")];
      if (ui.perfil && r && r.perfil.id !== ui.perfil) { ui.perfil = ""; if (selPerfil) selPerfil.value = ""; }
      ui.aberto = null;
      abrir(a.getAttribute("data-abrir"), true);
    });
    app.querySelector(".rk-pesos").addEventListener("click", function (ev) {
      var a = ev.target.closest("[data-perfil]");
      if (!a) return;
      ev.preventDefault();
      var card = document.getElementById("rk-p-" + a.getAttribute("data-perfil"));
      if (card) { card.open = true; card.scrollIntoView({ behavior: "smooth", block: "start" }); }
    });
    Array.prototype.forEach.call(app.querySelectorAll("[data-ir]"), function (a) {
      a.addEventListener("click", function (ev) {
        ev.preventDefault();
        var alvo = document.getElementById(a.getAttribute("data-ir"));
        if (alvo) alvo.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
      });
    });

    desenharTabela();
    X.observarSecoes();
    if (ui.aberto) {
      var tr = app.querySelector('tr.rk-linha[data-t="' + ui.aberto + '"]');
      if (tr && m) setTimeout(function () { tr.scrollIntoView({ block: "start" }); }, 0);
    }
  }

  /** proventos já aprovados e ainda não pagos do ticker principal (agenda da B3) */
  function aReceber(e) {
    var hoje = new Date().toISOString().slice(0, 10), lista = (window.AGENDA && window.AGENDA.empresas && window.AGENDA.empresas[e.cnpj]) || [];
    var soma = 0, ate = null;
    lista.forEach(function (x) {
      if (x.t === e.ticker && x.pag && x.pag >= hoje && x.valor > 0) { soma += x.valor; if (!ate || x.pag > ate) ate = x.pag; }
    });
    return soma > 0 ? { valor: soma, ate: ate } : null;
  }

  window.RealTermsRanking = {
    render: render, calcular: calcular, calcularBase: calcularBase, perfilDe: perfilDe,
    PERFIS: PERFIS, METRICAS: METRICAS, PILARES: PILARES, TETO: TETO, K: K,
  };
  // app.js roda primeiro; se a página aberta é o ranking, desenha agora
  if (typeof document !== "undefined" && document.body && document.body.getAttribute("data-pagina") === "ranking") render(document.getElementById("app"));
})();
