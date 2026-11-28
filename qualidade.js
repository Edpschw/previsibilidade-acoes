/**
 * Aba Qualidade (#/qualidade; #/qualidade/PETR4 abre só uma empresa): conferência dos dados, empresa a empresa.
 *
 * Dados: data/qualidade.js (window.QUALIDADE), gerado por scripts/qualidade.py no fim de scripts/auditar.py e
 * carregado só quando a aba abre. Traz, de cada empresa, todos os casos de cada cruzamento entre fontes (os que
 * batem e os que falham, com os dois valores comparados), a nota de confiabilidade e as ocorrências das regras
 * de plausibilidade da auditoria. A página mostra:
 *   - o resumo das empresas em análise: toda a base, o setor da barra sob o cabeçalho ou a empresa do endereço;
 *   - uma linha por empresa, da melhor para a pior nota, com um quadradinho por cruzamento (verde: todos os
 *     casos batem; vermelho: algum falha; cinza: não se aplica). Aberta, a linha mostra cada cruzamento com
 *     todos os casos, a referência externa (quando há) e as ocorrências;
 *   - o que vale para toda a base: PTAX × Banco Central, cobertura da B3 até a base e data de cada fonte.
 * Valores em reais, como nas fontes: o seletor R$/US$ não muda esta página.
 */
(function () {
  "use strict";
  var X = window.RealTerms, L = X.L, esc = X.esc;
  var filtro = null, busca = "", modo = "todas", abertas = {};

  var GRUPOS = {
    cvm: ["Dentro das demonstrações (CVM)", "Within the filings (CVM)"],
    cvm_b3: ["CVM × B3", "CVM × B3"],
    b3: ["B3 × B3", "B3 × B3"],
    bcb: ["Banco Central", "Central Bank"]
  };
  var GRAVIDADE = { "alta": ["Alta", "High"], "média": ["Média", "Medium"], "baixa": ["Baixa", "Low"], "info": ["Informativa", "Info"] };

  // cada cruzamento: nome, fontes, regra (com a folga), unidade dos valores, nome dos dois lados e a coluna
  // que compara os dois (cmp: pct = diferença em %, razao = A ÷ B, parte = A como % de B, menos = A − B,
  // dias = dias entre as duas datas)
  var C = {
    dfc: {
      n: ["O fluxo de caixa fecha", "Cash flow adds up"], f: ["Demonstração dos fluxos de caixa (CVM)", "Cash flow statement (CVM)"],
      r: ["Operacional + investimento + financiamento + variação cambial = variação do caixa declarada. Folga: 2% do maior fluxo ou R$ 1 mi.",
        "Operating + investing + financing + FX effect = reported change in cash. Tolerance: 2% of the largest flow or R$ 1 million."],
      u: "mil", a: ["Soma dos fluxos", "Sum of flows"], b: ["Variação declarada", "Reported change"], cmp: ["pct", "Diferença", "Difference"]
    },
    bruto_receita: {
      n: ["Lucro bruto não passa da receita", "Gross profit does not exceed revenue"], f: ["Demonstração do resultado (CVM)", "Income statement (CVM)"],
      r: ["Lucro bruto ≤ receita, com folga de 1%. Bancos e seguradoras ficam de fora.", "Gross profit ≤ revenue, 1% tolerance. Banks and insurers are left out."],
      u: "mil", a: ["Lucro bruto", "Gross profit"], b: ["Receita", "Revenue"], cmp: ["parte", "Margem bruta", "Gross margin"]
    },
    pl_ativo: {
      n: ["Patrimônio não passa do ativo", "Equity does not exceed assets"], f: ["Balanço patrimonial (CVM)", "Balance sheet (CVM)"],
      r: ["Ativo maior que zero e patrimônio líquido ≤ ativo total, porque ativo = passivo + patrimônio. Folga de 1%.",
        "Assets above zero and equity ≤ total assets, because assets = liabilities + equity. 1% tolerance."],
      u: "mil", a: ["Patrimônio", "Equity"], b: ["Ativo", "Assets"], cmp: ["parte", "PL / ativo", "Equity / assets"]
    },
    ebitda_ebit: {
      n: ["EBITDA não fica abaixo do EBIT", "EBITDA is not below EBIT"], f: ["Resultado e fluxo de caixa (CVM)", "Income and cash flow statements (CVM)"],
      r: ["EBITDA = EBIT + depreciação e amortização, que não é negativa. Folga de 1%.", "EBITDA = EBIT + depreciation and amortization, which is not negative. 1% tolerance."],
      u: "mil", a: ["EBITDA", "EBITDA"], b: ["EBIT", "EBIT"], cmp: ["menos", "Depreciação", "Depreciation"]
    },
    ttm_anual: {
      n: ["12 meses perto do exercício", "Trailing 12 months near the fiscal year"], f: ["ITR × DFP (CVM)", "Quarterly × annual filings (CVM)"],
      r: ["Receita dos últimos 12 meses (ITR) entre metade e o dobro da receita do último exercício (DFP). Fora disso, só aquisição, cisão ou erro.",
        "Trailing 12-month revenue (quarterly filings) between half and twice the last fiscal year's (annual filing). Outside that, only an acquisition, a spin-off or an error."],
      u: "mil", a: ["12 meses", "12 months"], b: ["Exercício", "Fiscal year"], cmp: ["razao", "12 meses ÷ exercício", "TTM ÷ year"]
    },
    lpa: {
      n: ["LPA calculado × LPA declarado", "Computed EPS × reported EPS"], f: ["Resultado × composição do capital (CVM)", "Income statement × share capital (CVM)"],
      r: ["Lucro da controladora ÷ ações (do fim do ano ou da média do ano) entre 0,67× e 1,5× o lucro por ação que a empresa declara. Ficam de fora os anos com ações estimadas pelo próprio LPA.",
        "Net income to shareholders ÷ shares (year-end or yearly average) between 0.67× and 1.5× the earnings per share the company reports. Years with shares estimated from that EPS are left out."],
      u: "rs4", a: ["Calculado", "Computed"], b: ["Declarado", "Reported"], cmp: ["razao", "Calculado ÷ declarado", "Computed ÷ reported"]
    },
    tesouraria: {
      n: ["Tesouraria não passa das ações emitidas", "Treasury shares do not exceed issued shares"], f: ["Composição do capital (CVM)", "Share capital (CVM)"],
      r: ["Ações em tesouraria de cada classe ≤ ações emitidas da classe.", "Treasury shares of each class ≤ issued shares of that class."],
      u: "acoes", a: ["Tesouraria", "Treasury"], b: ["Emitidas", "Issued"], cmp: ["parte", "Parte das emitidas", "Share of issued"]
    },
    acoes_cvm_b3: {
      n: ["Ações: CVM × B3", "Shares: CVM × B3"], f: ["Composição do capital (CVM) × ficha da B3", "Share capital (CVM) × B3 issuer record"],
      r: ["Ações em circulação do último ITR ou DFP a até 5% das que a B3 informa hoje. Diferença maior: recompra, emissão ou cancelamento depois do balanço, ou tesouraria contada de outro jeito. O site usa a B3.",
        "Outstanding shares in the latest filing within 5% of B3's current count. A larger gap means a buyback, issuance or cancellation after the filing, or treasury counted differently. The site uses B3's."],
      u: "acoes", a: ["CVM", "CVM"], b: ["B3", "B3"], cmp: ["pct", "Diferença", "Difference"]
    },
    vm_b3_dfp: {
      n: ["Valor de mercado: ações da B3 × da DFP", "Market cap: B3 shares × annual filing"], f: ["Ficha da B3 × DFP (CVM)", "B3 issuer record × annual filing (CVM)"],
      r: ["Valor de mercado com as ações da B3 hoje entre 0,8× e 1,25× o calculado com as ações da última DFP. Diferença maior: evento depois do balanço (o site usa a B3).",
        "Market cap with B3's current share count between 0.8× and 1.25× the one with the last annual filing's shares. A larger gap means an event after the filing (the site uses B3's)."],
      u: "mil", a: ["Pela B3", "With B3"], b: ["Pela DFP", "With filing"], cmp: ["razao", "B3 ÷ DFP", "B3 ÷ filing"]
    },
    cotacao_hist: {
      n: ["Cotação: base × histórico diário", "Price: database × daily history"], f: ["COTAHIST (B3), dois programas", "COTAHIST (B3), two programs"],
      r: ["O último fechamento da base e o do histórico diário, lidos por programas diferentes, são o mesmo no mesmo dia (folga de meio centavo).",
        "The latest close in the database and in the daily history, read by different programs, are the same on the same day (half-cent tolerance)."],
      u: "rs", a: ["Base", "Database"], b: ["Histórico", "History"], cmp: ["pct", "Diferença", "Difference"]
    },
    preco_ano_hist: {
      n: ["Preço de fim de exercício × histórico diário", "Year-end price × daily history"], f: ["COTAHIST (B3), dois programas", "COTAHIST (B3), two programs"],
      r: ["O fechamento do último pregão de cada ano, usado nos múltiplos históricos, bate com o histórico diário (folga de 0,1%).",
        "The close of each year's last session, used in historical multiples, matches the daily history (0.1% tolerance)."],
      u: "rs", a: ["Base", "Database"], b: ["Histórico", "History"], cmp: ["pct", "Diferença", "Difference"]
    },
    agenda_hist: {
      n: ["Proventos: ficha × eventos corporativos", "Dividends: issuer record × corporate actions"], f: ["Duas páginas da B3", "Two B3 pages"],
      r: ["Cada provento da agenda (ficha da empresa na B3) aparece na página de eventos corporativos da B3 com a mesma data-com, o mesmo tipo e o mesmo valor (folga de 1%).",
        "Each dividend in the calendar (B3 issuer record) appears on B3's corporate actions page with the same record date, type and amount (1% tolerance)."],
      u: "rs4", a: ["Agenda", "Calendar"], b: ["Eventos", "Corporate actions"], cmp: ["pct", "Diferença", "Difference"]
    },
    agenda_datas: {
      n: ["Pagamento depois da data-com", "Payment after the record date"], f: ["Ficha da B3", "B3 issuer record"],
      r: ["A data de pagamento de cada provento não vem antes da data-com.", "Each dividend's payment date is not before its record date."],
      u: "data", a: ["Data-com", "Record date"], b: ["Pagamento", "Payment"], cmp: ["dias", "Dias até pagar", "Days to payment"]
    },
    eventos_preco: {
      n: ["Desdobramento × salto do preço", "Split × price jump"], f: ["Ficha da B3 × COTAHIST (B3)", "B3 issuer record × COTAHIST (B3)"],
      r: ["No dia em que um desdobramento, grupamento ou bonificação passa a valer, o preço muda na proporção do fator (entre 0,65× e 1,5× dele).",
        "On the day a split, reverse split or stock dividend takes effect, the price moves in proportion to the factor (between 0.65× and 1.5× of it)."],
      u: "x", a: ["Salto do preço", "Price jump"], b: ["Fator", "Factor"], cmp: ["razao", "Salto ÷ fator", "Jump ÷ factor"]
    },
    escopo_liquidez: {
      n: ["Acima do corte de liquidez", "Above the liquidity cut"], f: ["COTAHIST (B3)", "COTAHIST (B3)"],
      r: ["Volume médio dos últimos 21 pregões de pelo menos R$ 500 mil por dia (para entrar na base, R$ 1 mi).",
        "Average volume over the last 21 sessions of at least R$ 500,000 a day (R$ 1 million to join)."],
      u: "rsv", a: ["Volume por dia", "Daily volume"], b: ["Mínimo", "Minimum"], cmp: ["razao", "Vezes o mínimo", "Times the minimum"]
    },
    ptax_media: {
      n: ["PTAX média de cada ano", "Yearly average PTAX"], f: ["Base × série diária do Banco Central", "Database × Central Bank daily series"],
      r: ["A PTAX média que converte resultado e fluxo de caixa para dólar bate com a média da série diária do Banco Central (folga de 0,5%).",
        "The average PTAX that converts income and cash flow to dollars matches the average of the Central Bank's daily series (0.5% tolerance)."],
      u: "ptax", a: ["Base", "Database"], b: ["Banco Central", "Central Bank"], cmp: ["pct", "Diferença", "Difference"]
    },
    ptax_fim: {
      n: ["PTAX do fim de cada ano", "Year-end PTAX"], f: ["Base × série diária do Banco Central", "Database × Central Bank daily series"],
      r: ["A PTAX do último dia útil, que converte o balanço para dólar, bate com a série diária (folga de 0,1%).",
        "The last business day's PTAX, which converts balance sheets to dollars, matches the daily series (0.1% tolerance)."],
      u: "ptax", a: ["Base", "Database"], b: ["Banco Central", "Central Bank"], cmp: ["pct", "Diferença", "Difference"]
    }
  };

  // cruzamentos por empresa, na ordem dos quadradinhos (os de PTAX valem para toda a base)
  var ORDEM = ["dfc", "pl_ativo", "bruto_receita", "ebitda_ebit", "ttm_anual", "lpa", "tesouraria", "acoes_cvm_b3", "vm_b3_dfp",
    "cotacao_hist", "preco_ano_hist", "agenda_hist", "agenda_datas", "eventos_preco", "escopo_liquidez"];
  var CURTO = {
    dfc: ["Fluxo de caixa", "Cash flow"], pl_ativo: ["PL ≤ ativo", "Equity ≤ assets"], bruto_receita: ["Bruto ≤ receita", "Gross ≤ revenue"],
    ebitda_ebit: ["EBITDA ≥ EBIT", "EBITDA ≥ EBIT"], ttm_anual: ["12 meses × ano", "TTM × year"], lpa: ["LPA", "EPS"],
    tesouraria: ["Tesouraria", "Treasury"], acoes_cvm_b3: ["Ações CVM × B3", "Shares CVM × B3"], vm_b3_dfp: ["Valor de mercado", "Market cap"],
    cotacao_hist: ["Cotação", "Price"], preco_ano_hist: ["Preço de fim de ano", "Year-end price"], agenda_hist: ["Proventos", "Dividends"],
    agenda_datas: ["Data de pagamento", "Payment date"], eventos_preco: ["Desdobramentos", "Splits"], escopo_liquidez: ["Liquidez", "Liquidity"]
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
  /** a coluna que compara os dois valores de um caso (ver cmp em C) */
  function comparar(a, b, d) {
    var tipo = d.cmp[0];
    if (tipo === "dias") return a && b ? nf(0).format(Math.round((Date.parse(b) - Date.parse(a)) / 864e5)) : "–";
    if (a == null || b == null) return "–";
    if (tipo === "menos") return valor(a - b, d.u);
    if (!b) return "–";
    var r = a / b;
    if (tipo === "razao") return nf(Math.abs(r) >= 100 ? 0 : 2).format(r) + "×";
    if (tipo === "parte") return pctTxt(r, Math.abs(r) < 0.1 ? 2 : 1);
    if (r === 1) return "0%";
    return (r > 1 ? "+" : "") + nf(Math.abs(r - 1) < 0.1 ? 2 : 1).format((r - 1) * 100) + "%";
  }
  function pctTxt(v, casas) { return v == null ? "–" : nf(casas == null ? 1 : casas).format(v * 100) + "%"; }
  function barraNota(n) {
    var cor = n >= 90 ? "var(--pos)" : n >= 70 ? "var(--warn)" : "var(--neg)";
    return '<span class="q-barra"><i style="width:' + Math.max(1, n) + "%;background:" + cor + '"></i></span>';
  }
  function norm(s) { return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase(); }

  // ---------------------------------------------------------------- dados por empresa

  var preparado = null;  // {q, grupo: {id: grupo}, res: {tk: {t, ok, por: {id: [casos, batem]}}}, achados: {tk: [...]}}
  function preparar(q) {
    if (preparado && preparado.q === q) return preparado;
    var p = { q: q, grupo: {}, res: {}, achados: {} };
    q.checagens.forEach(function (c) { p.grupo[c.id] = c.grupo; });
    Object.keys(q.casos || {}).forEach(function (tk) {
      var r = { t: 0, ok: 0, por: {} };
      Object.keys(q.casos[tk]).forEach(function (id) {
        var ok = 0;
        q.casos[tk][id].forEach(function (c) { ok += c[0]; });
        r.por[id] = [q.casos[tk][id].length, ok];
        r.t += q.casos[tk][id].length; r.ok += ok;
      });
      p.res[tk] = r;
    });
    var ordem = { "alta": 0, "média": 1, "baixa": 2, "info": 3 };
    q.achados.forEach(function (a) {
      var e = X.POR_TICKER[a.t], tk = e ? e.ticker : a.t;
      (p.achados[tk] = p.achados[tk] || []).push(a);
    });
    Object.keys(p.achados).forEach(function (tk) {
      p.achados[tk].sort(function (a, b) { return ordem[a.sev] - ordem[b.sev] || a.regra.localeCompare(b.regra); });
    });
    preparado = p;
    return p;
  }
  function vazio() { return { t: 0, ok: 0, por: {} }; }

  // ---------------------------------------------------------------- seleção: setor ou empresa

  // empresas em análise ({ticker principal: true}); null = toda a base. A empresa do endereço
  // (#/qualidade/PETR4) vence o filtro de setor da barra sob o cabeçalho.
  var SEL = null;
  function selecionar() {
    SEL = null;
    if (filtro) {
      var e = X.POR_TICKER[filtro];
      SEL = {};
      SEL[e ? e.ticker : filtro] = true;
    } else if (X.setorAtivo()) {
      SEL = {};
      X.visiveis().forEach(function (e) { SEL[e.ticker] = true; });
    }
  }
  function naSelecao(tk) { return !SEL || !!SEL[tk]; }

  /** empresas em análise, da melhor para a pior nota (a ordem de q.empresas) */
  function emAnalise(q) { return q.empresas.filter(function (x) { return naSelecao(x.t); }); }

  function passaFiltros(x, p) {
    var r = p.res[x.t] || vazio(), termo = norm(busca.trim());
    if (modo === "falha" && r.ok === r.t) return false;
    if (modo === "ok" && r.ok !== r.t) return false;
    if (!termo) return true;
    var e = X.POR_TICKER[x.t], tks = e ? e.tickers : [x.t];
    return tks.some(function (tk) { return norm(tk).indexOf(termo) === 0; }) || norm(x.nome).indexOf(termo) >= 0 || (e && norm(e.nome).indexOf(termo) >= 0);
  }

  // ---------------------------------------------------------------- uma empresa

  function chipsOcorrencias(x) {
    var chip = function (n, cls, rot) { return n ? '<span class="q-sev ' + cls + '">' + n + " " + rot + "</span>" : ""; };
    return chip(x.alta, "alta", L("alta", "high")) + chip(x.media, "media", L("média", "medium")) + chip(x.baixa, "baixa", L("baixa", "low")) +
      chip(x.info, "info", "info") || '<span class="q-sev nenhuma">' + L("sem ocorrências", "no issues") + "</span>";
  }

  /** um quadradinho por cruzamento, na ordem de ORDEM, com um espaço entre os grupos */
  function faixa(p, r) {
    var g0 = null;
    return '<span class="q-faixa" aria-hidden="true">' + ORDEM.filter(function (id) { return p.grupo[id]; }).map(function (id) {
      var g = p.grupo[id], sep = g0 && g !== g0 ? " q-sep" : "", x = r.por[id];
      g0 = g;
      var cls = !x ? "na" : x[1] === x[0] ? "ok" : "falha";
      var tit = T(C[id].n) + ": " + (!x ? L("não se aplica", "not applicable") : x[1] + " " + L("de", "of") + " " + x[0] + " " + L("batem", "match"));
      return '<i class="q-pt ' + cls + sep + '" title="' + esc(tit) + '"></i>';
    }).join("") + "</span>";
  }

  /** texto com os cruzamentos que falharam: "✗ LPA 2 · Ações CVM × B3 1" */
  function falhasTexto(p, r) {
    var itens = ORDEM.filter(function (id) { var x = r.por[id]; return x && x[1] < x[0]; }).map(function (id) {
      var x = r.por[id];
      return esc(T(CURTO[id])) + " " + (x[0] - x[1]);
    });
    return itens.length ? '<span class="q-emp-falhas">✗ ' + itens.join(" · ") + "</span>" :
      '<span class="q-emp-falhas ok">✓ ' + L("todos os cruzamentos batem", "every cross-check matches") + "</span>";
  }

  function cabecalho(p, x) {
    var e = X.POR_TICKER[x.t], r = p.res[x.t] || vazio(), aberta = !!abertas[x.t];
    return '<button type="button" class="q-emp-cab" data-abrir-emp="' + esc(x.t) + '" aria-expanded="' + aberta + '" aria-controls="q-corpo-' + esc(x.t) + '">' +
      '<span class="q-emp-id"><b>' + esc(x.t) + "</b> <span>" + esc(x.nome) + "</span>" + (e ? '<small class="mudo">' + esc(X.setor(e)) + "</small>" : "") + "</span>" +
      '<span class="q-emp-nota">' + barraNota(x.nota) + " <b>" + x.nota + '</b><small class="mudo">' + L("nota", "score") + "</small></span>" +
      '<span class="q-emp-casos"><b>' + pctTxt(r.t ? r.ok / r.t : null, 1) + '</b><small class="mudo">' + nf(0).format(r.ok) + " " + L("de", "of") + " " + nf(0).format(r.t) + " " + L("casos batem", "cases match") + "</small></span>" +
      '<span class="q-emp-resumo">' + faixa(p, r) + falhasTexto(p, r) + "</span>" +
      '<span class="q-emp-oc">' + chipsOcorrencias(x) + "</span>" +
      '<span class="q-seta" aria-hidden="true"></span></button>';
  }

  /** um cruzamento com todos os casos da empresa (tk = ticker principal; null nos gerais de PTAX) */
  function cartaoCruz(id, casos, tk) {
    var d = C[id] || { n: [id, id], r: ["", ""], u: "", a: ["A", "A"], b: ["B", "B"], cmp: ["pct", "Diferença", "Difference"] };
    var ok = casos.filter(function (c) { return c[0]; }).length;
    var classe = tk && casos.some(function (c) { return c[4]; });
    var anos = casos.every(function (c) { return typeof c[1] === "number"; }), datas = casos.every(function (c) { return typeof c[1] === "string"; });
    var quando = casos.some(function (c) { return c[1] != null; });
    var cab = (quando ? "<th>" + (anos ? L("Ano", "Year") : datas ? L("Data", "Date") : L("Ano ou data", "Year or date")) + "</th>" : "") +
      (classe ? "<th>" + L("Classe", "Class") + "</th>" : "") +
      '<th class="num">' + esc(T(d.a)) + '</th><th class="num">' + esc(T(d.b)) + '</th><th class="num">' + esc(L(d.cmp[1], d.cmp[2])) + '</th><th class="q-st"><span class="sr">' + L("Bate?", "Match?") + "</span></th>";
    var corpo = casos.map(function (c) {
      return '<tr class="' + (c[0] ? "" : "q-falha") + '">' +
        (quando ? "<td>" + (c[1] == null ? "–" : typeof c[1] === "number" ? c[1] : esc(X.data(c[1]))) + "</td>" : "") +
        (classe ? "<td>" + esc(c[4] || tk) + "</td>" : "") +
        '<td class="num">' + esc(valor(c[2], d.u)) + '</td><td class="num">' + esc(valor(c[3], d.u)) + '</td><td class="num q-cmp">' + esc(comparar(c[2], c[3], d)) + "</td>" +
        '<td class="q-st">' + (c[0] ? '<span class="pos" title="' + L("bate", "matches") + '">✓</span>' : '<span class="neg" title="' + L("falha", "fails") + '">✗</span>') + "</td></tr>";
    }).join("");
    return '<section class="q-card' + (ok < casos.length ? " falha" : "") + '"><h4>' + esc(T(d.n)) +
      ' <span class="q-card-n ' + (ok < casos.length ? "neg" : "pos") + '">' + nf(0).format(ok) + " " + L("de", "of") + " " + nf(0).format(casos.length) + "</span></h4>" +
      '<p class="q-regra">' + esc(T(d.r)) + "</p>" +
      '<div class="q-tabela' + (casos.length > 14 ? " q-alta" : "") + '"><table class="q-casos"><thead><tr>' + cab + "</tr></thead><tbody>" + corpo + "</tbody></table></div></section>";
  }

  function externoEmpresa(q, tk) {
    var x = (q.externo || []).filter(function (r) { var e = X.POR_TICKER[r.t]; return e && e.ticker === tk; });
    if (!x.length) return "";
    return "<h3>" + L("Referência externa: brapi.dev", "External reference: brapi.dev") + "</h3>" +
      '<p class="q-regra">' + L("Uma amostra de ações conferida todo dia numa fonte independente, fora dos programas do site.",
        "A sample of stocks checked every day against an independent source, outside the site's own programs.") + "</p>" +
      '<div class="q-tabela"><table class="q-casos"><thead><tr><th>Ticker</th><th class="num">' + L("Cotação na base", "Price here") + '</th><th class="num">brapi</th><th class="num">' +
      L("Valor de mercado na base", "Market cap here") + '</th><th class="num">brapi</th><th class="num">' + L("Diferença", "Difference") + "</th></tr></thead><tbody>" +
      x.map(function (r) {
        return "<tr><td>" + esc(r.t) + '</td><td class="num">' + esc(r.preco_base) + '</td><td class="num">' + esc(r.preco_ext) + '</td><td class="num">' + esc(r.vm_base) +
          '</td><td class="num">' + esc(r.vm_ext) + '</td><td class="num">' + esc(r.dif) + "</td></tr>";
      }).join("") + "</tbody></table></div>";
  }

  function ocorrenciasEmpresa(lst) {
    var titulo = "<h3>" + L("Regras de plausibilidade", "Plausibility rules") + "</h3>";
    if (!lst.length) return titulo + '<p class="pos q-regra">' + L("Nenhuma ocorrência nas regras de plausibilidade.", "No issues under the plausibility rules.") + "</p>";
    return titulo + '<p class="q-regra">' + L("Números que nenhuma outra fonte confirma, mas que precisam fazer sentido. A ocorrência não muda o número publicado.",
      "Numbers no other source confirms, but that must make sense. An issue does not change the published number.") + L("", " Details are in Portuguese, as the audit writes them.") + "</p>" +
      '<div class="q-tabela"><table class="q-casos q-oc"><thead><tr><th>' + L("Gravidade", "Severity") + "</th><th>" + L("Regra", "Rule") + "</th><th>" + L("Detalhe", "Detail") + "</th></tr></thead><tbody>" +
      lst.map(function (a) {
        return '<tr><td><span class="q-sev ' + (a.sev === "média" ? "media" : a.sev) + '">' + T(GRAVIDADE[a.sev]) + "</span></td><td>" + esc(L(a.regra, REGRAS_EN[a.regra] || a.regra)) +
          '</td><td class="q-quebra">' + esc(a.msg) + "</td></tr>";
      }).join("") + "</tbody></table></div>";
  }

  function corpoEmpresa(p, x) {
    var q = p.q, cs = q.casos[x.t] || {}, html = "";
    var e = X.POR_TICKER[x.t];
    html += '<p class="q-emp-links">' + (e ? '<a href="#/' + esc(x.t) + '">' + L("Página da empresa", "Company page") + " →</a>" +
      '<a href="#/graficos/' + esc(x.t) + '">' + L("Gráficos", "Charts") + " →</a>" : "") +
      (filtro ? "" : '<a href="#/qualidade/' + esc(x.t) + '">' + L("Link só desta empresa", "Link to this company only") + "</a>") + "</p>";
    ["cvm", "cvm_b3", "b3"].forEach(function (g) {
      var ids = ORDEM.filter(function (id) { return p.grupo[id] === g && cs[id] && cs[id].length; });
      if (!ids.length) return;
      html += '<h3 class="q-grupo-tit">' + esc(T(GRUPOS[g])) + '</h3><div class="q-cards">' + ids.map(function (id) { return cartaoCruz(id, cs[id], x.t); }).join("") + "</div>";
    });
    var fora = ORDEM.filter(function (id) { return p.grupo[id] && !(cs[id] && cs[id].length); });
    if (fora.length) {
      html += '<p class="q-regra">' + L("Sem casos nesta empresa (não se aplicam ou faltam dados para comparar): ", "No cases for this company (not applicable, or no data to compare): ") +
        fora.map(function (id) { return esc(T(C[id].n)); }).join(" · ") + ".</p>";
    }
    return html + externoEmpresa(q, x.t) + ocorrenciasEmpresa(p.achados[x.t] || []);
  }

  function empresa(p, x) {
    var aberta = !!abertas[x.t];
    return '<article class="q-emp' + (aberta ? " aberta" : "") + '" data-t="' + esc(x.t) + '">' + cabecalho(p, x) +
      '<div class="q-emp-corpo" id="q-corpo-' + esc(x.t) + '"' + (aberta ? "" : " hidden") + ">" + (aberta ? corpoEmpresa(p, x) : "") + "</div></article>";
  }

  // ---------------------------------------------------------------- página

  function resumo(p, lista) {
    var q = p.q, t = 0, ok = 0, sem = 0;
    lista.forEach(function (x) {
      var r = p.res[x.t] || vazio();
      t += r.t; ok += r.ok;
      if (r.ok === r.t) sem++;
    });
    var graves = lista.reduce(function (n, x) { return n + (x.alta || 0); }, 0);
    var setor = !filtro && X.setorAtivo();
    var st = function (rot, v, extra) { return '<div class="stat"><span>' + rot + '</span><b class="num">' + v + "</b>" + (extra ? '<small class="mudo">' + extra + "</small>" : "") + "</div>"; };
    return '<section class="intro"><h1>' + L("Qualidade dos dados, empresa a empresa", "Data quality, company by company") + "</h1><p>" +
      L("Cada número do site vem de uma fonte pública (CVM, B3 e Banco Central) e é conferido contra outra fonte ou contra outra leitura da mesma fonte. Aqui está, empresa a empresa, cada caso conferido, com os dois valores lado a lado. A conferência roda todo dia útil, junto com a atualização da base, e trava a publicação se a base piorar. O filtro de setor da barra acima vale aqui também; valores em reais, como nas fontes.",
        "Every number on this site comes from a public source (CVM, B3 and the Central Bank) and is checked against another source or another reading of the same source. Here, company by company, is every case checked, with both values side by side. The check runs every business day with the data update, and blocks publication if the data gets worse. The sector filter above applies here too; values are in reais, as in the sources.") +
      "</p></section>" +
      '<section class="cartao"><div class="stats q-stats">' +
      st(L("Empresas em análise", "Companies analyzed"), nf(0).format(lista.length), filtro ? esc(filtro) : setor ? esc(setor.nome) : L("toda a base", "the whole database")) +
      st(L("Casos conferidos", "Cases checked"), nf(0).format(t), pctTxt(t ? ok / t : null, 2) + " " + L("batem", "match")) +
      st(L("Sem nenhuma falha", "With no failure"), nf(0).format(sem), L("em todos os cruzamentos", "in every cross-check")) +
      st(L("Com alguma falha", "With a failure"), nf(0).format(lista.length - sem), L("abra a empresa para ver o caso", "open the company to see the case")) +
      st(L("Ocorrências graves", "Serious issues"), nf(0).format(graves), L("regras de plausibilidade", "plausibility rules")) +
      st(L("Base de", "Data as of"), X.data(q.gerado_em.slice(0, 10)), L("cotações de ", "prices of ") + X.data(q.cotacoes_em)) +
      "</div></section>";
  }

  function controles(p, lista) {
    var n = { todas: lista.length, falha: 0, ok: 0 };
    lista.forEach(function (x) { var r = p.res[x.t] || vazio(); n[r.ok === r.t ? "ok" : "falha"]++; });
    var pilula = function (id, rot) { return '<button type="button" data-modo="' + id + '" aria-pressed="' + (modo === id) + '">' + rot + ' <span class="conta">' + n[id] + "</span></button>"; };
    var grupos = [];  // nomes curtos dos cruzamentos, separados por grupo, na ordem dos quadradinhos
    ORDEM.filter(function (id) { return p.grupo[id]; }).forEach(function (id) {
      var ult = grupos[grupos.length - 1];
      if (!ult || ult.g !== p.grupo[id]) grupos.push(ult = { g: p.grupo[id], nomes: [] });
      ult.nomes.push(esc(T(CURTO[id])));
    });
    var legenda = grupos.map(function (x) { return x.nomes.join(" · "); }).join(' <span class="q-leg-sep">|</span> ');
    return '<div class="q-controles">' +
      '<label class="q-busca"><span class="sr">' + L("Filtrar empresas", "Filter companies") + '</span><input type="search" id="q-busca" placeholder="' + L("Filtrar por ticker ou nome", "Filter by ticker or name") + '" value="' + esc(busca) + '"></label>' +
      '<div class="pilulas" role="group" aria-label="' + L("Mostrar", "Show") + '">' + pilula("todas", L("Todas", "All")) + pilula("falha", L("Com falha", "With failures")) + pilula("ok", L("Sem falha", "No failures")) + "</div>" +
      '<span class="q-abrir"><button type="button" class="q-acao" data-todas="abrir">' + L("Abrir todas", "Open all") + '</button><button type="button" class="q-acao" data-todas="fechar">' + L("Fechar todas", "Close all") + "</button></span></div>" +
      '<p class="q-legenda"><span class="q-leg"><i class="q-pt ok"></i>' + L("todos os casos batem", "all cases match") + '</span><span class="q-leg"><i class="q-pt falha"></i>' + L("algum caso falha", "some case fails") +
      '</span><span class="q-leg"><i class="q-pt na"></i>' + L("não se aplica", "not applicable") + "</span><br>" + L("Um quadradinho por cruzamento, nesta ordem: ", "One square per cross-check, in this order: ") + legenda + ".</p>";
  }

  function listaHtml(p, lista) {
    var vis = lista.filter(function (x) { return passaFiltros(x, p); });
    if (!vis.length) return '<p class="mudo q-nada">' + L("Nenhuma empresa com esse filtro.", "No company with this filter.") + "</p>";
    return vis.map(function (x) { return empresa(p, x); }).join("");
  }

  function geral(q) {
    var c = q.cobertura, max = c.emissores_negociados || 1;
    var degrau = function (rot, v, nota) {
      return '<div class="q-funil-linha"><span>' + rot + '</span><span class="q-barra"><i style="width:' + (v / max * 100).toFixed(1) + '%;background:var(--accent)"></i></span><b class="num">' +
        nf(0).format(v) + "</b>" + (nota ? '<small class="mudo">' + nota + "</small>" : "") + "</div>";
    };
    var atual = q.atualizacao.map(function (x) {
      return '<tr><td class="q-quebra">' + esc(T(FONTES[x.id] || [x.id, x.id])) + "</td><td>" + (x.id === "dfp" ? esc(x.data) : X.data(x.data)) +
        (x.id === "itr" && x.total ? ' <span class="mudo">(' + nf(0).format(x.n) + " " + L("de", "of") + " " + nf(0).format(x.total) + ")</span>" : "") +
        "</td><td>" + (x.ok ? '<span class="pos">✓ ' + L("em dia", "up to date") + "</span>" : '<span class="neg">✗ ' + L("atrasada", "late") + "</span>") + "</td></tr>";
    }).join("");
    var fora = c.fora.length ? '<div class="q-tabela"><table class="q-casos"><thead><tr><th>Ticker</th><th>' + L("Nome na B3", "B3 name") + '</th><th class="num">' + L("Volume por dia", "Daily volume") +
      "</th><th>" + L("Por que ficou de fora", "Why it is missing") + "</th></tr></thead><tbody>" + c.fora.map(function (x) {
        return "<tr><td><b>" + esc(x.t) + "</b></td><td>" + esc(x.nome) + '</td><td class="num">' + mil(x.volume / 1000) + '</td><td class="q-quebra">' + esc(x.motivo) + "</td></tr>";
      }).join("") + "</tbody></table></div>" : '<p class="pos">' + L("Nenhum emissor acima do corte de liquidez ficou de fora da base.", "No issuer above the liquidity cut is missing from the database.") + "</p>";
    var ptax = Object.keys(q.gerais || {}).map(function (id) { return cartaoCruz(id, q.gerais[id], null); }).join("");
    return '<section class="cartao bloco"><h2>' + L("Vale para toda a base", "Applies to the whole database") + '</h2><p class="mudo">' +
      L("O câmbio que converte tudo para dólar, a cobertura da B3 até a base e a data de cada fonte: não dependem da empresa.",
        "The exchange rate that converts everything to dollars, the coverage from B3 to the database and each source's date: they do not depend on the company.") + "</p>" +
      (ptax ? '<h3 class="q-grupo-tit">' + esc(T(GRUPOS.bcb)) + '</h3><div class="q-cards">' + ptax + "</div>" : "") +
      '<div class="q-duas"><div><h3>' + L("Da B3 até a base", "From B3 to the database") + "</h3>" +
      degrau(L("Emissores com ação negociada", "Issuers with traded shares"), c.emissores_negociados, L("últimos ", "last ") + c.pregoes + L(" pregões", " sessions")) +
      degrau(L("Acima do corte de liquidez", "Above the liquidity cut"), c.acima_corte, L("R$ 1 mi por dia", "R$ 1 million a day")) +
      degrau(L("Na base", "In the database"), c.na_base, pctTxt(c.cobertura, 0)) + fora +
      '<p class="mudo">' + L("Referências públicas de empresas listadas: ", "Public counts of listed companies: ") +
      c.referencias.map(function (r) { return esc(r[0]) + ": " + esc(r[1]); }).join(" · ") + "</p>" +
      "</div><div><h3>" + L("Data de cada fonte", "Date of each source") + '</h3><div class="q-tabela"><table class="q-casos"><thead><tr><th>' + L("Fonte", "Source") + "</th><th>" +
      L("Mais recente", "Latest") + "</th><th>" + L("Situação", "Status") + "</th></tr></thead><tbody>" + atual + "</tbody></table></div></div></div></section>";
  }

  function metodo() {
    return '<section class="cartao bloco metodo"><details><summary>' + L("Como a conferência funciona", "How the check works") + "</summary><ul>" +
      [L("Cruzamentos: o mesmo número lido em duas fontes, ou por dois programas, tem de bater dentro da folga de cada regra. Cada caso aparece na empresa dele, com os dois valores e a comparação. Uma falha é investigada: quando é erro do processamento, vira correção com teste (por exemplo, o preço de fim de 2020 e de 2024, que pegava o pregão anterior ao último); quando é da fonte, fica registrada aqui.",
        "Cross-checks: the same number, read from two sources or by two programs, must match within each rule's tolerance. Each case appears under its company, with both values and the comparison. A failure is investigated: if it is a processing error, it becomes a fix with a test (for example, the 2020 and 2024 year-end prices, which took the session before the last); if it comes from the source, it stays recorded here."),
      L("Nota da empresa: começa em 100 e perde 25 por ocorrência alta, 10 por média e 3 por baixa, somando as regras de plausibilidade e as falhas dos cruzamentos que elas não cobrem.",
        "Company score: starts at 100 and loses 25 per high issue, 10 per medium and 3 per low, adding up the plausibility rules and the failures of the cross-checks they do not cover."),
      L("Plausibilidade: regras que pegam números estranhos que nenhuma outra fonte confirma ou desmente.", "Plausibility: rules that flag odd numbers that no other source confirms or refutes."),
      L("Cobertura: parte de toda ação negociada na B3 nos últimos 21 pregões e diz, de cada emissor líquido que falta, em que etapa ele caiu.",
        "Coverage: starts from every share traded on B3 in the last 21 sessions and tells, for each missing liquid issuer, where it dropped out."),
      L("Trava: se a cobertura cair abaixo de 97%, a base encolher mais de 5% ou surgirem mais de 5 ocorrências graves novas, a atualização do dia não é publicada.",
        "Lock: if coverage drops below 97%, the database shrinks by more than 5% or more than 5 new serious issues appear, that day's update is not published."),
      L("Ferramenta de dados, não recomendação de investimento.", "A data tool, not investment advice.")].map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") +
      "</ul></details></section>";
  }

  function desenhar(app, q) {
    selecionar();
    var p = preparar(q), lista = emAnalise(q);
    if (lista.length === 1) abertas[lista[0].t] = true;  // empresa do endereço, ou setor de uma empresa só
    var setor = !filtro && X.setorAtivo();
    var aviso = filtro ? '<p class="q-filtro">' + L("Mostrando só ", "Showing only ") + "<b>" + esc(filtro) + '</b>. <a href="#/qualidade">' + L("Ver todas as empresas", "See all companies") + "</a></p>" :
      setor ? '<p class="q-filtro">' + L("Setor ", "Sector ") + "<b>" + esc(setor.nome) + "</b>: " + setor.n + " " + L("empresas", "companies") + ". " +
        L("O que vale para toda a base continua no fim da página. ", "What applies to the whole database stays at the bottom of the page. ") +
        '<button type="button" class="q-limpar" data-limpar-setor>' + L("Ver todas as empresas", "See all companies") + "</button></p>" : "";
    app.innerHTML = resumo(p, lista) + aviso +
      '<section class="cartao bloco q-empresas"><h2>' + L("Empresa a empresa", "Company by company") + "</h2>" +
      '<p class="mudo">' + L("Da melhor para a pior nota. Clique numa empresa para ver cada cruzamento com todos os casos: o ano ou a data, os dois valores, a comparação e se bate.",
        "From the best to the worst score. Click a company to see each cross-check with every case: the year or date, both values, the comparison and whether it matches.") + "</p>" +
      controles(p, lista) + '<div class="q-lista" id="q-lista">' + listaHtml(p, lista) + "</div></section>" +
      geral(q) + metodo();
    ligar(app, q, p, lista);
  }

  function ligar(app, q, p, lista) {
    var caixa = app.querySelector("#q-lista");
    var limpar = app.querySelector("[data-limpar-setor]");
    if (limpar) limpar.addEventListener("click", function () { X.definirSetor(""); });
    caixa.addEventListener("click", function (ev) {
      var b = ev.target.closest("[data-abrir-emp]");
      if (!b) return;
      var tk = b.getAttribute("data-abrir-emp"), art = b.parentNode, corpo = art.querySelector(".q-emp-corpo");
      abertas[tk] = !abertas[tk];
      b.setAttribute("aria-expanded", String(abertas[tk]));
      art.classList.toggle("aberta", abertas[tk]);
      if (abertas[tk]) {
        var x = lista.filter(function (y) { return y.t === tk; })[0];
        corpo.innerHTML = corpoEmpresa(p, x);
        corpo.hidden = false;
      } else {
        corpo.hidden = true;
        corpo.innerHTML = "";
      }
    });
    var redesenharLista = function () {
      caixa.innerHTML = listaHtml(p, lista);
      app.querySelectorAll("[data-modo]").forEach(function (b) { b.setAttribute("aria-pressed", String(b.getAttribute("data-modo") === modo)); });
    };
    app.querySelectorAll("[data-modo]").forEach(function (b) {
      b.addEventListener("click", function () { modo = b.getAttribute("data-modo"); redesenharLista(); });
    });
    app.querySelectorAll("[data-todas]").forEach(function (b) {
      b.addEventListener("click", function () {
        var abrir = b.getAttribute("data-todas") === "abrir";
        lista.forEach(function (x) { if (passaFiltros(x, p)) abertas[x.t] = abrir; });
        redesenharLista();
      });
    });
    var campo = app.querySelector("#q-busca");
    campo.addEventListener("input", function () { busca = campo.value; redesenharLista(); });
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
      if (!q || !q.casos) {
        app.innerHTML = '<p class="neg" style="padding:40px 0">' + L("Não foi possível carregar data/qualidade.js.", "Could not load data/qualidade.js.") + "</p>";
        return;
      }
      desenhar(app, q);
    });
  }

  window.RealTermsQualidade = { render: render };
  // aberta direto pelo endereço: app.js roda a rota antes deste arquivo carregar
  if (document.body.getAttribute("data-pagina") === "qualidade") render(document.getElementById("app"));
})();
