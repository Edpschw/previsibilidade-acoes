/**
 * Aba Qualidade (#/qualidade; #/qualidade/PETR4 mostra só uma empresa): controle de qualidade dos dados.
 *
 * Dados: data/qualidade.js (window.QUALIDADE), gerado por scripts/qualidade.py no fim de scripts/auditar.py,
 * carregado só quando a aba abre. A página mostra:
 *   - resumo: casos dos cruzamentos que batem, cobertura, ocorrências graves e data da base;
 *   - cruzamentos entre fontes (CVM, B3, Banco Central), do que mais bate para o que menos bate, cada um com
 *     a regra e as falhas (os dois valores comparados);
 *   - gráficos: casos que batem por grupo, LPA calculado × declarado, ações CVM × B3 e evolução diária;
 *   - cobertura (da B3 até a base) e atualização de cada fonte;
 *   - nota de confiabilidade por empresa, da melhor para a pior;
 *   - ocorrências das regras de plausibilidade da auditoria, por gravidade.
 */
(function () {
  "use strict";
  var X = window.RealTerms, L = X.L, esc = X.esc;
  var filtro = null, gravidades = { "alta": true, "média": true, "baixa": false, "info": false }, busca = "", abertos = {};

  var GRUPOS = {
    cvm: ["Dentro das demonstrações (CVM)", "Within the filings (CVM)"],
    cvm_b3: ["CVM × B3", "CVM × B3"],
    b3: ["B3 × B3", "B3 × B3"],
    bcb: ["Banco Central", "Central Bank"]
  };
  var GRAVIDADE = { "alta": ["Alta", "High"], "média": ["Média", "Medium"], "baixa": ["Baixa", "Low"], "info": ["Informativa", "Info"] };

  // cada cruzamento: nome, fontes, regra (com a folga), unidade dos valores e o nome dos dois lados
  var C = {
    dfc: {
      n: ["O fluxo de caixa fecha", "Cash flow adds up"], f: ["Demonstração dos fluxos de caixa (CVM)", "Cash flow statement (CVM)"],
      r: ["Operacional + investimento + financiamento + variação cambial = variação do caixa declarada. Folga: 2% do maior fluxo ou R$ 1 mi.",
        "Operating + investing + financing + FX effect = reported change in cash. Tolerance: 2% of the largest flow or R$ 1 million."],
      u: "mil", a: ["Soma dos fluxos", "Sum of flows"], b: ["Variação declarada", "Reported change"]
    },
    bruto_receita: {
      n: ["Lucro bruto não passa da receita", "Gross profit does not exceed revenue"], f: ["Demonstração do resultado (CVM)", "Income statement (CVM)"],
      r: ["Lucro bruto ≤ receita, com folga de 1%. Bancos e seguradoras ficam de fora.", "Gross profit ≤ revenue, 1% tolerance. Banks and insurers are left out."],
      u: "mil", a: ["Lucro bruto", "Gross profit"], b: ["Receita", "Revenue"]
    },
    pl_ativo: {
      n: ["Patrimônio não passa do ativo", "Equity does not exceed assets"], f: ["Balanço patrimonial (CVM)", "Balance sheet (CVM)"],
      r: ["Ativo maior que zero e patrimônio líquido ≤ ativo total, porque ativo = passivo + patrimônio. Folga de 1%.",
        "Assets above zero and equity ≤ total assets, because assets = liabilities + equity. 1% tolerance."],
      u: "mil", a: ["Patrimônio", "Equity"], b: ["Ativo", "Assets"]
    },
    ebitda_ebit: {
      n: ["EBITDA não fica abaixo do EBIT", "EBITDA is not below EBIT"], f: ["Resultado e fluxo de caixa (CVM)", "Income and cash flow statements (CVM)"],
      r: ["EBITDA = EBIT + depreciação e amortização, que não é negativa. Folga de 1%.", "EBITDA = EBIT + depreciation and amortization, which is not negative. 1% tolerance."],
      u: "mil", a: ["EBITDA", "EBITDA"], b: ["EBIT", "EBIT"]
    },
    ttm_anual: {
      n: ["12 meses perto do exercício", "Trailing 12 months near the fiscal year"], f: ["ITR × DFP (CVM)", "Quarterly × annual filings (CVM)"],
      r: ["Receita dos últimos 12 meses (ITR) entre metade e o dobro da receita do último exercício (DFP). Fora disso, só aquisição, cisão ou erro.",
        "Trailing 12-month revenue (quarterly filings) between half and twice the last fiscal year's (annual filing). Outside that, only an acquisition, a spin-off or an error."],
      u: "mil", a: ["12 meses", "12 months"], b: ["Exercício", "Fiscal year"]
    },
    lpa: {
      n: ["LPA calculado × LPA declarado", "Computed EPS × reported EPS"], f: ["Resultado × composição do capital (CVM)", "Income statement × share capital (CVM)"],
      r: ["Lucro da controladora ÷ ações (do fim do ano ou da média do ano) entre 0,67× e 1,5× o lucro por ação que a empresa declara. Ficam de fora os anos com ações estimadas pelo próprio LPA.",
        "Net income to shareholders ÷ shares (year-end or yearly average) between 0.67× and 1.5× the earnings per share the company reports. Years with shares estimated from that EPS are left out."],
      u: "rs4", a: ["Calculado", "Computed"], b: ["Declarado", "Reported"], razao: true
    },
    tesouraria: {
      n: ["Tesouraria não passa das ações emitidas", "Treasury shares do not exceed issued shares"], f: ["Composição do capital (CVM)", "Share capital (CVM)"],
      r: ["Ações em tesouraria de cada classe ≤ ações emitidas da classe.", "Treasury shares of each class ≤ issued shares of that class."],
      u: "acoes", a: ["Tesouraria", "Treasury"], b: ["Emitidas", "Issued"]
    },
    acoes_cvm_b3: {
      n: ["Ações: CVM × B3", "Shares: CVM × B3"], f: ["Composição do capital (CVM) × ficha da B3", "Share capital (CVM) × B3 issuer record"],
      r: ["Ações em circulação do último ITR ou DFP a até 5% das que a B3 informa hoje. Diferença maior: recompra, emissão ou cancelamento depois do balanço, ou tesouraria contada de outro jeito. O site usa a B3.",
        "Outstanding shares in the latest filing within 5% of B3's current count. A larger gap means a buyback, issuance or cancellation after the filing, or treasury counted differently. The site uses B3's."],
      u: "acoes", a: ["CVM", "CVM"], b: ["B3", "B3"]
    },
    vm_b3_dfp: {
      n: ["Valor de mercado: ações da B3 × da DFP", "Market cap: B3 shares × annual filing"], f: ["Ficha da B3 × DFP (CVM)", "B3 issuer record × annual filing (CVM)"],
      r: ["Valor de mercado com as ações da B3 hoje entre 0,8× e 1,25× o calculado com as ações da última DFP. Diferença maior: evento depois do balanço (o site usa a B3).",
        "Market cap with B3's current share count between 0.8× and 1.25× the one with the last annual filing's shares. A larger gap means an event after the filing (the site uses B3's)."],
      u: "mil", a: ["Pela B3", "With B3"], b: ["Pela DFP", "With filing"]
    },
    cotacao_hist: {
      n: ["Cotação: base × histórico diário", "Price: database × daily history"], f: ["COTAHIST (B3), dois programas", "COTAHIST (B3), two programs"],
      r: ["O último fechamento da base e o do histórico diário, lidos por programas diferentes, são o mesmo no mesmo dia (folga de meio centavo).",
        "The latest close in the database and in the daily history, read by different programs, are the same on the same day (half-cent tolerance)."],
      u: "rs", a: ["Base", "Database"], b: ["Histórico", "History"]
    },
    preco_ano_hist: {
      n: ["Preço de fim de exercício × histórico diário", "Year-end price × daily history"], f: ["COTAHIST (B3), dois programas", "COTAHIST (B3), two programs"],
      r: ["O fechamento do último pregão de cada ano, usado nos múltiplos históricos, bate com o histórico diário (folga de 0,1%).",
        "The close of each year's last session, used in historical multiples, matches the daily history (0.1% tolerance)."],
      u: "rs", a: ["Base", "Database"], b: ["Histórico", "History"]
    },
    agenda_hist: {
      n: ["Proventos: ficha × eventos corporativos", "Dividends: issuer record × corporate actions"], f: ["Duas páginas da B3", "Two B3 pages"],
      r: ["Cada provento da agenda (ficha da empresa na B3) aparece na página de eventos corporativos da B3 com a mesma data-com, o mesmo tipo e o mesmo valor (folga de 1%).",
        "Each dividend in the calendar (B3 issuer record) appears on B3's corporate actions page with the same record date, type and amount (1% tolerance)."],
      u: "rs4", a: ["Agenda", "Calendar"], b: ["Eventos", "Corporate actions"]
    },
    agenda_datas: {
      n: ["Pagamento depois da data-com", "Payment after the record date"], f: ["Ficha da B3", "B3 issuer record"],
      r: ["A data de pagamento de cada provento não vem antes da data-com.", "Each dividend's payment date is not before its record date."],
      u: "data", a: ["Data-com", "Record date"], b: ["Pagamento", "Payment"]
    },
    eventos_preco: {
      n: ["Desdobramento × salto do preço", "Split × price jump"], f: ["Ficha da B3 × COTAHIST (B3)", "B3 issuer record × COTAHIST (B3)"],
      r: ["No dia em que um desdobramento, grupamento ou bonificação passa a valer, o preço muda na proporção do fator (entre 0,65× e 1,5× dele).",
        "On the day a split, reverse split or stock dividend takes effect, the price moves in proportion to the factor (between 0.65× and 1.5× of it)."],
      u: "x", a: ["Salto do preço", "Price jump"], b: ["Fator", "Factor"]
    },
    escopo_liquidez: {
      n: ["Toda empresa acima do corte de liquidez", "Every company above the liquidity cut"], f: ["COTAHIST (B3)", "COTAHIST (B3)"],
      r: ["Volume médio dos últimos 21 pregões de pelo menos R$ 500 mil por dia (para entrar na base, R$ 1 mi).",
        "Average volume over the last 21 sessions of at least R$ 500,000 a day (R$ 1 million to join)."],
      u: "rsv", a: ["Volume por dia", "Daily volume"], b: ["Mínimo", "Minimum"]
    },
    ptax_media: {
      n: ["PTAX média de cada ano", "Yearly average PTAX"], f: ["Base × série diária do Banco Central", "Database × Central Bank daily series"],
      r: ["A PTAX média que converte resultado e fluxo de caixa para dólar bate com a média da série diária do Banco Central (folga de 0,5%).",
        "The average PTAX that converts income and cash flow to dollars matches the average of the Central Bank's daily series (0.5% tolerance)."],
      u: "ptax", a: ["Base", "Database"], b: ["Banco Central", "Central Bank"]
    },
    ptax_fim: {
      n: ["PTAX do fim de cada ano", "Year-end PTAX"], f: ["Base × série diária do Banco Central", "Database × Central Bank daily series"],
      r: ["A PTAX do último dia útil, que converte o balanço para dólar, bate com a série diária (folga de 0,1%).",
        "The last business day's PTAX, which converts balance sheets to dollars, matches the daily series (0.1% tolerance)."],
      u: "ptax", a: ["Base", "Database"], b: ["Banco Central", "Central Bank"]
    }
  };

  var FONTES = {
    cotacoes: ["Cotações (COTAHIST, B3)", "Prices (COTAHIST, B3)"],
    ptax: ["Câmbio (PTAX, Banco Central)", "FX rate (PTAX, Central Bank)"],
    historico: ["Histórico diário (B3 e Banco Central)", "Daily history (B3 and Central Bank)"],
    agenda: ["Agenda de proventos (fichas da B3)", "Dividend calendar (B3 issuer records)"],
    dfp: ["Demonstrações anuais (DFP, CVM)", "Annual filings (DFP, CVM)"],
    itr: ["Demonstrações trimestrais (ITR, CVM)", "Quarterly filings (ITR, CVM)"]
  };

  var REGRAS_EN = {
    "buraco no histórico": "gap in history", "LPA com sinal trocado na DRE": "EPS with flipped sign", "LPA declarado por lote de mil": "EPS reported per thousand shares",
    "LPA divergente": "EPS mismatch", "salto de ações": "share count jump", "evento pelo LPA reapresentado": "event found through restated EPS",
    "quebra de base": "share base break", "ajuste de base inferido": "inferred share adjustment", "ativo não positivo": "non-positive assets",
    "PL maior que o ativo": "equity above assets", "PL negativo": "negative equity", "receita não positiva": "non-positive revenue",
    "margem líquida extrema": "extreme net margin", "lucro bruto > receita": "gross profit > revenue", "controladora × consolidado": "parent × consolidated income",
    "receita salta": "revenue jump", "dividendos > 3× lucro": "dividends > 3× income", "sem cotação": "no price", "cotação parada": "stale price",
    "valor de mercado ausente": "missing market cap", "P/L extremo": "extreme P/E", "P/VP extremo": "extreme P/B", "DY acima de 30%": "yield above 30%",
    "fluxo de caixa não fecha": "cash flow does not add up", "caixa operacional > 2× EBITDA": "operating cash flow > 2× EBITDA",
    "caixa operacional > 2× EBITDA sem explicação": "operating cash flow > 2× EBITDA, unexplained", "ações B3 × DFP": "shares B3 × annual filing",
    "sem ficha na B3": "no B3 issuer record", "DY 12m × DY do exercício": "12-month yield × fiscal-year yield", "preço mudou de escala": "price changed scale",
    "sem últimos 12 meses": "no trailing 12 months", "ITR atrasado": "late quarterly filing", "unit sem composição": "unit without composition",
    "só demonstração individual": "parent-only statements"
  };

  // ---------------------------------------------------------------- formatos

  function T(par) { return L(par[0], par[1]); }
  function nf(c) { return X.nf(c); }
  function mil(v) {  // R$ mil
    if (v == null) return "–";
    var r = v * 1000, a = Math.abs(r);
    if (a >= 1e9) return "R$ " + nf(1).format(r / 1e9) + L(" bi", " bn");
    if (a >= 1e6) return "R$ " + nf(1).format(r / 1e6) + L(" mi", " m");
    return "R$ " + nf(0).format(r / 1e3) + L(" mil", "k");
  }
  function valor(v, u) {
    if (v == null) return L("ausente", "missing");
    if (u === "mil") return mil(v);
    if (u === "rsv") return mil(v / 1000);
    if (u === "rs") return "R$ " + nf(2).format(v);
    if (u === "rs4") return "R$ " + nf(4).format(v);
    if (u === "acoes") return X.qtd(v);
    if (u === "x") return nf(3).format(v) + "×";
    if (u === "ptax") return "R$ " + nf(4).format(v);
    if (u === "data") return X.data(v);
    return String(v);
  }
  function diferenca(f, c) {
    if (c.u === "data" || f.a == null || f.b == null) return "–";
    if (c.razao) return f.b ? nf(2).format(f.a / f.b) + "×" : "–";
    if (!f.b) return "–";
    var d = f.a / f.b - 1;
    return (d > 0 ? "+" : "") + nf(Math.abs(d) < 0.1 ? 2 : 1).format(d * 100) + "%";
  }
  function taxa(c) { return c.testados ? c.ok / c.testados : null; }
  function pctTxt(v, casas) { return v == null ? "–" : nf(casas == null ? 1 : casas).format(v * 100) + "%"; }
  function barra(v) {
    var cor = v >= 0.99 ? "var(--pos)" : v >= 0.95 ? "var(--warn)" : "var(--neg)";
    return '<span class="q-barra"><i style="width:' + Math.max(1, v * 100).toFixed(1) + "%;background:" + cor + '"></i></span>';
  }
  function linkEmpresa(t) {
    var e = X.POR_TICKER[t];
    return '<a href="#/' + esc(e ? e.ticker : t) + '"><b>' + esc(t) + "</b></a>" + (e ? ' <span class="mudo">' + esc(X.nomeCurto(e.nome)) + "</span>" : "");
  }
  function doFiltro(t) {
    if (!filtro) return true;
    var e = X.POR_TICKER[t];
    return t === filtro || (e && e.ticker === filtro);
  }

  // ---------------------------------------------------------------- gráficos (SVG próprio)

  /** dispersão em escala log nos dois eixos, com a diagonal (iguais) e as linhas da folga */
  function dispersao(pontos, folga, rotX, rotY) {
    var W = 420, H = 300, m = { l: 52, r: 12, t: 12, b: 40 };
    var vals = pontos.filter(function (p) { return p[0] && p[1]; }).map(function (p) { return [Math.abs(p[0]), Math.abs(p[1]), p[2]]; });
    if (!vals.length) return "";
    var lo = Infinity, hi = -Infinity;
    vals.forEach(function (p) { lo = Math.min(lo, p[0], p[1]); hi = Math.max(hi, p[0], p[1]); });
    var l0 = Math.floor(Math.log10(lo)), l1 = Math.ceil(Math.log10(hi));
    if (l1 === l0) l1 = l0 + 1;
    var sx = function (v) { return m.l + (Math.log10(v) - l0) / (l1 - l0) * (W - m.l - m.r); };
    var sy = function (v) { return H - m.b - (Math.log10(v) - l0) / (l1 - l0) * (H - m.t - m.b); };
    var g = "";
    for (var k = l0; k <= l1; k++) {
      var v = Math.pow(10, k);
      g += '<line x1="' + m.l + '" x2="' + (W - m.r) + '" y1="' + sy(v) + '" y2="' + sy(v) + '" stroke="var(--border)"/>' +
        '<text x="' + (m.l - 6) + '" y="' + (sy(v) + 4) + '" text-anchor="end" class="q-eixo">' + rotLog(k) + "</text>" +
        '<text x="' + sx(v) + '" y="' + (H - m.b + 16) + '" text-anchor="middle" class="q-eixo">' + rotLog(k) + "</text>";
    }
    var a = Math.pow(10, l0), b = Math.pow(10, l1);
    g += '<line x1="' + sx(a) + '" y1="' + sy(a) + '" x2="' + sx(b) + '" y2="' + sy(b) + '" stroke="var(--muted)" stroke-width="1"/>';
    folga.forEach(function (f) {
      var a2 = Math.max(a, a / f), b2 = Math.min(b, b / f);
      g += '<line x1="' + sx(a2) + '" y1="' + sy(a2 * f) + '" x2="' + sx(b2) + '" y2="' + sy(b2 * f) + '" stroke="var(--muted)" stroke-dasharray="3 3" stroke-width="1"/>';
    });
    // os que batem primeiro, os que falham por cima (ficam visíveis)
    vals.sort(function (p, q) { return p[2] - q[2]; }).reverse();
    vals.forEach(function (p) {
      g += '<circle cx="' + sx(p[0]).toFixed(1) + '" cy="' + sy(p[1]).toFixed(1) + '" r="' + (p[2] ? 2.2 : 3) + '" fill="' + (p[2] ? "var(--pos)" : "var(--neg)") + '" fill-opacity="' + (p[2] ? 0.45 : 0.9) + '"/>';
    });
    g += '<text x="' + ((W + m.l) / 2) + '" y="' + (H - 6) + '" text-anchor="middle" class="q-eixo">' + esc(rotX) + "</text>" +
      '<text x="14" y="' + ((H - m.b) / 2) + '" text-anchor="middle" class="q-eixo" transform="rotate(-90 14 ' + ((H - m.b) / 2) + ')">' + esc(rotY) + "</text>";
    return '<svg viewBox="0 0 ' + W + " " + H + '" class="q-grafico" role="img">' + g + "</svg>";
  }
  function rotLog(k) {
    if (k >= 9) return nf(0).format(Math.pow(10, k - 9)) + L(" bi", " bn");
    if (k >= 6) return nf(0).format(Math.pow(10, k - 6)) + L(" mi", " m");
    if (k >= 3) return nf(0).format(Math.pow(10, k - 3)) + L(" mil", "k");
    return k >= 0 ? nf(0).format(Math.pow(10, k)) : nf(-k).format(Math.pow(10, k));
  }

  /** barras horizontais do maior para o menor valor */
  function barras(itens) {
    return '<div class="q-barras">' + itens.map(function (x) {
      return '<div class="q-barras-linha"><span>' + esc(x.rot) + '</span>' + barra(x.v) + '<b class="num">' + pctTxt(x.v, 2) + "</b></div>";
    }).join("") + "</div>";
  }

  /** evolução diária da parcela de casos que batem e das ocorrências graves */
  function evolucao(hist) {
    if (hist.length < 2) {
      return '<p class="mudo">' + L("A evolução começa a aparecer a partir do próximo pregão: cada execução diária guarda um ponto.",
        "The trend starts with the next session: each daily run stores one point.") + "</p>";
    }
    var W = 420, H = 200, m = { l: 46, r: 12, t: 12, b: 28 };
    var ys = hist.map(function (h) { return h.ok / h.testes; });
    var lo = Math.min.apply(null, ys), hi = Math.max.apply(null, ys);
    lo = Math.max(0, Math.floor((lo - 0.005) * 100) / 100); hi = Math.min(1, Math.ceil((hi + 0.002) * 100) / 100);
    if (hi <= lo) hi = lo + 0.01;
    var sx = function (i) { return m.l + i / (hist.length - 1) * (W - m.l - m.r); };
    var sy = function (v) { return H - m.b - (v - lo) / (hi - lo) * (H - m.t - m.b); };
    var d = ys.map(function (v, i) { return (i ? "L" : "M") + sx(i).toFixed(1) + " " + sy(v).toFixed(1); }).join(" ");
    var g = [lo, (lo + hi) / 2, hi].map(function (v) {
      return '<line x1="' + m.l + '" x2="' + (W - m.r) + '" y1="' + sy(v) + '" y2="' + sy(v) + '" stroke="var(--border)"/>' +
        '<text x="' + (m.l - 6) + '" y="' + (sy(v) + 4) + '" text-anchor="end" class="q-eixo">' + pctTxt(v, 1) + "</text>";
    }).join("");
    g += '<path d="' + d + '" fill="none" stroke="var(--accent)" stroke-width="2"/>' +
      '<text x="' + m.l + '" y="' + (H - 8) + '" class="q-eixo">' + X.data(hist[0].data) + "</text>" +
      '<text x="' + (W - m.r) + '" y="' + (H - 8) + '" text-anchor="end" class="q-eixo">' + X.data(hist[hist.length - 1].data) + "</text>";
    return '<svg viewBox="0 0 ' + W + " " + H + '" class="q-grafico" role="img">' + g + "</svg>";
  }

  // ---------------------------------------------------------------- seções

  function resumo(q) {
    var r = q.resumo, cov = q.cobertura;
    var st = function (rot, v, extra) { return '<div class="stat"><span>' + rot + '</span><b class="num">' + v + "</b>" + (extra ? '<small class="mudo">' + extra + "</small>" : "") + "</div>"; };
    return '<section class="intro"><h1>' + L("Qualidade dos dados", "Data quality") + "</h1><p>" +
      L("Cada número do site vem de uma fonte pública (CVM, B3 e Banco Central). Aqui ele é conferido contra outra fonte ou contra outra leitura da mesma fonte: o que tem de bater, bate? A conferência roda todo dia útil, junto com a atualização da base, e trava a publicação se a base piorar.",
        "Every number on this site comes from a public source (CVM, B3 and the Central Bank). Here it is checked against another source or another reading of the same source: does what must match, match? The check runs every business day with the data update, and blocks publication if the data gets worse.") +
      "</p></section>" +
      '<section class="cartao"><div class="stats q-stats">' +
      st(L("Casos que batem", "Cases that match"), pctTxt(r.ok / r.testes, 2), nf(0).format(r.ok) + " " + L("de", "of") + " " + nf(0).format(r.testes)) +
      st(L("Cruzamentos", "Cross-checks"), q.checagens.length, L("entre CVM, B3 e Banco Central", "across CVM, B3 and the Central Bank")) +
      st(L("Cobertura", "Coverage"), pctTxt(cov.cobertura, 0), nf(0).format(cov.na_base) + " " + L("de", "of") + " " + nf(0).format(cov.acima_corte) + " " + L("emissores líquidos", "liquid issuers")) +
      st(L("Ocorrências graves", "Serious issues"), r.alta, L("regras de plausibilidade", "plausibility rules")) +
      st(L("Base de", "Data as of"), X.data(q.gerado_em.slice(0, 10)), L("cotações de ", "prices of ") + X.data(q.cotacoes_em)) +
      "</div></section>";
  }

  function cruzamentos(q) {
    var lista = q.checagens.slice().sort(function (a, b) { return (taxa(b) || 0) - (taxa(a) || 0) || b.testados - a.testados; });
    var linhas = lista.map(function (c) {
      var d = C[c.id] || { n: [c.id, c.id], f: ["", ""], r: ["", ""], u: "", a: ["A", "A"], b: ["B", "B"] };
      var falhas = c.falhas.filter(function (f) { return !f.t || doFiltro(f.t); });
      var v = taxa(c);
      var botao = c.n_falhas ? '<button type="button" class="q-ver" data-cruz="' + c.id + '" aria-expanded="' + (abertos[c.id] ? "true" : "false") + '">' +
        nf(0).format(filtro ? falhas.length : c.n_falhas) + "</button>" : '<span class="pos">0</span>';
      var linha = "<tr><td class=\"q-quebra\"><b>" + esc(T(d.n)) + '</b><br><span class="mudo q-fonte">' + esc(T(GRUPOS[c.grupo] || ["", ""])) + " · " + esc(T(d.f)) + "</span></td>" +
        '<td class="num">' + nf(0).format(c.testados) + '</td><td class="num">' + (v == null ? "–" : barra(v) + " " + pctTxt(v, 1)) + '</td><td class="num">' + botao + "</td></tr>";
      if (abertos[c.id]) {
        var corpo = falhas.slice(0, 60).map(function (f) {
          return "<tr><td>" + (f.t ? linkEmpresa(f.t) : "–") + "</td><td>" + esc(f.ano != null ? String(f.ano) : X.data(f.data)) + '</td><td class="num">' +
            esc(valor(f.a, d.u)) + '</td><td class="num">' + esc(valor(f.b, d.u)) + '</td><td class="num">' + esc(diferenca(f, d)) + "</td></tr>";
        }).join("");
        var resto = (filtro ? falhas.length : c.n_falhas) - Math.min(falhas.length, 60);
        linha += '<tr class="q-detalhe"><td colspan="4" class="q-quebra"><p class="mudo">' + esc(T(d.r)) + "</p>" +
          (corpo ? '<div class="tabela-wrap"><table class="q-tab"><thead><tr><th>' + L("Empresa", "Company") + "</th><th>" + L("Ano ou data", "Year or date") + '</th><th class="num">' +
            esc(T(d.a)) + '</th><th class="num">' + esc(T(d.b)) + '</th><th class="num">' + L("Diferença", "Difference") + "</th></tr></thead><tbody>" + corpo + "</tbody></table></div>" :
            '<p class="mudo">' + L("Nenhuma falha desta empresa.", "No failures for this company.") + "</p>") +
          (resto > 0 ? '<p class="mudo">' + L("…e mais ", "…and ") + nf(0).format(resto) + L(" falhas.", " more failures.") + "</p>" : "") + "</td></tr>";
      }
      return linha;
    }).join("");
    return '<section class="cartao bloco"><h2>' + L("Cruzamentos entre fontes", "Cross-checks between sources") + "</h2><p class=\"mudo\">" +
      L("Do que mais bate para o que menos bate. Clique no número de falhas para ver a regra e os dois valores de cada caso.",
        "From the most to the least consistent. Click the number of failures to see the rule and both values of each case.") +
      '</p><div class="tabela-wrap"><table class="q-tab q-cruz"><thead><tr><th>' + L("Cruzamento", "Cross-check") + '</th><th class="num">' + L("Casos", "Cases") +
      '</th><th class="num">' + L("Batem", "Match") + '</th><th class="num">' + L("Falhas", "Failures") + "</th></tr></thead><tbody>" + linhas + "</tbody></table></div></section>";
  }

  function graficos(q) {
    var grupos = {};
    q.checagens.forEach(function (c) {
      var g = grupos[c.grupo] || (grupos[c.grupo] = { t: 0, ok: 0 });
      g.t += c.testados; g.ok += c.ok;
    });
    var itens = Object.keys(grupos).map(function (k) { return { rot: T(GRUPOS[k] || [k, k]), v: grupos[k].ok / grupos[k].t }; })
      .sort(function (a, b) { return b.v - a.v; });
    var lpa = (q.pontos && q.pontos.lpa) || [], acoes = (q.pontos && q.pontos.acoes) || [];
    return '<section class="cartao bloco"><h2>' + L("Gráficos de conferência", "Check charts") + '</h2><div class="q-graficos">' +
      '<figure><figcaption><b>' + L("Casos que batem, por grupo", "Cases that match, by group") + "</b></figcaption>" + barras(itens) + "</figure>" +
      '<figure><figcaption><b>' + L("Evolução dos casos que batem", "Cases that match over time") + "</b></figcaption>" + evolucao(q.historico || []) + "</figure>" +
      '<figure><figcaption><b>' + L("LPA calculado × LPA declarado", "Computed EPS × reported EPS") + '</b><br><span class="mudo">' +
      L("Cada ponto é uma empresa num ano. Na diagonal, os dois batem; as tracejadas marcam a folga (0,67× e 1,5×). Vermelho: fora da folga.",
        "Each dot is a company in a year. On the diagonal both match; dashed lines mark the tolerance (0.67× and 1.5×). Red: outside it.") +
      "</span></figcaption>" + dispersao(lpa, [1 / 1.5, 1 / 0.67], L("LPA calculado (R$, valor absoluto)", "Computed EPS (R$, absolute)"), L("LPA declarado", "Reported EPS")) + "</figure>" +
      '<figure><figcaption><b>' + L("Ações em circulação: CVM × B3", "Outstanding shares: CVM × B3") + '</b><br><span class="mudo">' +
      L("Uma empresa por ponto. As tracejadas marcam ±5%.", "One company per dot. Dashed lines mark ±5%.") + "</span></figcaption>" +
      dispersao(acoes, [0.95, 1.05], L("CVM (último ITR ou DFP)", "CVM (latest filing)"), L("B3 (hoje)", "B3 (today)")) + "</figure>" +
      "</div></section>";
  }

  function cobertura(q) {
    var c = q.cobertura, max = c.emissores_negociados || 1;
    var degrau = function (rot, v, nota) {
      return '<div class="q-funil-linha"><span>' + rot + '</span><span class="q-barra"><i style="width:' + (v / max * 100).toFixed(1) + '%;background:var(--accent)"></i></span><b class="num">' +
        nf(0).format(v) + "</b>" + (nota ? '<small class="mudo">' + nota + "</small>" : "") + "</div>";
    };
    var atual = q.atualizacao.map(function (x) {
      return "<tr><td class=\"q-quebra\">" + esc(T(FONTES[x.id] || [x.id, x.id])) + "</td><td>" + (x.id === "dfp" ? esc(x.data) : X.data(x.data)) +
        (x.id === "itr" && x.total ? ' <span class="mudo">(' + nf(0).format(x.n) + " " + L("de", "of") + " " + nf(0).format(x.total) + ")</span>" : "") +
        "</td><td>" + (x.ok ? '<span class="pos">✓ ' + L("em dia", "up to date") + "</span>" : '<span class="neg">✗ ' + L("atrasada", "late") + "</span>") + "</td></tr>";
    }).join("");
    var fora = c.fora.length ? '<div class="tabela-wrap"><table class="q-tab"><thead><tr><th>Ticker</th><th>' + L("Nome na B3", "B3 name") + '</th><th class="num">' + L("Volume por dia", "Daily volume") +
      "</th><th>" + L("Por que ficou de fora", "Why it is missing") + "</th></tr></thead><tbody>" + c.fora.map(function (x) {
        return "<tr><td><b>" + esc(x.t) + "</b></td><td>" + esc(x.nome) + '</td><td class="num">' + mil(x.volume / 1000) + "</td><td class=\"q-quebra\">" + esc(x.motivo) + "</td></tr>";
      }).join("") + "</tbody></table></div>" : '<p class="pos">' + L("Nenhum emissor acima do corte de liquidez ficou de fora da base.", "No issuer above the liquidity cut is missing from the database.") + "</p>";
    return '<section class="cartao bloco"><h2>' + L("Cobertura e atualização", "Coverage and freshness") + '</h2><div class="q-duas"><div><h3>' +
      L("Da B3 até a base", "From B3 to the database") + "</h3>" +
      degrau(L("Emissores com ação negociada", "Issuers with traded shares"), c.emissores_negociados, L("últimos ", "last ") + c.pregoes + L(" pregões", " sessions")) +
      degrau(L("Acima do corte de liquidez", "Above the liquidity cut"), c.acima_corte, L("R$ 1 mi por dia", "R$ 1 million a day")) +
      degrau(L("Na base", "In the database"), c.na_base, pctTxt(c.cobertura, 0)) + fora +
      '<p class="mudo">' + L("Referências públicas de empresas listadas: ", "Public counts of listed companies: ") +
      c.referencias.map(function (r) { return esc(r[0]) + ": " + esc(r[1]); }).join(" · ") + "</p>" +
      "</div><div><h3>" + L("Data de cada fonte", "Date of each source") + '</h3><div class="tabela-wrap"><table class="q-tab"><thead><tr><th>' + L("Fonte", "Source") + "</th><th>" +
      L("Mais recente", "Latest") + "</th><th>" + L("Situação", "Status") + "</th></tr></thead><tbody>" + atual + "</tbody></table></div></div></div>" +
      externo(q) + "</section>";
  }

  function externo(q) {
    if (!q.externo || !q.externo.length) return "";
    return "<h3>" + L("Referência externa: brapi.dev", "External reference: brapi.dev") + '</h3><div class="tabela-wrap"><table class="q-tab"><thead><tr><th>Ticker</th><th class="num">' +
      L("Cotação na base", "Price here") + '</th><th class="num">brapi</th><th class="num">' + L("Valor de mercado na base", "Market cap here") + '</th><th class="num">brapi</th><th class="num">' +
      L("Diferença", "Difference") + "</th></tr></thead><tbody>" + q.externo.map(function (x) {
        return "<tr><td><b>" + esc(x.t) + '</b></td><td class="num">' + esc(x.preco_base) + '</td><td class="num">' + esc(x.preco_ext) + '</td><td class="num">' + esc(x.vm_base) +
          '</td><td class="num">' + esc(x.vm_ext) + '</td><td class="num">' + esc(x.dif) + "</td></tr>";
      }).join("") + "</tbody></table></div>";
  }

  function porEmpresa(q) {
    var termo = busca.trim().toUpperCase();
    var lista = q.empresas.filter(function (x) { return doFiltro(x.t) && (!termo || x.t.indexOf(termo) >= 0 || x.nome.toUpperCase().indexOf(termo) >= 0); });
    var chip = function (n, cls, rot) { return n ? '<span class="q-sev ' + cls + '">' + n + " " + rot + "</span>" : ""; };
    var linhas = lista.map(function (x) {
      return "<tr><td>" + linkEmpresa(x.t) + ' <a class="mudo q-filtrar" href="#/qualidade/' + esc(x.t) + '">' + L("ver ocorrências", "see issues") + "</a></td>" +
        '<td class="num">' + barra(x.nota / 100) + " " + x.nota + "</td><td>" +
        (chip(x.alta, "alta", L("alta", "high")) + chip(x.media, "media", L("média", "medium")) + chip(x.baixa, "baixa", L("baixa", "low")) + chip(x.info, "info", "info") ||
          '<span class="pos">' + L("nenhuma", "none") + "</span>") + "</td></tr>";
    }).join("");
    return '<section class="cartao bloco"><h2>' + L("Confiabilidade por empresa", "Reliability by company") + '</h2><p class="mudo">' +
      L("Nota de 0 a 100: começa em 100 e perde 25 por ocorrência alta, 10 por média e 3 por baixa (regras de plausibilidade e cruzamentos que só elas não cobrem). Da melhor para a pior.",
        "Score from 0 to 100: it starts at 100 and loses 25 per high issue, 10 per medium and 3 per low (plausibility rules and the cross-checks they do not cover). From best to worst.") +
      '</p><label class="q-busca"><input type="search" id="q-busca" placeholder="' + L("Filtrar por ticker ou nome", "Filter by ticker or name") + '" value="' + esc(busca) + '"></label>' +
      '<div class="tabela-wrap q-rolagem"><table class="q-tab"><thead><tr><th>' + L("Empresa", "Company") + '</th><th class="num">' + L("Nota", "Score") + "</th><th>" +
      L("Ocorrências", "Issues") + "</th></tr></thead><tbody>" + linhas + "</tbody></table></div></section>";
  }

  function ocorrencias(q) {
    var ordem = { "alta": 0, "média": 1, "baixa": 2, "info": 3 };
    var cont = { "alta": 0, "média": 0, "baixa": 0, "info": 0 };
    q.achados.forEach(function (a) { if (doFiltro(a.t)) cont[a.sev]++; });
    var lista = q.achados.filter(function (a) { return gravidades[a.sev] && doFiltro(a.t); })
      .sort(function (a, b) { return ordem[a.sev] - ordem[b.sev] || a.regra.localeCompare(b.regra) || a.t.localeCompare(b.t); });
    var chips = Object.keys(GRAVIDADE).map(function (s) {
      return '<button type="button" data-sev="' + s + '" aria-pressed="' + (gravidades[s] ? "true" : "false") + '">' + T(GRAVIDADE[s]) + " · " + cont[s] + "</button>";
    }).join("");
    var linhas = lista.slice(0, 400).map(function (a) {
      return '<tr><td><span class="q-sev ' + (a.sev === "média" ? "media" : a.sev) + '">' + T(GRAVIDADE[a.sev]) + "</span></td><td>" + linkEmpresa(a.t) + "</td><td>" +
        esc(L(a.regra, REGRAS_EN[a.regra] || a.regra)) + "</td><td class=\"q-quebra\">" + esc(a.msg) + "</td></tr>";
    }).join("");
    return '<section class="cartao bloco"><h2>' + L("Regras de plausibilidade", "Plausibility rules") + '</h2><p class="mudo">' +
      L("Números que não podem ser comparados com outra fonte, mas que precisam fazer sentido: múltiplos e margens fora de faixa, saltos na série, cotação parada, LPA com sinal trocado. Em geral são erros de preenchimento da própria empresa ou situações reais (holding sem receita, empresa em recuperação), e nada muda no número publicado: a ocorrência fica aqui à vista.",
        "Numbers that cannot be compared with another source but must make sense: multiples and margins out of range, jumps in the series, stale prices, EPS with a flipped sign. They are usually the company's own filing errors or real situations (holding with no revenue, company in restructuring); the published number does not change, and the issue stays visible here.") +
      (L("", " Details are in Portuguese, as the audit writes them.")) +
      '</p><div class="pilulas q-pilulas">' + chips + '</div><div class="tabela-wrap q-rolagem"><table class="q-tab"><thead><tr><th>' + L("Gravidade", "Severity") + "</th><th>" + L("Empresa", "Company") +
      "</th><th>" + L("Regra", "Rule") + "</th><th>" + L("Detalhe", "Detail") + "</th></tr></thead><tbody>" +
      (linhas || '<tr><td colspan="4" class="mudo">' + L("Nenhuma ocorrência com esse filtro.", "No issues with this filter.") + "</td></tr>") + "</tbody></table></div></section>";
  }

  function metodo() {
    return '<section class="cartao bloco metodo"><details><summary>' + L("Como a conferência funciona", "How the check works") + "</summary><ul>" +
      [L("Cobertura: parte de toda ação negociada na B3 nos últimos 21 pregões e diz, de cada emissor líquido que falta, em que etapa ele caiu.",
        "Coverage: starts from every share traded on B3 in the last 21 sessions and tells, for each missing liquid issuer, where it dropped out."),
      L("Cruzamentos: o mesmo número lido em duas fontes, ou por dois programas, tem de bater dentro da folga de cada regra. Uma falha é investigada: quando é erro do processamento, vira correção com teste (por exemplo, o preço de fim de 2020 e de 2024, que pegava o pregão anterior ao último); quando é da fonte, fica registrada aqui.",
        "Cross-checks: the same number, read from two sources or by two programs, must match within each rule's tolerance. A failure is investigated: if it is a processing error, it becomes a fix with a test (for example, the 2020 and 2024 year-end prices, which took the session before the last); if it comes from the source, it stays recorded here."),
      L("Plausibilidade: regras que pegam números estranhos que nenhuma outra fonte confirma ou desmente.", "Plausibility: rules that flag odd numbers that no other source confirms or refutes."),
      L("Trava: se a cobertura cair abaixo de 97%, a base encolher mais de 5% ou surgirem mais de 5 ocorrências graves novas, a atualização do dia não é publicada.",
        "Lock: if coverage drops below 97%, the database shrinks by more than 5% or more than 5 new serious issues appear, that day's update is not published."),
      L("Ferramenta de dados, não recomendação de investimento.", "A data tool, not investment advice.")].map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") +
      "</ul></details></section>";
  }

  // ---------------------------------------------------------------- página

  function desenhar(app, q) {
    var aviso = filtro ? '<p class="q-filtro">' + L("Mostrando só ", "Showing only ") + "<b>" + esc(filtro) + '</b>. <a href="#/qualidade">' + L("Ver todas as empresas", "See all companies") + "</a></p>" : "";
    app.innerHTML = resumo(q) + aviso + cruzamentos(q) + graficos(q) + cobertura(q) + porEmpresa(q) + ocorrencias(q) + metodo();
    app.querySelectorAll("[data-cruz]").forEach(function (b) {
      b.addEventListener("click", function () {
        var id = b.getAttribute("data-cruz");
        abertos[id] = !abertos[id];
        manterRolagem(app, q);
      });
    });
    app.querySelectorAll("[data-sev]").forEach(function (b) {
      b.addEventListener("click", function () {
        var s = b.getAttribute("data-sev");
        gravidades[s] = !gravidades[s];
        manterRolagem(app, q);
      });
    });
    var campo = app.querySelector("#q-busca");
    if (campo) campo.addEventListener("input", function () {
      busca = campo.value;
      manterRolagem(app, q, "#q-busca");
    });
  }
  function manterRolagem(app, q, foco) {
    var y = window.scrollY;
    desenhar(app, q);
    window.scrollTo(0, y);
    if (foco) {
      var el = app.querySelector(foco);
      if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
    }
  }

  function carregar(fn) {
    if (window.QUALIDADE) return fn(window.QUALIDADE);
    var s = document.createElement("script");
    s.src = "data/qualidade.js?v=" + encodeURIComponent(X.D.gerado_em || "");
    s.onload = function () { fn(window.QUALIDADE || null); };
    s.onerror = function () { fn(null); };
    document.head.appendChild(s);
  }

  function render(app) {
    var m = location.hash.match(/^#\/qualidade\/([A-Za-z0-9]+)/);
    filtro = m ? m[1].toUpperCase() : null;
    document.title = L("Qualidade dos dados", "Data quality") + " · Real Terms";
    app.innerHTML = '<p class="mudo" style="padding:40px 0">' + L("Carregando a conferência…", "Loading the checks…") + "</p>";
    carregar(function (q) {
      if (!q) {
        app.innerHTML = '<p class="neg" style="padding:40px 0">' + L("Não foi possível carregar data/qualidade.js.", "Could not load data/qualidade.js.") + "</p>";
        return;
      }
      desenhar(app, q);
      window.scrollTo(0, 0);
    });
  }

  window.RealTermsQualidade = { render: render };
  // aberta direto pelo endereço: app.js roda a rota antes deste arquivo carregar
  if (document.body.getAttribute("data-pagina") === "qualidade") render(document.getElementById("app"));
})();
