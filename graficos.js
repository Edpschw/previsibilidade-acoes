/* Real Terms — gráficos (#/graficos/PETR4,VALE3/cotacao,pl): você escolhe as empresas e o que ver de cada uma.
 *
 * Até cinco empresas (a cor segue a ordem da escolha) e quantos indicadores quiser: um gráfico por indicador,
 * uma linha por empresa, legenda do maior para o menor último valor. Cotação e retorno total vêm do histórico
 * diário (data/historico/<TICKER>.js, carregado sob demanda), na base de ações de hoje; os demais, das
 * demonstrações anuais e do preço do último pregão de cada ano, com as mesmas contas da página da empresa
 * (app.js: serie, multiplos, porAcaoAnual). Respeita R$/US$ (PTAX do dia na cotação; média do ano nos fluxos e
 * fim do ano nos saldos) e o filtro de setor. A escolha fica no endereço, para compartilhar.
 * Não é recomendação de investimento. */
(function () {
  "use strict";

  var MAX = 5;
  var CORES = ["var(--c1)", "var(--c3)", "var(--c2)", "var(--c4)", "var(--c5)"];
  var PADRAO = ["cotacao", "pl", "dy", "roe"];
  var MAX_PONTOS = 800;   // acima disso, a série diária vira semanal (último pregão de cada semana)
  var base100 = null;     // cotação em base 100: null = automático (ligada com mais de uma empresa)

  // ---------------------------------------------------------------- histórico diário sob demanda

  var promessas = {};
  function versao() { var D = window.DADOS || {}; return String(D.cotacoes_em || D.gerado_em || "").replace(/\D/g, ""); }
  /** carrega data/historico/<nome>.js uma vez (o simulador usa os mesmos arquivos) */
  function carregar(nome) {
    if (nome === "_indices" ? window.INDICES : window.HIST && window.HIST[nome]) return Promise.resolve();
    if (promessas[nome]) return promessas[nome];
    promessas[nome] = new Promise(function (ok, falha) {
      var s = document.createElement("script");
      s.src = "data/historico/" + nome + ".js?v=" + versao();
      s.onload = function () { ok(); };
      s.onerror = function () { delete promessas[nome]; falha(new Error(nome)); };
      document.head.appendChild(s);
    });
    return promessas[nome];
  }

  function iso(ms) { return new Date(ms).toISOString().slice(0, 10); }
  function datasDe(d0, dd) {
    var out = new Array(dd.length + 1), ms = Date.parse(d0 + "T00:00:00Z");
    out[0] = d0;
    for (var i = 0; i < dd.length; i++) { ms += dd[i] * 864e5; out[i + 1] = iso(ms); }
    return out;
  }
  /** primeira posição com datas[i] > d */
  function depoisDe(datas, d) {
    var lo = 0, hi = datas.length;
    while (lo < hi) { var m = (lo + hi) >> 1; if (datas[m] <= d) lo = m + 1; else hi = m; }
    return lo;
  }

  var decodificados = {};
  /** série diária do ticker: datas, fechamento ajustado (base de ações de hoje) e índice de retorno total */
  function diario(tk) {
    var h = window.HIST && window.HIST[tk];
    if (!h) return null;
    if (decodificados[tk] && decodificados[tk].h === h) return decodificados[tk];
    var datas = datasDe(h.d0, h.dd), n = datas.length, bruto = new Array(n), p = h.p0, i;
    bruto[0] = p / h.esc;
    for (i = 0; i < h.dp.length; i++) { p += h.dp[i]; bruto[i + 1] = p / h.esc; }
    // antes de cada desdobramento, grupamento ou bonificação, o preço é dividido pelo fator do evento
    var evs = (h.ev || []).slice().sort(function (a, b) { return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0; });
    var aj = new Array(n), f = 1, j = evs.length - 1;
    for (i = n - 1; i >= 0; i--) {
      while (j >= 0 && evs[j][0] > datas[i]) { if (evs[j][1] > 0) f *= evs[j][1]; j--; }
      aj[i] = bruto[i] / f;
    }
    // retorno total: o provento (dividendo, JCP bruto, rendimento, restituição) entra no pregão seguinte
    // à data-com, na mesma base de ações do preço, e é reinvestido no fechamento desse dia
    var prov = new Array(n).fill(0);
    (h.pv || []).forEach(function (x) {
      var k = depoisDe(datas, x[0]);
      if (k > 0 && k < n && x[1] > 0) prov[k] += x[1] * aj[k - 1] / bruto[k - 1];
    });
    var tr = new Array(n);
    tr[0] = 1;
    for (i = 1; i < n; i++) tr[i] = tr[i - 1] * (aj[i] + prov[i]) / aj[i - 1];
    decodificados[tk] = { h: h, datas: datas, aj: aj, tr: tr };
    return decodificados[tk];
  }

  var ptaxDiaria = null;
  function ptax() {
    var I = window.INDICES;
    if (!I || !I.ptax) return null;
    if (!ptaxDiaria || ptaxDiaria.I !== I) ptaxDiaria = { I: I, datas: datasDe(I.ptax.d0, I.ptax.dd), v: I.ptax.v };
    return ptaxDiaria;
  }

  /** último pregão de cada semana (semanas de segunda a domingo) */
  function semanal(datas) {
    var semana = function (d) { return Math.floor((Date.parse(d) / 864e5 + 3) / 7); };
    return datas.filter(function (d, i) { return i === datas.length - 1 || semana(datas[i + 1]) !== semana(d); });
  }

  // ---------------------------------------------------------------- indicadores

  function indicadores(X) {
    var L = X.L, nf = X.nf;
    var vezes = function (v) { return v == null || !isFinite(v) ? "–" : nf(1).format(v) + "x"; };
    var pct = function (v) { return X.pct(v, 1); };
    var din = function (v) { return X.dinheiro(v); };
    var inteiro = function (v) { return Math.abs(v - Math.round(v)) < 1e-6; };
    var eixoVezes = function (v) { return nf(inteiro(v) ? 0 : 1).format(v) + "x"; };
    var eixoPct = function (v) { return nf(inteiro(v * 100) ? 0 : 1).format(v * 100) + "%"; };
    var eixoDin = function (v) { return X.dinheiro(v, true); };
    var eixoPa = function (v) { return nf(Math.abs(v) >= 100 || v % 1 === 0 ? 0 : 2).format(v); };
    var s = function (e, k) { return X.serie(e, k); };
    var razao = function (a, b, positivo) {
      return a.map(function (x, k) { var y = b[k]; return x == null || y == null || !y || (positivo && y <= 0) ? null : x / y; });
    };
    var mult = function (campo) {
      return function (e) { return e.anos.map(function (a, k) { return X.multiplos(e, e.series.valor_mercado[k], k)[campo]; }); };
    };
    var semFin = function (f) { return function (e) { return e.financeiro ? null : f(e); }; };
    var moeda = { u: "dinheiro", fmt: din, eixo: eixoDin, lim: null };
    var porAcao = { u: "porAcao", fmt: X.porAcao, eixo: eixoPa, lim: null };
    var lista = [
      { id: "cotacao", g: "preco", diario: true, n: ["Cotação", "Price"],
        d: ["Fechamento diário do ticker escolhido, ajustado por desdobramentos, grupamentos e bonificações (na base de ações de hoje). Sem proventos.",
          "Daily close of the chosen ticker, adjusted for splits, reverse splits and bonus shares (in today's share basis). Excludes payouts."] },
      { id: "retorno", g: "preco", diario: true, n: ["Retorno total", "Total return"],
        d: ["Quanto viraram 100 aplicados no começo do período, com dividendos, JCP (brutos) e rendimentos reinvestidos no pregão seguinte à data-com.",
          "What 100 invested at the start of the period became, with dividends, interest on equity (gross) and other payouts reinvested the session after the record date."] },
      { id: "pl", g: "mult", n: ["P/L", "P/E"], fmt: vezes, eixo: eixoVezes, lim: [0, 60], v: mult("pl"),
        d: ["Valor de mercado no último pregão de cada ano ÷ lucro da controladora do ano. Ano com prejuízo fica sem ponto.",
          "Market cap on each year's last session ÷ the year's net income to shareholders. Loss-making years have no point."] },
      { id: "pvp", g: "mult", n: ["P/VP", "P/B"], fmt: vezes, eixo: eixoVezes, lim: [0, 15], v: mult("pvp"),
        d: ["Valor de mercado no fim de cada ano ÷ patrimônio da controladora.", "Market cap at each year-end ÷ shareholders' equity."] },
      { id: "dy", g: "mult", n: ["Dividend yield", "Dividend yield"], fmt: pct, eixo: eixoPct, lim: [0, 0.3], v: mult("dy"),
        d: ["Dividendos e JCP pagos no ano (fluxo de caixa) ÷ valor de mercado no fim do ano.", "Dividends and interest on equity paid in the year (cash flow) ÷ year-end market cap."] },
      { id: "ev_ebitda", g: "mult", n: ["EV/EBITDA", "EV/EBITDA"], fmt: vezes, eixo: eixoVezes, lim: [0, 40], v: mult("evEbitda"),
        d: ["(Valor de mercado + dívida líquida) ÷ EBITDA, no fim de cada ano. Não se aplica a bancos e seguradoras.",
          "(Market cap + net debt) ÷ EBITDA, at each year-end. Not applicable to banks and insurers."] },
      { id: "psr", g: "mult", n: ["P/Receita", "P/Sales"], fmt: vezes, eixo: eixoVezes, lim: [0, 15], v: mult("psr"),
        d: ["Valor de mercado no fim de cada ano ÷ receita do ano. Não se aplica a bancos e seguradoras.", "Market cap at each year-end ÷ the year's revenue. Not applicable to banks and insurers."] },
      { id: "vm", g: "mult", n: ["Valor de mercado", "Market cap"], u: "dinheiro", fmt: din, eixo: eixoDin, lim: null, v: function (e) { return s(e, "valor_mercado"); },
        d: ["Valor de mercado no último pregão de cada ano.", "Market cap on each year's last session."] },
      { id: "roe", g: "rent", n: ["ROE", "ROE"], fmt: pct, eixo: eixoPct, lim: [-0.6, 0.8], v: function (e) { return razao(e.series.lucro_controladora, e.series.pl_controladora, true); },
        d: ["Lucro da controladora ÷ patrimônio da controladora, ano a ano. Patrimônio negativo fica sem ponto.", "Net income to shareholders ÷ shareholders' equity, year by year. Negative equity has no point."] },
      { id: "roa", g: "rent", n: ["ROA", "ROA"], fmt: pct, eixo: eixoPct, lim: [-0.3, 0.4], v: function (e) { return razao(e.series.lucro_liquido, e.series.ativo_total, true); },
        d: ["Lucro líquido ÷ ativo total.", "Net income ÷ total assets."] },
      { id: "m_bruta", g: "rent", n: ["Margem bruta", "Gross margin"], fmt: pct, eixo: eixoPct, lim: [-0.5, 1], v: semFin(function (e) { return razao(e.series.lucro_bruto, e.series.receita, true); }),
        d: ["Lucro bruto ÷ receita. Não se aplica a bancos e seguradoras.", "Gross profit ÷ revenue. Not applicable to banks and insurers."] },
      { id: "m_ebitda", g: "rent", n: ["Margem EBITDA", "EBITDA margin"], fmt: pct, eixo: eixoPct, lim: [-1, 1], v: semFin(function (e) { return razao(e.series.ebitda, e.series.receita, true); }),
        d: ["EBITDA ÷ receita. Não se aplica a bancos e seguradoras.", "EBITDA ÷ revenue. Not applicable to banks and insurers."] },
      { id: "m_liq", g: "rent", n: ["Margem líquida", "Net margin"], fmt: pct, eixo: eixoPct, lim: [-1, 1], v: function (e) { return razao(e.series.lucro_liquido, e.series.receita, true); },
        d: ["Lucro líquido ÷ receita.", "Net income ÷ revenue."] },
      { id: "receita", g: "res", n: ["Receita", "Revenue"], v: function (e) { return s(e, "receita"); },
        d: ["Receita líquida de cada exercício.", "Net revenue for each fiscal year."] },
      { id: "ebitda", g: "res", n: ["EBITDA", "EBITDA"], v: semFin(function (e) { return s(e, "ebitda"); }),
        d: ["EBIT + depreciação e amortização do fluxo de caixa. Não se aplica a bancos e seguradoras.", "EBIT + depreciation and amortization from the cash flow statement. Not applicable to banks and insurers."] },
      { id: "lucro", g: "res", n: ["Lucro líquido", "Net income"], v: function (e) { return s(e, "lucro_liquido"); },
        d: ["Lucro líquido consolidado, inclui minoritários.", "Consolidated net income, includes minority interests."] },
      { id: "fcl", g: "res", n: ["Fluxo de caixa livre", "Free cash flow"], v: semFin(function (e) {
          var fco = s(e, "fco"), capex = s(e, "capex");
          return fco.map(function (x, k) { return x == null ? null : x - (capex[k] || 0); });
        }),
        d: ["Caixa operacional − investimento em imobilizado e intangível. Não se aplica a bancos e seguradoras.", "Operating cash flow − capital expenditure. Not applicable to banks and insurers."] },
      { id: "dividendos", g: "res", n: ["Dividendos pagos", "Dividends paid"], v: function (e) { return s(e, "dividendos_pagos"); },
        d: ["Dividendos e JCP pagos no ano (caixa).", "Dividends and interest on equity paid in the year (cash)."] },
      { id: "div_liq", g: "div", n: ["Dívida líquida", "Net debt"], v: semFin(function (e) { return s(e, "divida_liquida"); }),
        d: ["Empréstimos e financiamentos − caixa e aplicações, no fim de cada ano. Negativa: a empresa tem mais caixa que dívida.",
          "Loans and financing − cash and investments, at each year-end. Negative: the company holds more cash than debt."] },
      { id: "dl_ebitda", g: "div", n: ["Dív. líq./EBITDA", "Net debt/EBITDA"], fmt: vezes, eixo: eixoVezes, lim: [-5, 10],
        v: semFin(function (e) { return razao(e.series.divida_liquida, e.series.ebitda, true); }),
        d: ["Anos de geração operacional para quitar a dívida líquida. Ano com EBITDA negativo fica sem ponto.", "Years of operating cash generation to repay net debt. Years with negative EBITDA have no point."] },
      { id: "lpa", g: "acao", n: ["LPA", "EPS"], v: function (e) { return X.porAcaoAnual(e).lpa; },
        d: ["Lucro da controladora ÷ ações em circulação de cada ano, na base de ações de hoje.", "Net income to shareholders ÷ each year's shares outstanding, in today's share basis."] },
      { id: "vpa", g: "acao", n: ["VPA", "Book value/share"], v: function (e) { return X.porAcaoAnual(e).vpa; },
        d: ["Patrimônio da controladora ÷ ações, na base de ações de hoje.", "Shareholders' equity ÷ shares, in today's share basis."] },
      { id: "dpa", g: "acao", n: ["Dividendo por ação", "Dividend per share"], v: function (e) { return X.porAcaoAnual(e).dpa; },
        d: ["Dividendos e JCP pagos no ano ÷ ações, na base de ações de hoje.", "Dividends and interest on equity paid in the year ÷ shares, in today's share basis."] },
      { id: "acoes", g: "acao", n: ["Ações em circulação", "Shares outstanding"], fmt: X.qtd, eixo: X.qtd, lim: null, v: function (e) { return X.porAcaoAnual(e).acoes; },
        d: ["No fim de cada ano, sem tesouraria, na base de ações de hoje. Caindo: recompras; subindo: emissões.", "At each year-end, ex-treasury, in today's share basis. Falling: buybacks; rising: share issues."] },
    ];
    lista.forEach(function (ind) {
      var padrao = ind.g === "acao" ? porAcao : moeda;
      if (!ind.fmt) { ind.fmt = padrao.fmt; ind.eixo = padrao.eixo; ind.lim = padrao.lim; ind.u = padrao.u; }
      ind.nome = L(ind.n[0], ind.n[1]);
    });
    return lista;
  }

  var GRUPOS = [
    ["preco", "Preço, dia a dia", "Price, day by day"],
    ["mult", "Múltiplos, no fim de cada ano", "Multiples, at each year-end"],
    ["rent", "Rentabilidade e margens", "Returns and margins"],
    ["res", "Resultado e caixa", "Earnings and cash"],
    ["div", "Dívida", "Debt"],
    ["acao", "Por ação", "Per share"],
  ];

  // ---------------------------------------------------------------- séries

  function ultimoValor(v) { for (var k = v.length - 1; k >= 0; k--) if (v[k] != null) return v[k]; return null; }

  /** anos em que ao menos uma das empresas tem valor; o período corta os mais antigos */
  function anual(ind, sel, periodo) {
    var temAno = {};
    var linhas = sel.map(function (x) {
      var vals = ind.v(x.e) || [], por = {};
      x.e.anos.forEach(function (a, k) { var v = vals[k]; if (v != null && isFinite(v)) { por[a] = v; temAno[a] = 1; } });
      return { x: x, por: por };
    });
    var anos = Object.keys(temAno).map(Number).sort(function (a, b) { return a - b; });
    if (periodo) anos = anos.slice(-periodo);
    return {
      rotulos: anos.map(String),
      series: linhas.map(function (l) { return { x: l.x, v: anos.map(function (a) { return a in l.por ? l.por[a] : null; }) }; }),
    };
  }

  /** eixo de datas comum (união dos pregões no período, semanal se for longo) e o valor de cada empresa em
   *  cada data: o último fechamento até ali. Em US$, pela PTAX do dia. Base 100 no começo do período. */
  function diaria(ind, sel, periodo, b100, usd) {
    var dados = sel.map(function (x) { return { x: x, d: diario(x.tk) }; }).filter(function (y) { return y.d; });
    if (!dados.length) return null;
    var fim = dados.reduce(function (m, y) { var u = y.d.datas[y.d.datas.length - 1]; return u > m ? u : m; }, "");
    var desde = periodo ? iso(Date.parse(fim) - periodo * 365.25 * 864e5) : "";
    var tem = {};
    dados.forEach(function (y) { y.d.datas.forEach(function (d) { if (d >= desde) tem[d] = 1; }); });
    var eixo = Object.keys(tem).sort();
    if (eixo.length > MAX_PONTOS) eixo = semanal(eixo);
    var px = usd ? ptax() : null;
    var series = dados.map(function (y) {
      var ds = y.d.datas, arr = ind.id === "retorno" ? y.d.tr : y.d.aj, j = -1, pj = -1, ultima = ds[ds.length - 1];
      var v = eixo.map(function (d) {
        while (j + 1 < ds.length && ds[j + 1] <= d) j++;
        if (j < 0 || d > ultima) return null;
        var val = arr[j];
        if (px) {
          while (pj + 1 < px.datas.length && px.datas[pj + 1] <= d) pj++;
          val = pj >= 0 ? val / px.v[pj] : null;
        }
        return val;
      });
      if (ind.id === "retorno" || b100) {
        var b = null;
        for (var k = 0; k < v.length && b == null; k++) b = v[k];
        v = v.map(function (z) { return z == null || !b ? null : z / b * 100; });
      }
      return { x: y.x, v: v };
    });
    return { eixo: eixo, series: series };
  }

  // ---------------------------------------------------------------- tela

  function render(app) {
    var X = window.RealTerms, L = X.L, esc = X.esc, nf = X.nf;
    var INDS = indicadores(X), POR_ID = {};
    INDS.forEach(function (i) { POR_ID[i.id] = i; });
    var ativo = X.setorAtivo();
    var universo = X.visiveis().filter(function (e) { return Object.keys(e.cotacao).length; });

    // escolha: endereço (#/graficos/PETR4,VALE3/cotacao,pl); com o filtro de setor, só as empresas do setor
    var m = location.hash.match(/^#\/graficos(?:\/([A-Za-z0-9,]*))?(?:\/([a-z_,]*))?/);
    var vistos = {};
    var escolhidas = (m && m[1] ? m[1].toUpperCase().split(",") : []).filter(function (tk) {
      var e = X.POR_TICKER[tk];
      if (!e || vistos[e.ticker] || universo.indexOf(e) < 0) return false;
      vistos[e.ticker] = true;
      return true;
    }).slice(0, MAX);
    if (!escolhidas.length) {
      // padrão: as três maiores do setor escolhido, ou as três maiores não financeiras
      escolhidas = universo.filter(function (e) { return ativo || !e.financeiro; })
        .sort(function (a, b) { return (b.valor_mercado || 0) - (a.valor_mercado || 0); }).slice(0, 3).map(function (e) { return e.ticker; });
    }
    var inds = (m && m[2] ? m[2].split(",") : []).filter(function (id, k, arr) { return POR_ID[id] && arr.indexOf(id) === k; });
    if (!inds.length) inds = PADRAO.slice();

    document.title = L("Gráficos", "Charts") + " · Real Terms";
    var periodos = [[5, L("5 anos", "5 years")], [10, L("10 anos", "10 years")], [0, L("Tudo", "All")]];
    app.innerHTML =
      '<section class="intro"><h1>' + L("Gráficos", "Charts") + "</h1><p>" + esc(L(
        "Escolha até cinco empresas e o que quer ver de cada uma: preço, múltiplos, margens, resultado, dívida ou números por ação. Cada indicador vira um gráfico, com uma linha por empresa; a legenda vai do maior para o menor valor mais recente. A escolha fica no endereço da página, para guardar ou compartilhar.",
        "Pick up to five companies and what to see for each one: price, multiples, margins, earnings, debt or per-share figures. Each metric becomes a chart, with one line per company; the legend runs from the highest to the lowest latest value. Your choice stays in the page address, to save or share.")) + "</p></section>" +
      '<section class="cartao g-escolha">' +
      '<div class="teia-controles"><div class="teia-escolhidas" id="g-escolhidas"></div>' +
      '<label class="teia-add"><span class="sr">' + esc(L("Adicionar empresa", "Add a company")) + "</span>" +
      '<input id="g-busca" type="search" autocomplete="off" spellcheck="false">' +
      '<ul id="g-sugestoes" class="sugestoes" role="listbox" hidden></ul></label>' +
      '<div class="seg g-periodo" role="group" aria-label="' + esc(X.t("periodo")) + '">' + periodos.map(function (p) {
        return '<button type="button" data-periodo="' + p[0] + '" aria-pressed="' + (X.estado.periodo === p[0]) + '">' + p[1] + "</button>";
      }).join("") + "</div></div>" +
      (ativo ? '<p class="aviso-setor">' + esc(L("Setor " + ativo.nome + ": a busca mostra só empresas dele. ", "Sector " + ativo.nome + ": the search lists only its companies. ")) +
        '<button type="button" class="filtro-setor-limpar" id="g-limpar">' + esc(L("Ver todas as empresas", "See all companies")) + "</button></p>" : "") +
      '<div class="g-inds" id="g-inds"></div></section>' +
      '<div class="g-graficos" id="g-graficos"></div>' +
      '<p class="aviso">' + esc(L(
        "Fontes: CVM (demonstrações anuais), B3 (cotações, desdobramentos e proventos) e Banco Central (PTAX). Em US$, a cotação usa a PTAX de cada dia; fluxos do ano, a PTAX média; saldos de balanço, a do fim do ano. Ferramenta de dados, não recomendação de investimento.",
        "Sources: CVM (annual filings), B3 (prices, splits and payouts) and the Central Bank (PTAX). In US$, prices use each day's PTAX rate; yearly flows, the average rate; balance sheet items, the year-end rate. A data tool, not investment advice.")) + "</p>";

    var caixa = app.querySelector("#g-graficos"), rodada = 0;

    function selecao() {
      return escolhidas.map(function (tk, j) { return { tk: tk, e: X.POR_TICKER[tk], cor: CORES[j] }; });
    }
    function guardar() {
      history.replaceState(null, "", "#/graficos/" + escolhidas.join(",") + "/" + inds.join(","));
    }

    // ------------------------------------------------------------ escolha das empresas e dos indicadores
    function chips() {
      app.querySelector("#g-escolhidas").innerHTML = selecao().map(function (x) {
        return '<span class="teia-chip" style="--c:' + x.cor + '"><i></i><a href="#/' + x.tk + '">' + esc(x.tk) + "</a>" +
          '<button type="button" data-tirar="' + x.tk + '" aria-label="' + esc(L("Tirar ", "Remove ") + x.tk) + '">×</button></span>';
      }).join("");
      var input = app.querySelector("#g-busca"), cheio = escolhidas.length >= MAX;
      input.disabled = cheio;
      input.placeholder = cheio ? L("Máximo de " + MAX, "Up to " + MAX) : L("+ Adicionar (ex.: WEGE3)", "+ Add (e.g. WEGE3)");
    }
    function botoesIndicadores() {
      app.querySelector("#g-inds").innerHTML = GRUPOS.map(function (g) {
        return '<div class="g-grupo"><span class="g-grupo-rot">' + esc(L(g[1], g[2])) + '</span><div class="g-lista">' +
          INDS.filter(function (i) { return i.g === g[0]; }).map(function (i) {
            return '<button type="button" class="g-ind" data-ind="' + i.id + '" aria-pressed="' + (inds.indexOf(i.id) >= 0) + '">' + esc(i.nome) + "</button>";
          }).join("") + "</div></div>";
      }).join("");
    }

    // ------------------------------------------------------------ gráficos
    function cartao(ind) {
      var b100 = base100 == null ? escolhidas.length > 1 : base100;
      var extra = ind.id === "cotacao" ? '<div class="seg" role="group" aria-label="' + esc(L("Escala", "Scale")) + '">' +
        '<button type="button" data-base100="0" aria-pressed="' + !b100 + '">' + (X.estado.moeda === "usd" ? "US$" : "R$") + "</button>" +
        '<button type="button" data-base100="1" aria-pressed="' + b100 + '">' + L("Base 100", "Base 100") + "</button></div>" : "";
      return '<section class="cartao g-cartao"><div class="g-cab"><h2>' + esc(ind.nome) + "</h2>" + extra +
        '<button type="button" class="g-fechar" data-tirar-ind="' + ind.id + '" aria-label="' + esc(L("Tirar o gráfico ", "Remove the chart ") + ind.nome) + '">×</button></div>' +
        '<p class="mudo g-sub">' + esc(L(ind.d[0], ind.d[1])) + '</p><div class="grafico" id="g-' + ind.id + '"></div><p class="aviso" id="g-nota-' + ind.id + '"></p></section>';
    }

    function desenhar(ind, rotulos, series, diarioOpts) {
      var el = app.querySelector("#g-" + ind.id), nota = app.querySelector("#g-nota-" + ind.id);
      if (!el) return;
      var com = series.filter(function (s) { return s.v.some(function (v) { return v != null; }); });
      var sem = series.filter(function (s) { return com.indexOf(s) < 0; }).map(function (s) { return s.x.tk; });
      // legenda e dica do maior para o menor último valor
      com.sort(function (a, b) { return ultimoValor(b.v) - ultimoValor(a.v); });
      var fmt = diarioOpts ? diarioOpts.fmt : ind.fmt;
      var linhas = com.map(function (s) { return { nome: s.x.tk, cor: s.x.cor, v: s.v, rotulo: s.x.tk + " · " + fmt(ultimoValor(s.v)) }; });
      var opts = diarioOpts ? { eixo: diarioOpts.eixo, limites: null, pontos: false, rotX: diarioOpts.rotX } : { eixo: ind.eixo, limites: ind.lim };
      X.linhas(el, rotulos, linhas, fmt, opts);
      var avisos = [];
      if (ind.lim && com.some(function (s) { return s.v.some(function (v) { return v != null && (v < ind.lim[0] || v > ind.lim[1]); }); })) {
        avisos.push(L("Valores fora da faixa de ", "Values outside ") + ind.eixo(ind.lim[0]) + L(" a ", " to ") + ind.eixo(ind.lim[1]) +
          L(" ficam na borda do gráfico; a dica mostra o valor real.", " sit on the chart's edge; the tooltip shows the actual value."));
      }
      if (sem.length && com.length) avisos.push(L("Sem dado para ", "No data for ") + sem.join(", ") + ".");
      nota.textContent = avisos.join(" ");
      nota.hidden = !avisos.length;
    }

    function anuais(lista, sel) {
      lista.forEach(function (ind) {
        var r = anual(ind, sel, X.estado.periodo);
        desenhar(ind, r.rotulos, r.series);
      });
    }

    function diarios(lista, sel) {
      if (!lista.length) return;
      var minha = ++rodada, usd = X.estado.moeda === "usd";
      lista.forEach(function (ind) {
        var el = app.querySelector("#g-" + ind.id);
        if (el) el.innerHTML = '<p class="mudo">' + esc(L("Carregando o histórico…", "Loading the price history…")) + "</p>";
      });
      var nomes = sel.map(function (x) { return x.tk; }).concat(usd ? ["_indices"] : []);
      Promise.all(nomes.map(function (n) { return carregar(n).catch(function () { return null; }); })).then(function () {
        if (minha !== rodada || !caixa.isConnected) return;
        var b100 = base100 == null ? escolhidas.length > 1 : base100;
        lista.forEach(function (ind) {
          var emBase = ind.id === "retorno" || b100;
          var r = diaria(ind, sel, X.estado.periodo, b100, usd);
          if (!r) {
            app.querySelector("#g-" + ind.id).innerHTML = '<p class="mudo">' + esc(L("Sem histórico diário para essas ações.", "No daily history for these stocks.")) + "</p>";
            return;
          }
          var anos = (Date.parse(r.eixo[r.eixo.length - 1]) - Date.parse(r.eixo[0])) / (365.25 * 864e5);
          var passo = anos > 12 ? 2 : 1;
          var simbolo = usd ? "US$ " : "R$ ";
          desenhar(ind, r.eixo.map(X.data), r.series, {
            fmt: emBase ? function (v) { return v == null ? "–" : nf(1).format(v); } : function (v) { return v == null ? "–" : simbolo + nf(2).format(v); },
            eixo: function (v) { return nf(emBase || v >= 100 || v % 1 === 0 ? 0 : 2).format(v); },
            rotX: function (rot, k) {
              var a = r.eixo[k].slice(0, 4);
              return k > 0 && r.eixo[k - 1].slice(0, 4) !== a && +a % passo === 0 ? a : "";
            },
          });
        });
      });
    }

    function graficos() {
      var sel = selecao(), lista = INDS.filter(function (i) { return inds.indexOf(i.id) >= 0; });
      caixa.innerHTML = lista.length ? lista.map(cartao).join("") :
        '<section class="cartao"><p class="mudo">' + esc(L("Escolha ao menos um indicador acima.", "Pick at least one metric above.")) + "</p></section>";
      if (!sel.length) {
        caixa.innerHTML = '<section class="cartao"><p class="mudo">' + esc(L("Escolha ao menos uma empresa acima.", "Pick at least one company above.")) + "</p></section>";
        return;
      }
      anuais(lista.filter(function (i) { return !i.diario; }), sel);
      diarios(lista.filter(function (i) { return i.diario; }), sel);
    }

    function atualizar() {
      guardar();
      chips();
      botoesIndicadores();
      graficos();
    }

    // ------------------------------------------------------------ eventos
    if (ativo) app.querySelector("#g-limpar").addEventListener("click", function () { X.definirSetor(""); });
    app.querySelector("#g-escolhidas").addEventListener("click", function (ev) {
      var b = ev.target.closest("[data-tirar]");
      if (!b) return;
      escolhidas = escolhidas.filter(function (tk) { return tk !== b.getAttribute("data-tirar"); });
      atualizar();
    });
    app.querySelector("#g-inds").addEventListener("click", function (ev) {
      var b = ev.target.closest("[data-ind]");
      if (!b) return;
      var id = b.getAttribute("data-ind"), k = inds.indexOf(id);
      if (k >= 0) inds.splice(k, 1); else inds.push(id);
      atualizar();
    });
    caixa.addEventListener("click", function (ev) {
      var fechar = ev.target.closest("[data-tirar-ind]"), escala = ev.target.closest("[data-base100]");
      if (fechar) {
        inds = inds.filter(function (id) { return id !== fechar.getAttribute("data-tirar-ind"); });
        atualizar();
      } else if (escala) {
        base100 = escala.getAttribute("data-base100") === "1";
        graficos();
      }
    });
    app.querySelectorAll("[data-periodo]").forEach(function (b) {
      b.addEventListener("click", function () {
        X.estado.periodo = +b.getAttribute("data-periodo");
        app.querySelectorAll("[data-periodo]").forEach(function (x) { x.setAttribute("aria-pressed", String(x === b)); });
        graficos();
      });
    });

    (function busca() {
      var input = app.querySelector("#g-busca"), lista = app.querySelector("#g-sugestoes"), sel = -1;
      var norm = function (s) { return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase(); };
      function mostrar() {
        var q = norm(input.value.trim());
        if (!q) { lista.hidden = true; return; }
        var ja = escolhidas.map(function (tk) { return X.POR_TICKER[tk]; });
        var achados = universo.filter(function (e) {
          return ja.indexOf(e) < 0 && (e.tickers.some(function (tk) { return norm(tk).indexOf(q) === 0; }) || norm(e.nome).indexOf(q) >= 0);
        }).sort(function (a, b) { return (b.liquidez || 0) - (a.liquidez || 0); }).slice(0, 8);
        sel = achados.length ? 0 : -1;
        lista.innerHTML = achados.map(function (e, k) {
          var tk = e.tickers.filter(function (x) { return norm(x).indexOf(q) === 0; })[0] || e.ticker;
          return '<li role="option" data-t="' + tk + '" aria-selected="' + (k === sel) + '"><b>' + tk + "</b><span>" + esc(X.nomeCurto(e.nome)) + "</span></li>";
        }).join("") || '<li class="mudo">' + esc(X.t("nada_encontrado")) + "</li>";
        lista.hidden = false;
      }
      function escolher(tk) {
        input.value = ""; lista.hidden = true;
        if (escolhidas.length < MAX) { escolhidas.push(tk); atualizar(); }
        var campo = app.querySelector("#g-busca");
        if (!campo.disabled) campo.focus();
      }
      input.addEventListener("input", mostrar);
      input.addEventListener("keydown", function (ev) {
        var itens = lista.querySelectorAll("li[data-t]");
        if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
          ev.preventDefault();
          if (!itens.length) return;
          sel = (sel + (ev.key === "ArrowDown" ? 1 : -1) + itens.length) % itens.length;
          itens.forEach(function (li, k) { li.setAttribute("aria-selected", String(k === sel)); });
        } else if (ev.key === "Enter" && itens[sel]) {
          ev.preventDefault();
          escolher(itens[sel].getAttribute("data-t"));
        } else if (ev.key === "Escape") {
          lista.hidden = true;
        }
      });
      lista.addEventListener("mousedown", function (ev) {
        var li = ev.target.closest("li[data-t]");
        if (li) { ev.preventDefault(); escolher(li.getAttribute("data-t")); }
      });
      input.addEventListener("blur", function () { setTimeout(function () { lista.hidden = true; }, 100); });
    })();

    // redesenha quando a largura muda (o SVG é medido pela largura do quadro)
    var largura = 0;
    var obs = new ResizeObserver(function () {
      if (!caixa.isConnected) { obs.disconnect(); return; }
      if (caixa.clientWidth && caixa.clientWidth !== largura) {
        var antes = largura;
        largura = caixa.clientWidth;
        if (antes) graficos();
      }
    });
    obs.observe(caixa);

    atualizar();
    largura = caixa.clientWidth;
  }

  window.RealTermsGraficos = { render: render, diario: diario, semanal: semanal, anual: anual, diaria: diaria, indicadores: indicadores };
  // app.js roteia antes deste arquivo carregar: se a página aberta já é a de gráficos, desenha agora
  if (typeof document !== "undefined" && document.body && document.body.getAttribute("data-pagina") === "graficos") render(document.getElementById("app"));
})();
