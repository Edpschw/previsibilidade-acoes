/* Real Terms — página de entrada em capítulos (#/), para quem chega de fora.
 * Todos os números vêm da base (window.DADOS) pela API window.RealTerms exposta em app.js. */
(function () {
  "use strict";

  function render(app) {
    var X = window.RealTerms, D = X.D, L = X.L, esc = X.esc;
    document.title = X.t("titulo");

    // ---------------------------------------------------------------- números da base
    var negociadas = X.EMPRESAS.filter(function (e) { return Object.keys(e.cotacao).length; });
    var info = negociadas.map(function (e) { return { e: e, i: X.indicadores(e) }; });
    var vmTotal = negociadas.reduce(function (s, e) { return s + (e.valor_mercado || 0); }, 0);
    var adrs = X.EMPRESAS.filter(function (e) { return e.exterior.length; }).length;
    var anoIni = Math.min.apply(null, X.EMPRESAS.map(function (e) { return e.anos[0]; }));
    var mediana = function (arr) {
      var v = arr.filter(function (x) { return x != null && isFinite(x); }).sort(function (a, b) { return a - b; });
      return v.length ? v[Math.floor(v.length / 2)] : null;
    };
    var plMed = mediana(info.map(function (x) { return x.i.pl; }));
    var dyMed = mediana(info.map(function (x) { return x.i.dy; }));
    var comScore = X.EMPRESAS.filter(function (e) { return e.score.brl; });
    var altas = comScore.filter(function (e) { return e.score.brl.total >= 75; }).length;
    var hoje = function (v) { return X.estado.moeda === "brl" ? v : v / D.ptax_atual.valor; };

    var top = negociadas.filter(function (e) { return e.score[X.estado.moeda] && e.liquidez >= 1e6; })
      .sort(function (a, b) { return b.score[X.estado.moeda].total - a.score[X.estado.moeda].total; }).slice(0, 6);

    // efeito do câmbio: quanto o índice cai quando receita e lucro são medidos em dólar
    var cambio = comScore.filter(function (e) { return e.score.usd && e.liquidez >= 1e6; }).map(function (e) {
      return { e: e, d: e.score.usd.total - e.score.brl.total };
    });
    var caem = cambio.filter(function (x) { return x.d <= -5; }).length;
    var pior = cambio.slice().sort(function (a, b) { return a.d - b.d; })[0];
    var anosPtax = Object.keys(D.ptax).map(Number).sort();
    var p0 = D.ptax[String(anosPtax[0])].media, p1 = D.ptax_atual.valor;

    // ---------------------------------------------------------------- capítulos
    var caps = [
      ["s-i1", L("O mercado", "The market")],
      ["s-i2", L("Previsibilidade", "Predictability")],
      ["s-i3", L("Real × dólar", "Real vs. dollar")],
      ["s-i4", L("Glossário", "Glossary")],
      ["s-i5", L("Comece aqui", "Start here")],
    ];
    var num = function (k) { return (k < 9 ? "0" : "") + (k + 1); };
    var cap = function (k) { return '<span class="capitulo">' + num(k) + "</span>"; };
    var nav = '<nav class="secoes" aria-label="' + esc(X.t("secoes")) + '"><div class="secoes-trilho"><i></i></div><ol>' +
      caps.map(function (c, k) {
        return '<li><a href="#" data-ir="' + c[0] + '"><span class="n">' + num(k) + '</span><span class="r">' + esc(c[1]) + "</span></a></li>";
      }).join("") + "</ol></nav>";

    var stat = function (v, rot) { return '<div class="i-stat"><b class="num">' + v + "</b><span>" + esc(rot) + "</span></div>"; };

    var c1 =
      '<section class="i-hero secao" id="s-i1">' +
      '<span class="olho">' + cap(0) + esc(L("Ações brasileiras para quem investe de fora", "Brazilian equities for international investors")) + "</span>" +
      "<h1>" + esc(L("Ações brasileiras, em termos reais.", "Brazilian stocks, in real terms.")) + "</h1>" +
      '<p class="i-lead">' + esc(L(
        "Balanços oficiais entregues à CVM desde " + anoIni + ", cotações da B3 e o câmbio do Banco Central, num só lugar. Sem opinião, sem recomendação: dados que você pode conferir na fonte.",
        "Official statements filed with the CVM since " + anoIni + ", B3 prices and the Central Bank exchange rate, in one place. No opinions, no recommendations: data you can check at the source.")) + "</p>" +
      '<div class="i-ctas"><a class="botao" href="#/acoes">' + esc(L("Ver as " + X.EMPRESAS.length + " empresas", "Browse all " + X.EMPRESAS.length + " companies")) + "</a>" +
      '<a class="botao sec" href="#/teia">' + esc(L("Comparar empresas", "Compare companies")) + "</a></div>" +
      '<div class="i-stats">' +
      stat(X.EMPRESAS.length, L("empresas com balanço na CVM", "companies with CVM filings")) +
      stat(negociadas.length, L("negociadas no último mês", "traded in the last month")) +
      stat(X.dinheiro(hoje(vmTotal)), L("de valor de mercado somado", "combined market cap")) +
      stat(adrs, L("também listadas no exterior (ADR)", "also listed abroad (ADRs)")) +
      stat(X.vezes(plMed), L("P/L mediano (12 meses)", "median P/E (trailing)")) +
      stat(X.pct(dyMed), L("dividend yield mediano", "median dividend yield")) +
      "</div></section>";

    var comps = X.componentes();
    var c2 =
      '<section class="cartao secao i-cap" id="s-i2">' +
      "<h2>" + cap(1) + esc(L("Previsível é o negócio que repete o próprio resultado", "A predictable business repeats its own results")) + "</h2>" +
      '<div class="i-duas"><div>' +
      "<p>" + esc(L(
        "O índice de previsibilidade (0–100) olha os últimos 10 anos de cada empresa e pergunta: o lucro foi positivo? A margem oscilou pouco? A receita cresceu de forma constante? Os dividendos vieram todo ano? Não diz se a ação está barata; diz o quanto o passado foi regular.",
        "The predictability score (0–100) looks at each company's last 10 years and asks: were earnings positive? Did margins hold steady? Did revenue grow consistently? Were dividends paid every year? It does not say whether a stock is cheap; it says how regular the past has been.")) + "</p>" +
      '<ul class="i-pesos">' + comps.map(function (c) {
        return '<li><span>' + esc(c.nome) + '</span><i style="--w:' + c.peso / 30 * 100 + '%"></i><b class="num">' + c.peso + "%</b></li>";
      }).join("") + "</ul>" +
      '<p class="mudo">' + esc(L(altas + " de " + comScore.length + " empresas com histórico suficiente têm previsibilidade alta (75 ou mais).",
        altas + " of " + comScore.length + " companies with enough history score high (75 or more).")) + "</p>" +
      "</div><div>" +
      "<h3>" + esc(L("As mais previsíveis entre as líquidas", "Most predictable among liquid stocks")) + "</h3>" +
      '<p class="mudo pequeno">' + esc(L("Liquidez de pelo menos R$ 1 mi por dia.", "At least R$ 1 million traded per day.")) + "</p>" +
      '<div class="i-top">' + top.map(function (e) {
        var s = e.score[X.estado.moeda], nv = X.nivelScore(s.total);
        return '<a class="i-top-item" href="#/' + e.ticker + '"><span class="i-top-n" style="--cor:' + nv.cor + '">' + s.total + "</span>" +
          "<span><b>" + e.ticker + "</b><small>" + esc(X.nomeCurto(e.nome)) + " · " + esc(X.setor(e)) + "</small></span></a>";
      }).join("") + "</div></div></div></section>";

    var c3 =
      '<section class="cartao secao i-cap" id="s-i3">' +
      "<h2>" + cap(2) + esc(L("Em dólar, a história muda", "In dollars, the story changes")) + "</h2>" +
      '<div class="i-duas"><div>' +
      "<p>" + esc(L(
        "Quem investe de fora recebe em reais e mede em dólares. Em " + anosPtax[0] + " um dólar valia R$ " + X.nf(2).format(p0) + "; hoje vale R$ " + X.nf(2).format(p1) + ". Uma empresa que cresce todo ano em reais pode encolher em dólar.",
        "International investors are paid in reais but measure in dollars. In " + anosPtax[0] + " one dollar bought R$ " + X.nf(2).format(p0) + "; today it buys R$ " + X.nf(2).format(p1) + ". A company that grows every year in reais can shrink in dollars.")) + "</p>" +
      "<p>" + esc(L(
        "Por isso o Real Terms calcula o índice também em US$, com receita e lucro convertidos pela PTAX. Entre as ações líquidas, " + caem + " perdem 5 pontos ou mais quando medidas em dólar" + (pior ? "; a maior queda é a de " + pior.e.ticker + " (" + pior.e.score.brl.total + " → " + pior.e.score.usd.total + ")." : "."),
        "That is why Real Terms also computes the score in US$, with revenue and earnings converted at the PTAX rate. Among liquid stocks, " + caem + " lose 5 points or more when measured in dollars" + (pior ? "; the largest drop is " + pior.e.ticker + " (" + pior.e.score.brl.total + " → " + pior.e.score.usd.total + ")." : "."))) + "</p>" +
      '<p class="mudo pequeno">' + esc(L("Use o seletor R$ | US$ no topo: todas as páginas mudam junto.", "Use the R$ | US$ switch at the top: every page follows.")) + "</p>" +
      '</div><div><div class="grafico" id="g-ptax"></div><p class="aviso">' +
      esc(L("Reais por dólar, PTAX média de cada ano (Banco Central).", "Reais per dollar, yearly average PTAX rate (Central Bank of Brazil).")) + "</p></div></div></section>";

    var glossario = [
      ["CVM", L("Comissão de Valores Mobiliários, o regulador do mercado de capitais (equivalente à SEC). Recebe e publica os balanços.", "Brazil's securities regulator (the SEC equivalent). It receives and publishes company filings.")],
      ["DFP · ITR", L("Demonstrações anuais (DFP) e trimestrais (ITR) no formato padronizado da CVM. São a fonte de todos os fundamentos aqui.", "Annual (DFP) and quarterly (ITR) statements in the CVM's standardized format. They are the source of every fundamental here.")],
      ["ON · PN · Unit", L("Ação ordinária (vota, final 3), preferencial (prioridade nos dividendos, final 4 a 6) e unit (pacote de ON e PN, final 11).", "Common share (voting, ends in 3), preferred share (dividend priority, ends in 4–6) and unit (a bundle of both, ends in 11).")],
      ["JCP", L("Juros sobre capital próprio: forma de remunerar o acionista dedutível do imposto da empresa. Soma-se aos dividendos.", "Interest on equity: a tax-deductible way for Brazilian companies to pay shareholders, on top of dividends.")],
      ["Novo Mercado", L("Segmento da B3 com as regras de governança mais exigentes: só ações ON e proteção a minoritários.", "B3's listing segment with the strictest governance rules: common shares only and minority protections.")],
      ["PTAX", L("Taxa de câmbio oficial calculada pelo Banco Central, usada para converter todos os valores em dólar.", "The Central Bank's official exchange rate, used to convert every figure to dollars.")],
      ["ADR", L("Recibo negociado em bolsa americana que representa ações brasileiras. Selo ADR indica empresa listada também no exterior.", "A receipt traded on a US exchange that represents Brazilian shares. The ADR badge marks companies also listed abroad.")],
      [L("Estatal", "State-owned"), L("Empresa controlada pelo governo federal ou estadual. Costuma ter risco político próprio.", "A company controlled by the federal or a state government, usually with its own political risk.")],
    ];
    var c4 =
      '<section class="cartao secao i-cap" id="s-i4">' +
      "<h2>" + cap(3) + esc(L("O vocabulário em oito termos", "The vocabulary in eight terms")) + "</h2>" +
      '<dl class="i-glossario">' + glossario.map(function (g) { return "<div><dt>" + esc(g[0]) + "</dt><dd>" + esc(g[1]) + "</dd></div>"; }).join("") + "</dl></section>";

    var passos = [
      [L("Filtre", "Filter"), L("No ranking, escolha setor, segmento e controle, e ordene por previsibilidade, P/L ou dividendos.", "In the ranking, pick sector, segment and ownership, and sort by predictability, P/E or yield."), "#/acoes", L("Abrir ranking", "Open ranking")],
      [L("Aprofunde", "Dig in"), L("Na página da empresa: resumo automático, múltiplos de 12 meses, histórico de 17 anos e como o índice foi calculado.", "On a company page: automatic summary, trailing multiples, 17 years of history and how the score was built."), "#/" + (top[0] ? top[0].ticker : "PETR4"), L("Ver um exemplo", "See an example")],
      [L("Compare", "Compare"), L("Na teia, até quatro empresas lado a lado em oito indicadores, contra a mediana do mercado.", "On the radar, up to four companies side by side on eight metrics, against the market median."), "#/teia", L("Abrir a teia", "Open the radar")],
    ];
    var c5 =
      '<section class="secao i-cap i-passos-sec" id="s-i5">' +
      "<h2>" + cap(4) + esc(L("Três passos", "Three steps")) + "</h2>" +
      '<div class="i-passos">' + passos.map(function (p, k) {
        return '<a class="i-passo cartao" href="' + p[2] + '"><span class="i-passo-n">' + num(k) + "</span><h3>" + esc(p[0]) + "</h3><p>" + esc(p[1]) + '</p><span class="i-passo-cta">' + esc(p[3]) + " →</span></a>";
      }).join("") + "</div>" +
      '<p class="aviso">' + esc(X.t("rodape_aviso")) + "</p></section>";

    app.innerHTML = nav + '<div class="inicio">' + c1 + c2 + c3 + c4 + c5 + "</div>";

    // gráfico da PTAX
    X.linhas(document.getElementById("g-ptax"), anosPtax,
      [{ nome: L("R$ por US$", "R$ per US$"), cor: "var(--c3)", v: anosPtax.map(function (a) { return D.ptax[String(a)].media; }) }],
      function (v) { return "R$ " + X.nf(2).format(v); },
      { eixo: function (v) { return X.nf(0).format(v); }, limites: null });

    Array.prototype.forEach.call(app.querySelectorAll("[data-ir]"), function (a) {
      a.addEventListener("click", function (ev) {
        ev.preventDefault();
        var alvo = document.getElementById(a.getAttribute("data-ir"));
        if (alvo) alvo.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
      });
    });
    X.observarSecoes();
  }

  window.RealTermsInicio = { render: render };
  // app.js roda primeiro; se a página aberta é o início, desenha agora
  if (document.body.getAttribute("data-pagina") === "inicio") render(document.getElementById("app"));
})();
