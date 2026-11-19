/* Real Terms — comparar (#/comparar): até quatro empresas lado a lado. O antigo radar ("teia") saiu:
 * ângulo e área são lidos com pouca precisão. Tudo aqui usa posição ou comprimento numa escala comum.
 *  - Placar: indicadores × empresas, com o valor real e a cor da posição entre as ações líquidas.
 *  - Régua do mercado, previsibilidade por componente, qualidade × preço, crescimento, margem e tamanho.
 * As empresas escolhidas ficam no endereço: #/comparar/PETR4,VALE3 (#/teia/… e #/mapa continuam valendo). */
(function () {
  "use strict";

  var LIQUIDEZ_MIN = 1e6, MAX = 4;
  var CORES = ["var(--c1)", "var(--c3)", "var(--c4)", "var(--c5)"];
  var atual = null;  // tela em execução; parar() a desmonta ao trocar de rota

  function parar() {
    if (!atual) return;
    atual.parar();
    atual = null;
  }

  function fundamentos(X) {
    var L = X.L;
    return [
      { id: "score", rot: L("Previsibilidade", "Predictability"), sentido: 1, val: function (e) { return (X.score(e) || {}).total; }, fmt: function (v) { return X.nf(0).format(v); } },
      { id: "dy", rot: L("Dividend yield", "Dividend yield"), sentido: 1, val: function (e, i) { return i.dy; }, fmt: function (v) { return X.pct(v, 1); } },
      { id: "pl", rot: L("P/L", "P/E"), sentido: -1, val: function (e, i) { return i.pl > 0 ? i.pl : null; }, fmt: function (v) { return X.nf(1).format(v) + "x"; } },
      { id: "pvp", rot: L("P/VP", "P/B"), sentido: -1, val: function (e, i) { return i.pvp > 0 ? i.pvp : null; }, fmt: function (v) { return X.nf(2).format(v) + "x"; } },
      { id: "roe", rot: L("ROE", "ROE"), sentido: 1, val: function (e, i) { return i.d12 ? i.roe12 : i.roe; }, fmt: function (v) { return X.pct(v, 1); } },
      { id: "mliq", rot: L("Margem líquida", "Net margin"), sentido: 1, val: function (e, i) { return i.d12 ? i.mLiq12 : i.mLiq; }, fmt: function (v) { return X.pct(v, 1); } },
      { id: "divida", rot: L("Dív. líq./EBITDA", "Net debt/EBITDA"), sentido: -1, val: function (e, i) { return i.d12 ? i.dlEbitda12 : i.dlEbitda; }, fmt: function (v) { return X.nf(1).format(v) + "x"; } },
      { id: "cagr", rot: L("Crescimento da receita (5 anos)", "Revenue growth (5y)"), sentido: 1, val: function (e, i) { return i.cagrRec; }, fmt: function (v) { return X.pct(v, 1); } },
    ];
  }

  function finito(v) { return v != null && isFinite(v); }
  function mediana(arr) {
    var a = arr.filter(finito).sort(function (x, y) { return x - y; });
    if (!a.length) return null;
    var m = a.length >> 1;
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  }
  /** fração do universo que fica atrás do valor (empates contam meio), de 0 a 100 */
  function percentil(v, universo, sentido) {
    if (!finito(v) || !universo.length) return null;
    var atras = 0, empate = 0;
    universo.forEach(function (u) {
      if (u === v) empate++;
      else if (sentido > 0 ? u < v : u > v) atras++;
    });
    return Math.round((atras + empate / 2) / universo.length * 100);
  }

  function lerEscolhidas(X) {
    var m = location.hash.match(/^#\/(?:comparar|teia|mapa)\/([A-Za-z0-9,]+)/);
    var lista = m ? m[1].toUpperCase().split(",") : [];
    var vistos = {};
    return lista.filter(function (tk) {
      var e = X.POR_TICKER[tk];
      if (!e || vistos[e.cd_cvm]) return false;
      vistos[e.cd_cvm] = true;
      return true;
    }).slice(0, MAX);
  }

  function render(app) {
    parar();
    var X = window.RealTerms, L = X.L, esc = X.esc;

    var negociadas = X.EMPRESAS.filter(function (e) { return Object.keys(e.cotacao).length; });
    var liquidas = negociadas.filter(function (e) { return e.liquidez >= LIQUIDEZ_MIN; });
    var info = new Map();
    function ind(e) { if (!info.has(e)) info.set(e, X.indicadores(e)); return info.get(e); }

    var escolhidas = lerEscolhidas(X);
    if (!escolhidas.length) {
      // padrão: as três maiores não financeiras entre as líquidas
      escolhidas = liquidas.filter(function (e) { return !e.financeiro; })
        .sort(function (a, b) { return b.valor_mercado - a.valor_mercado; }).slice(0, 3).map(function (e) { return e.ticker; });
    }

    document.title = X.t("nav_teia") + " · Real Terms";
    app.innerHTML =
      '<section class="teia-cab">' +
      '<span class="olho"><span class="capitulo">VS</span>' + esc(L("Comparar empresas", "Compare companies")) + "</span>" +
      "<h1>" + esc(L("Até quatro empresas, lado a lado", "Up to four companies, side by side")) + "</h1>" +
      '<p class="mudo">' + esc(L(
        "Escolha até quatro empresas. O placar resume tudo numa tabela; os gráficos abaixo mostram cada empresa contra o mercado, sempre na mesma escala.",
        "Pick up to four companies. The scorecard sums it all up in one table; the charts below place each company against the market, always on a common scale.")) + "</p>" +
      "</section>" +
      '<div class="teia-controles">' +
      '<div class="teia-escolhidas" id="t-escolhidas"></div>' +
      '<label class="teia-add"><span class="sr">' + esc(L("Adicionar empresa", "Add a company")) + "</span>" +
      '<input id="t-busca" type="search" autocomplete="off" spellcheck="false">' +
      '<ul id="t-sugestoes" class="sugestoes" role="listbox" hidden></ul></label>' +
      "</div>" +
      '<section class="cartao"><h2>' + esc(L("Placar", "Scorecard")) + '</h2><p class="mudo pequeno">' + esc(L(
        "Valor de cada indicador e posição entre as ações líquidas (p80 = melhor que 80% delas). Verde: acima da mediana; vermelho: abaixo. ↓ = menor é melhor.",
        "Each metric's value and rank among liquid stocks (p80 = better than 80% of them). Green: above the median; red: below. ↓ = lower is better.")) +
      '</p><div class="tabela-wrap teia-tabela" id="t-tabela"></div><p class="aviso" id="t-aviso"></p></section>' +
      '<section class="cartao bloco"><h2>' + esc(L("Onde cada uma está no mercado", "Where each one sits in the market")) + '</h2><p class="mudo pequeno">' + esc(L(
        "Valor real de cada indicador. A faixa clara é onde está a metade do meio das ações líquidas; o traço, a mediana; as pontas, os extremos (5% e 95%). ↓ = menor é melhor. Setas indicam valor fora da régua.",
        "Actual value of each metric. The light band holds the middle half of liquid stocks; the tick is the median; the ends are the 5th and 95th percentiles. ↓ = lower is better. Arrows mark values off the ruler.")) + '</p><div id="t-regua" class="teia-regua"></div></section>' +
      '<section class="cartao bloco"><h2>' + esc(L("Previsibilidade, componente a componente", "Predictability, component by component")) + '</h2><p class="mudo pequeno">' + esc(L(
        "Notas de 0 a 100 nos últimos 10 exercícios; o traço é a mediana das ações líquidas. O índice total é a média ponderada dos cinco componentes.",
        "Scores from 0 to 100 over the last 10 fiscal years; the tick is the median of liquid stocks. The total is the weighted average of the five components.")) + '</p><div id="t-prev"></div></section>' +
      '<div class="duas bloco">' +
      '<section class="cartao"><h2>' + esc(L("Qualidade × preço", "Quality vs. price")) + '</h2><div class="grafico" id="t-disp"></div><p class="aviso">' + esc(L(
        "ROE (rentabilidade) contra P/VP (quanto o mercado paga pelo patrimônio). Em geral, quem rende mais custa mais: abaixo e à direita da nuvem fica quem paga pouco pela rentabilidade. Pontos cinza: ações líquidas; passe o mouse para ver quem é.",
        "ROE (profitability) against P/B (what the market pays for book value). Higher returns usually cost more: below and to the right of the cloud are companies priced low for their returns. Grey dots: liquid stocks; hover to see which.")) + "</p></section>" +
      '<section class="cartao"><h2>' + esc(L("Crescimento da receita", "Revenue growth")) + '</h2><div class="grafico" id="t-cresc"></div><p class="aviso" id="t-cresc-nota"></p></section></div>' +
      '<div class="duas bloco">' +
      '<section class="cartao"><h2>' + esc(L("Margem líquida ao longo do tempo", "Net margin over time")) + '</h2><div class="grafico" id="t-margem"></div><p class="aviso">' + esc(L(
        "Lucro sobre receita, ano a ano: mostra quem sustenta a rentabilidade e quem oscila com o ciclo.",
        "Net income over revenue, year by year: shows who sustains profitability and who swings with the cycle.")) + "</p></section>" +
      '<section class="cartao"><h2>' + esc(L("Tamanho e liquidez", "Size and liquidity")) + '</h2><div id="t-tamanho"></div><p class="aviso">' + esc(L(
        "Barras na mesma escala dentro de cada indicador. Liquidez é o volume médio negociado por dia no último mês.",
        "Bars share a scale within each metric. Liquidity is the average daily traded volume over the last month.")) + "</p></section></div>";

    var dica = document.getElementById("dica");
    var eixos, dados, medianas, ordem;

    // ------------------------------------------------------------ números
    function calcular() {
      eixos = fundamentos(X);
      var universos = eixos.map(function (m) {
        return liquidas.map(function (e) { return m.val(e, ind(e)); }).filter(finito);
      });
      medianas = universos.map(mediana);
      dados = escolhidas.map(function (tk, j) {
        var e = X.POR_TICKER[tk];
        var brutos = eixos.map(function (m) { var v = m.val(e, ind(e)); return finito(v) ? v : null; });
        var notas = brutos.map(function (v, k) { return v == null ? null : percentil(v, universos[k], eixos[k].sentido); });
        var validas = notas.filter(finito);
        var media = validas.length ? validas.reduce(function (s, v) { return s + v; }, 0) / validas.length : -1;
        return { tk: tk, e: e, cor: CORES[j], brutos: brutos, notas: notas, media: media };
      });
      ordem = dados.slice().sort(function (a, b) { return b.media - a.media; });
    }

    /** cópia de `lista` do maior para o menor valor de `val`; sem valor vai para o fim */
    function melhoresPrimeiro(lista, val) {
      return lista.slice().sort(function (a, b) {
        var va = val(a), vb = val(b);
        return (finito(vb) ? vb : -Infinity) - (finito(va) ? va : -Infinity);
      });
    }

    // ------------------------------------------------------------ placar
    function tabela() {
      var cab = "<thead><tr><th>" + esc(L("Indicador", "Metric")) + "</th>" + ordem.map(function (d) {
        return '<th><span class="teia-th"><i style="--c:' + d.cor + '"></i>' + esc(d.tk) + "</span></th>";
      }).join("") + "<th>" + esc(L("Mediana", "Median")) + "</th></tr></thead>";
      var corpo = eixos.map(function (m, k) {
        var topo = Math.max.apply(null, ordem.map(function (d) { return finito(d.notas[k]) ? d.notas[k] : -1; }));
        return "<tr><td>" + esc(m.rot) + (m.sentido < 0 ? ' <span class="mudo">↓</span>' : "") + "</td>" + ordem.map(function (d) {
          var v = d.brutos[k];
          if (v == null) return '<td class="num mudo">–</td>';
          var p = d.notas[k], fundo = "";
          if (p != null) {
            var forca = Math.round(Math.abs(p - 50) / 50 * 26);  // até 26% de cor nos extremos
            fundo = ' style="background:color-mix(in srgb, var(' + (p >= 50 ? "--pos" : "--neg") + ") " + forca + '%, transparent)"';
          }
          var melhor = ordem.length > 1 && p === topo;
          return '<td class="num' + (melhor ? " melhor" : "") + '"' + fundo + ">" + (melhor ? '<span class="coroa" title="' + esc(L("Melhor do grupo", "Best in group")) + '">▲</span>' : "") +
            m.fmt(v) + '<small class="mudo"> p' + p + "</small></td>";
        }).join("") + '<td class="num mudo">' + (medianas[k] == null ? "–" : m.fmt(medianas[k])) + "</td></tr>";
      }).join("");
      app.querySelector("#t-tabela").innerHTML = "<table>" + cab + "<tbody>" + corpo + "</tbody></table>";
    }

    function aviso() {
      app.querySelector("#t-aviso").textContent = L(
        "Colunas da melhor para a pior empresa, pela média dos percentis; ▲ marca o melhor valor de cada linha. Percentis entre as " + liquidas.length + " ações com liquidez de pelo menos R$ 1 mi/dia. Múltiplos, ROE, margem e dívida dos últimos 12 meses quando há ITR. Sem dado (P/L de quem teve prejuízo, dívida de bancos), a célula fica com traço.",
        "Columns run from best to worst company by average percentile; ▲ marks the best value in each row. Percentiles among the " + liquidas.length + " stocks trading at least R$ 1M/day. Multiples, ROE, margin and debt are trailing 12 months when quarterly filings exist. With no value (P/E of a loss-maker, bank debt) the cell shows a dash.");
    }

    // ------------------------------------------------------------ previsibilidade por componente
    function previsibilidade() {
      var comps = [{ id: "total", nome: L("Índice total", "Total score") }].concat(X.componentes());
      var nota = function (e, id) { var s = X.score(e); return s ? (id === "total" ? s.total : s.componentes[id]) : null; };
      app.querySelector("#t-prev").innerHTML = comps.map(function (c) {
        var md = mediana(liquidas.map(function (e) { return nota(e, c.id); }));
        var lista = melhoresPrimeiro(dados, function (d) { return nota(d.e, c.id); });
        return '<div class="prev-bloco' + (c.id === "total" ? " total" : "") + '"><h3>' + esc(c.nome) + "</h3>" + lista.map(function (d) {
          var v = nota(d.e, c.id);
          return '<div class="tam-linha"><span class="tam-tk">' + esc(d.tk) + '</span><span class="tam-trilho prev-trilho">' +
            (finito(v) ? '<i style="width:' + Math.max(1, v) + "%;background:" + d.cor + '"></i>' : "") +
            (md != null ? '<b class="prev-mediana" style="left:' + md + '%" title="' + esc(L("Mediana", "Median")) + '"></b>' : "") +
            '</span><span class="num tam-v">' + (finito(v) ? X.nf(0).format(v) : "–") + "</span></div>";
        }).join("") + "</div>";
      }).join("");
    }
    // ------------------------------------------------------------ mais formas de comparar
    // O radar mostra o "formato" de cada empresa, mas ângulo e área são lidos com pouca precisão e o
    // percentil esconde o valor real. Os gráficos abaixo usam posição numa escala comum, a forma que o
    // olho compara com mais exatidão (Cleveland & McGill), e cada um responde a uma pergunta.
    var hojeR = function (v) { return v == null ? null : X.estado.moeda === "usd" ? v / X.D.ptax_atual.valor : v; };
    function quantil(arr, q) {
      var a = arr.filter(finito).sort(function (x, y) { return x - y; });
      if (!a.length) return null;
      var p = (a.length - 1) * q, b = Math.floor(p);
      return a[b] + (a[Math.min(b + 1, a.length - 1)] - a[b]) * (p - b);
    }
    function dicaEm(ev, html) {
      dica.innerHTML = html; dica.hidden = false;
      var dx = ev.clientX + 14;
      if (dx + dica.offsetWidth > window.innerWidth - 8) dx = ev.clientX - dica.offsetWidth - 14;
      dica.style.left = Math.max(8, dx) + "px";
      dica.style.top = Math.max(8, ev.clientY - dica.offsetHeight - 12) + "px";
    }

    function metricasRegua() {
      return [
        { rot: L("P/L", "P/E"), menor: 1, val: function (e, i) { return i.pl > 0 ? i.pl : null; }, fmt: function (v) { return X.nf(1).format(v) + "x"; } },
        { rot: L("P/VP", "P/B"), menor: 1, val: function (e, i) { return i.pvp > 0 ? i.pvp : null; }, fmt: function (v) { return X.nf(2).format(v) + "x"; } },
        { rot: "EV/EBITDA", menor: 1, val: function (e, i) { return i.evEbitda > 0 ? i.evEbitda : null; }, fmt: function (v) { return X.nf(1).format(v) + "x"; } },
        { rot: L("Dividend yield", "Dividend yield"), val: function (e, i) { return i.dy; }, fmt: function (v) { return X.pct(v, 1); } },
        { rot: "ROE", val: function (e, i) { return i.d12 ? i.roe12 : i.roe; }, fmt: function (v) { return X.pct(v, 1); } },
        { rot: L("Margem líquida", "Net margin"), val: function (e, i) { return i.d12 ? i.mLiq12 : i.mLiq; }, fmt: function (v) { return X.pct(v, 1); } },
        { rot: L("Dív. líq./EBITDA", "Net debt/EBITDA"), menor: 1, val: function (e, i) { return i.d12 ? i.dlEbitda12 : i.dlEbitda; }, fmt: function (v) { return X.nf(1).format(v) + "x"; } },
        { rot: L("Receita, 5 anos (a.a.)", "Revenue, 5y CAGR"), val: function (e, i) { return i.cagrRec; }, fmt: function (v) { return X.pct(v, 1); } },
      ];
    }

    /** 1. Régua do mercado: um indicador por linha; faixa de 50% do meio do mercado, mediana e as empresas */
    function regua() {
      var alvo = app.querySelector("#t-regua");
      var w = Math.max(280, alvo.clientWidth), estreito = w < 560;
      var esq = estreito ? 12 : 170, dir = 16, linha = estreito ? 52 : 40, topo = 8;
      var ms = metricasRegua();
      var h = topo + ms.length * linha + 6;
      var svg = '<svg viewBox="0 0 ' + w + " " + h + '" height="' + h + '" role="img" aria-label="' + esc(L("Régua do mercado", "Market ruler")) + '">';
      var alvos = [];
      ms.forEach(function (m, k) {
        var u = liquidas.map(function (e) { return m.val(e, ind(e)); }).filter(finito);
        var lo = quantil(u, 0.05), hi = quantil(u, 0.95), q1 = quantil(u, 0.25), q3 = quantil(u, 0.75), md = quantil(u, 0.5);
        if (lo == null || hi == null || hi <= lo) return;
        var x0 = esq, x1 = w - dir;
        var x = function (v) { return x0 + (Math.max(lo, Math.min(hi, v)) - lo) / (hi - lo) * (x1 - x0); };
        var y = topo + k * linha + (estreito ? 30 : linha / 2);
        if (estreito) svg += '<text class="eixo regua-rot" x="' + x0 + '" y="' + (y - 14) + '">' + esc(m.rot) + (m.menor ? " ↓" : "") + "</text>";
        else svg += '<text class="eixo regua-rot" x="' + (esq - 12) + '" y="' + (y + 4) + '" text-anchor="end">' + esc(m.rot) + (m.menor ? " ↓" : "") + "</text>";
        svg += '<line class="grade" x1="' + x0 + '" x2="' + x1 + '" y1="' + y + '" y2="' + y + '"/>';
        svg += '<rect class="regua-faixa" x="' + x(q1) + '" y="' + (y - 7) + '" width="' + Math.max(1, x(q3) - x(q1)) + '" height="14" rx="3"/>';
        svg += '<line class="regua-mediana" x1="' + x(md) + '" x2="' + x(md) + '" y1="' + (y - 10) + '" y2="' + (y + 10) + '"/>';
        svg += '<text class="eixo" x="' + x0 + '" y="' + (y + 21) + '">' + m.fmt(lo) + '</text><text class="eixo" x="' + x1 + '" y="' + (y + 21) + '" text-anchor="end">' + m.fmt(hi) + "</text>";
        dados.forEach(function (d, j) {
          var v = m.val(d.e, ind(d.e));
          if (!finito(v)) return;
          var px = x(v), fora = v < lo || v > hi;
          var dy = (j - (dados.length - 1) / 2) * 3;  // empresas com o mesmo valor não se escondem
          svg += '<circle cx="' + px.toFixed(1) + '" cy="' + (y + dy).toFixed(1) + '" r="6" fill="' + d.cor + '" stroke="var(--surface)" stroke-width="1.5"/>';
          if (fora) svg += '<text class="eixo" x="' + (px + (v > hi ? -10 : 10)) + '" y="' + (y - 9) + '" text-anchor="' + (v > hi ? "end" : "start") + '">' + (v > hi ? "→" : "←") + "</text>";
          alvos.push({ x: px, y: y + dy, d: d, m: m, v: v, md: md });
        });
      });
      alvo.innerHTML = svg + "</svg>";
      var s = alvo.querySelector("svg");
      s.onpointermove = function (ev) {
        var r = s.getBoundingClientRect(), k = w / r.width, px = (ev.clientX - r.left) * k, py = (ev.clientY - r.top) * k;
        var melhor = null, dmin = 14;
        alvos.forEach(function (a) { var dd = Math.hypot(a.x - px, a.y - py); if (dd < dmin) { dmin = dd; melhor = a; } });
        if (!melhor) { dica.hidden = true; return; }
        dicaEm(ev, "<b>" + esc(melhor.m.rot) + '</b><div><span><i style="--c:' + melhor.d.cor + '"></i>' + esc(melhor.d.tk) + '</span><span class="num">' + melhor.m.fmt(melhor.v) +
          '</span></div><div><span class="mudo">' + esc(L("Mediana do mercado", "Market median")) + '</span><span class="num">' + melhor.m.fmt(melhor.md) + "</span></div>");
      };
      s.onpointerleave = function () { dica.hidden = true; };
    }

    /** 2. Qualidade × preço: ROE contra P/VP; quem fica abaixo da nuvem paga pouco pela rentabilidade */
    function dispersao() {
      var alvo = app.querySelector("#t-disp");
      var w = Math.max(280, alvo.clientWidth), h = 300, m = { t: 12, r: 14, b: 38, l: 46 };
      var roe = function (e) { var i = ind(e); return i.d12 ? i.roe12 : i.roe; };
      var pvp = function (e) { var i = ind(e); return i.pvp > 0 ? i.pvp : null; };
      var R = [-0.1, 0.4], P = [0, 5];
      var px = function (v) { return m.l + (Math.max(R[0], Math.min(R[1], v)) - R[0]) / (R[1] - R[0]) * (w - m.l - m.r); };
      var py = function (v) { return h - m.b - (Math.max(P[0], Math.min(P[1], v)) - P[0]) / (P[1] - P[0]) * (h - m.t - m.b); };
      var svg = '<svg viewBox="0 0 ' + w + " " + h + '" height="' + h + '" role="img" aria-label="' + esc(L("ROE contra P/VP", "ROE against P/B")) + '">';
      [-0.1, 0, 0.1, 0.2, 0.3, 0.4].forEach(function (v) {
        svg += '<line class="' + (v === 0 ? "zero" : "grade") + '" x1="' + px(v) + '" x2="' + px(v) + '" y1="' + m.t + '" y2="' + (h - m.b) + '"/>' +
          '<text class="eixo" x="' + px(v) + '" y="' + (h - m.b + 15) + '" text-anchor="middle">' + X.nf(0).format(v * 100) + "%</text>";
      });
      [0, 1, 2, 3, 4, 5].forEach(function (v) {
        svg += '<line class="grade" x1="' + m.l + '" x2="' + (w - m.r) + '" y1="' + py(v) + '" y2="' + py(v) + '"/>' +
          '<text class="eixo" x="' + (m.l - 8) + '" y="' + (py(v) + 4) + '" text-anchor="end">' + v + "x</text>";
      });
      svg += '<text class="eixo" x="' + (w - m.r) + '" y="' + (h - 4) + '" text-anchor="end">ROE →</text>' +
        '<text class="eixo" x="' + m.l + '" y="' + (m.t - 2 + 10) + '" dx="4">' + esc(L("P/VP ↑", "P/B ↑")) + "</text>";
      var fundo = [];
      liquidas.forEach(function (e) {
        var a = roe(e), b = pvp(e);
        if (!finito(a) || !finito(b)) return;
        fundo.push({ e: e, x: px(a), y: py(b), a: a, b: b });
        svg += '<circle class="disp-fundo" cx="' + px(a).toFixed(1) + '" cy="' + py(b).toFixed(1) + '" r="3"/>';
      });
      dados.forEach(function (d) {
        var a = roe(d.e), b = pvp(d.e);
        if (!finito(a) || !finito(b)) return;
        svg += '<circle cx="' + px(a).toFixed(1) + '" cy="' + py(b).toFixed(1) + '" r="7" fill="' + d.cor + '" stroke="var(--surface)" stroke-width="2"/>' +
          '<text class="disp-rot" x="' + (px(a) + 10).toFixed(1) + '" y="' + (py(b) + 4).toFixed(1) + '" fill="' + d.cor + '">' + esc(d.tk) + "</text>";
      });
      alvo.innerHTML = svg + "</svg>";
      var s = alvo.querySelector("svg");
      s.onpointermove = function (ev) {
        var r = s.getBoundingClientRect(), k = w / r.width, x = (ev.clientX - r.left) * k, y = (ev.clientY - r.top) * k;
        var melhor = null, dmin = 10;
        fundo.forEach(function (f) { var dd = Math.hypot(f.x - x, f.y - y); if (dd < dmin) { dmin = dd; melhor = f; } });
        if (!melhor) { dica.hidden = true; return; }
        dicaEm(ev, "<b>" + esc(melhor.e.ticker + " · " + X.nomeCurto(melhor.e.nome)) + '</b><div><span class="mudo">ROE</span><span class="num">' + X.pct(melhor.a, 1) +
          '</span></div><div><span class="mudo">' + esc(L("P/VP", "P/B")) + '</span><span class="num">' + X.nf(2).format(melhor.b) + "x</span></div>");
      };
      s.onpointerleave = function () { dica.hidden = true; };
    }

    /** série anual na moeda da tela (fluxos pela PTAX média do ano) */
    function serieMoeda(e, chave) {
      return e.series[chave].map(function (v, k) {
        if (v == null || X.estado.moeda === "brl") return v;
        var p = X.D.ptax[String(e.anos[k])];
        return p ? v / p.media : null;
      });
    }

    /** séries do maior para o menor último valor (ordem da legenda e da dica) */
    function porUltimo(series) {
      var fim = function (s) { for (var k = s.v.length - 1; k >= 0; k--) if (finito(s.v[k])) return s.v[k]; return null; };
      return melhoresPrimeiro(series, fim);
    }

    /** 3 e 4. Receita em base 100 e margem líquida, nos últimos 10 anos em comum */
    function evolucao() {
      var anos = [];
      var ultimo = Math.max.apply(null, dados.map(function (d) { return d.e.anos[d.e.anos.length - 1]; }));
      for (var a = ultimo - 9; a <= ultimo; a++) anos.push(a);
      var porAno = function (d, chave) {
        var s = serieMoeda(d.e, chave);
        return anos.map(function (a) { var k = d.e.anos.indexOf(a); return k < 0 ? null : s[k]; });
      };
      // base 100 no primeiro ano em que todas têm receita positiva
      var recs = dados.map(function (d) { return porAno(d, "receita"); });
      var base = -1;
      for (var k = 0; k < anos.length && base < 0; k++) {
        if (recs.every(function (r) { return r[k] > 0; })) base = k;
      }
      var cresc = app.querySelector("#t-cresc");
      if (base < 0) {
        cresc.innerHTML = '<p class="mudo">' + esc(L("Sem um ano com receita de todas as empresas.", "No year with revenue for every company.")) + "</p>";
      } else {
        X.linhas(cresc, anos.slice(base), porUltimo(dados.map(function (d, j) {
          return { nome: d.tk, cor: d.cor, v: recs[j].slice(base).map(function (v) { return v > 0 ? v / recs[j][base] * 100 : null; }) };
        })), function (v) { return v == null ? "–" : X.nf(0).format(v); }, { eixo: function (v) { return X.nf(0).format(v); }, limites: null });
        app.querySelector("#t-cresc-nota").textContent = L("Receita de " + anos[base] + " = 100", "Revenue in " + anos[base] + " = 100") +
          (X.estado.moeda === "usd" ? L(", em US$", ", in US$") : L(", em R$", ", in R$")) + ".";
      }
      X.linhas(app.querySelector("#t-margem"), anos, porUltimo(dados.map(function (d) {
        var r = porAno(d, "receita"), l = porAno(d, "lucro_liquido");
        return { nome: d.tk, cor: d.cor, v: r.map(function (v, k) { return v > 0 && l[k] != null ? l[k] / v : null; }) };
      })), function (v) { return X.pct(v, 1); });
    }

    /** 5. Tamanho e liquidez: barras na mesma escala dentro de cada indicador */
    function tamanho() {
      var ms = [
        { rot: L("Valor de mercado", "Market cap"), val: function (e) { return hojeR(e.valor_mercado); } },
        { rot: L("Receita (12 meses)", "Revenue (TTM)"), val: function (e) { var t = e.ttm; var v = t && t.receita != null ? t.receita : e.series.receita[e.series.receita.length - 1]; return hojeR(v); } },
        { rot: L("Volume negociado por dia", "Daily traded volume"), val: function (e) { return e.liquidez == null ? null : hojeR(e.liquidez / 1000); } },
      ];
      app.querySelector("#t-tamanho").innerHTML = ms.map(function (m) {
        var lista = melhoresPrimeiro(dados, function (d) { return m.val(d.e); });
        var vs = lista.map(function (d) { return m.val(d.e); });
        var max = Math.max.apply(null, vs.filter(finito).concat([1]));
        return '<div class="tam-bloco"><h3>' + esc(m.rot) + "</h3>" + lista.map(function (d, j) {
          var v = vs[j];
          return '<div class="tam-linha"><span class="tam-tk">' + esc(d.tk) + '</span><span class="tam-trilho"><i style="width:' +
            (finito(v) && v > 0 ? Math.max(1, v / max * 100) : 0) + "%;background:" + d.cor + '"></i></span><span class="num tam-v">' + (finito(v) ? X.dinheiro(v) : "–") + "</span></div>";
        }).join("") + "</div>";
      }).join("");
    }

    function maisGraficos() {
      if (!dados.length) return;
      regua(); dispersao(); evolucao(); tamanho();
    }


    // ------------------------------------------------------------ escolha das empresas
    function chips() {
      app.querySelector("#t-escolhidas").innerHTML = dados.map(function (d) {
        return '<span class="teia-chip" style="--c:' + d.cor + '"><i></i><a href="#/' + d.tk + '">' + esc(d.tk) + "</a>" +
          '<button data-tirar="' + d.tk + '" aria-label="' + esc(L("Tirar ", "Remove ") + d.tk) + '">×</button></span>';
      }).join("");
      var input = app.querySelector("#t-busca"), cheio = escolhidas.length >= MAX;
      input.disabled = cheio;
      input.placeholder = cheio ? L("Máximo de " + MAX, "Up to " + MAX) : L("+ Adicionar (ex.: WEGE3)", "+ Add (e.g. WEGE3)");
    }

    function atualizar() {
      history.replaceState(null, "", "#/comparar/" + escolhidas.join(","));
      calcular(); chips(); tabela(); aviso(); previsibilidade(); maisGraficos();
    }

    app.querySelector("#t-escolhidas").addEventListener("click", function (ev) {
      var b = ev.target.closest("[data-tirar]");
      if (!b) return;
      escolhidas = escolhidas.filter(function (tk) { return tk !== b.getAttribute("data-tirar"); });
      atualizar();
    });

    (function busca() {
      var input = app.querySelector("#t-busca"), lista = app.querySelector("#t-sugestoes"), sel = -1;
      var norm = function (s) { return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase(); };
      function mostrar() {
        var q = norm(input.value.trim());
        if (!q) { lista.hidden = true; return; }
        var ja = escolhidas.map(function (tk) { return X.POR_TICKER[tk]; });
        var achados = negociadas.filter(function (e) {
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
        if (!input.disabled) input.focus();
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


    // ------------------------------------------------------------ tamanho
    var palco = app.querySelector("#t-regua"), largura = 0;
    var obs = new ResizeObserver(function () {
      if (palco.clientWidth && palco.clientWidth !== largura) { largura = palco.clientWidth; maisGraficos(); }
    });
    obs.observe(palco);

    atualizar();
    largura = palco.clientWidth;

    atual = { parar: function () { obs.disconnect(); dica.hidden = true; } };
  }

  window.RealTermsTeia = { render: render, parar: parar };
  // app.js roda primeiro; se a página aberta é a de comparar, desenha agora
  if (document.body.getAttribute("data-pagina") === "teia") render(document.getElementById("app"));
})();
