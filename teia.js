/* Real Terms — teia (#/teia): até quatro empresas lado a lado num gráfico de radar, em SVG.
 * Dois conjuntos de eixos:
 *  - Fundamentos: oito indicadores, cada um como percentil entre as ações líquidas (≥ R$ 1 mi/dia).
 *    Mais para fora é sempre o lado favorável a quem investe (P/L, P/VP e dívida contam ao contrário).
 *  - Previsibilidade: os cinco componentes do índice, nas notas de 0 a 100 da própria empresa.
 * A linha tracejada é a mediana do mercado. As empresas escolhidas ficam no endereço: #/teia/PETR4,VALE3 */
(function () {
  "use strict";

  var LIQUIDEZ_MIN = 1e6, MAX = 4;
  var CORES = ["var(--c1)", "var(--c3)", "var(--c4)", "var(--c5)"];
  var conjunto = "fund";  // "fund" | "prev"; sobrevive à troca de moeda e idioma
  var atual = null;       // tela em execução; parar() a desmonta ao trocar de rota

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
      { id: "cagr", rot: L("Crescimento da receita", "Revenue growth"), sentido: 1, val: function (e, i) { return i.cagrRec; }, fmt: function (v) { return X.pct(v, 1); } },
    ];
  }

  function previsibilidade(X) {
    return X.componentes().map(function (c) {
      return { id: c.id, rot: c.nome, sentido: 1, val: function (e) { var s = X.score(e); return s ? s.componentes[c.id] : null; }, fmt: function (v) { return X.nf(0).format(v); } };
    });
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

  /** quebra rótulos longos em duas linhas, no espaço (ou depois da barra) mais perto do meio */
  function linhasRotulo(txt, estreito) {
    if (!estreito || txt.length <= 10) return [txt];
    var meio = txt.length / 2, melhor = -1;
    for (var k = 1; k < txt.length - 1; k++) {
      var corte = txt[k] === " " ? k : txt[k] === "/" ? k + 1 : -1;
      if (corte > 0 && (melhor < 0 || Math.abs(corte - meio) < Math.abs(melhor - meio))) melhor = corte;
    }
    if (melhor < 0) return [txt];
    return [txt.slice(0, melhor).trim(), txt.slice(melhor).trim()];
  }

  function lerEscolhidas(X) {
    var m = location.hash.match(/^#\/(?:teia|mapa)\/([A-Za-z0-9,]+)/);
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
        "Cada ponta da teia é um indicador. Quanto mais para fora, mais favorável para quem investe; a linha tracejada é a mediana das ações líquidas da B3. Passe o mouse ou toque num eixo para ver os números.",
        "Each spoke is a metric. The further out, the better for the investor; the dashed line is the median of liquid B3 stocks. Hover or tap a spoke to see the numbers.")) + "</p>" +
      "</section>" +
      '<div class="teia-controles">' +
      '<div class="teia-escolhidas" id="t-escolhidas"></div>' +
      '<label class="teia-add"><span class="sr">' + esc(L("Adicionar empresa", "Add a company")) + "</span>" +
      '<input id="t-busca" type="search" autocomplete="off" spellcheck="false">' +
      '<ul id="t-sugestoes" class="sugestoes" role="listbox" hidden></ul></label>' +
      '<div class="seg" role="group" aria-label="' + esc(L("Eixos", "Axes")) + '">' +
      '<button data-conjunto="fund">' + esc(L("Fundamentos", "Fundamentals")) + "</button>" +
      '<button data-conjunto="prev">' + esc(L("Previsibilidade", "Predictability")) + "</button></div>" +
      "</div>" +
      '<section class="cartao teia-palco"><div class="teia-grafico" id="t-grafico"></div><div id="t-legenda"></div></section>' +
      '<p class="aviso" id="t-aviso"></p>' +
      '<div class="tabela-wrap bloco teia-tabela" id="t-tabela"></div>' +
      '<section class="bloco teia-mais"><h2>' + esc(L("Mais formas de comparar", "More ways to compare")) + '</h2><p class="mudo">' + esc(L(
        "A teia mostra o formato de cada empresa, mas o olho compara mal ângulos e áreas, e o percentil esconde o valor real. Os gráficos abaixo põem as empresas numa mesma escala, a forma mais precisa de comparar, e cada um responde a uma pergunta.",
        "The radar shows each company's shape, but eyes compare angles and areas poorly, and percentiles hide the actual value. The charts below put the companies on a common scale, the most accurate way to compare, and each answers one question.")) + "</p></section>" +
      '<section class="cartao bloco"><h2>' + esc(L("Onde cada uma está no mercado", "Where each one sits in the market")) + '</h2><p class="mudo pequeno">' + esc(L(
        "Valor real de cada indicador. A faixa clara é onde está a metade do meio das ações líquidas; o traço, a mediana; as pontas, os extremos (5% e 95%). ↓ = menor é melhor. Setas indicam valor fora da régua.",
        "Actual value of each metric. The light band holds the middle half of liquid stocks; the tick is the median; the ends are the 5th and 95th percentiles. ↓ = lower is better. Arrows mark values off the ruler.")) + '</p><div id="t-regua" class="teia-regua"></div></section>' +
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

    var el = app.querySelector("#t-grafico");
    var dica = document.getElementById("dica");
    var eixos, dados, medianas, ativo = -1, geo = null;

    // ------------------------------------------------------------ números
    function calcular() {
      eixos = conjunto === "fund" ? fundamentos(X) : previsibilidade(X);
      var universos = eixos.map(function (m) {
        return liquidas.map(function (e) { return m.val(e, ind(e)); }).filter(finito);
      });
      medianas = universos.map(mediana);
      dados = escolhidas.map(function (tk, j) {
        var e = X.POR_TICKER[tk];
        var brutos = eixos.map(function (m) { var v = m.val(e, ind(e)); return finito(v) ? v : null; });
        var notas = brutos.map(function (v, k) {
          if (v == null) return null;
          return conjunto === "fund" ? percentil(v, universos[k], eixos[k].sentido) : Math.max(0, Math.min(100, v));
        });
        return { tk: tk, e: e, cor: CORES[j], brutos: brutos, notas: notas };
      });
    }

    // ------------------------------------------------------------ gráfico
    function desenhar() {
      var w = Math.max(280, el.clientWidth);
      var estreito = w < 560;
      var margemX = estreito ? 62 : 120, margemY = estreito ? 40 : 46;
      var r = Math.max(70, Math.min((w - 2 * margemX) / 2, 220));
      var h = Math.round(2 * r + 2 * margemY), cx = w / 2, cy = h / 2, n = eixos.length;
      var ang = function (k) { return -Math.PI / 2 + 2 * Math.PI * k / n; };
      var ponto = function (k, nota) { return [cx + r * nota / 100 * Math.cos(ang(k)), cy + r * nota / 100 * Math.sin(ang(k))]; };
      var poligono = function (notas) { return notas.map(function (v, k) { var p = ponto(k, v || 0); return p[0].toFixed(1) + "," + p[1].toFixed(1); }).join(" "); };
      geo = { cx: cx, cy: cy, r: r, n: n, w: w, h: h };

      var svg = '<svg viewBox="0 0 ' + w + " " + h + '" height="' + h + '" role="img" aria-label="' +
        esc(L("Gráfico de teia comparando ", "Radar chart comparing ") + escolhidas.join(", ")) + '">';
      [25, 50, 75, 100].forEach(function (a) {
        svg += '<polygon class="anel' + (a === 100 ? " externo" : "") + '" points="' + poligono(eixos.map(function () { return a; })) + '"/>';
      });
      eixos.forEach(function (m, k) {
        var p = ponto(k, 100);
        svg += '<line class="raio" data-k="' + k + '" x1="' + cx + '" y1="' + cy + '" x2="' + p[0].toFixed(1) + '" y2="' + p[1].toFixed(1) + '"/>';
      });
      // escala do anel, ao longo do primeiro eixo
      [50, 100].forEach(function (a) {
        var p = ponto(0, a);
        svg += '<text class="marca-anel" x="' + (p[0] + 5) + '" y="' + (p[1] + 11) + '">' + a + "</text>";
      });
      // mediana do mercado
      var notasMed = conjunto === "fund" ? eixos.map(function () { return 50; }) : medianas;
      svg += '<polygon class="mediana" points="' + poligono(notasMed) + '"/>';
      // empresas
      dados.forEach(function (d) {
        svg += '<polygon class="serie" points="' + poligono(d.notas) + '" fill="' + d.cor + '" stroke="' + d.cor + '"/>';
      });
      dados.forEach(function (d) {
        d.notas.forEach(function (v, k) {
          var p = ponto(k, v || 0);
          svg += v == null ? "" : '<circle cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '" r="3.4" fill="' + d.cor + '"/>';
        });
      });
      // rótulos dos eixos
      eixos.forEach(function (m, k) {
        var a = ang(k), c = Math.cos(a), s = Math.sin(a);
        var x = cx + (r + 12) * c, y = cy + (r + 12) * s;
        var ancora = c > 0.3 ? "start" : c < -0.3 ? "end" : "middle";
        var linhas = linhasRotulo(m.rot, estreito);
        var alt = 15;
        var y0 = s < -0.3 ? y - (linhas.length - 1) * alt - 2 : s > 0.3 ? y + 11 : y + 4 - (linhas.length - 1) * alt / 2;
        svg += '<text class="rot" data-k="' + k + '" text-anchor="' + ancora + '" x="' + x.toFixed(1) + '" y="' + y0.toFixed(1) + '">' +
          linhas.map(function (l, j) { return '<tspan x="' + x.toFixed(1) + '" dy="' + (j ? alt : 0) + '">' + esc(l) + "</tspan>"; }).join("") + "</text>";
      });
      svg += "</svg>";
      el.innerHTML = svg;
      marcarAtivo();
    }

    function marcarAtivo() {
      Array.prototype.forEach.call(el.querySelectorAll("[data-k]"), function (n) {
        n.classList.toggle("ativo", +n.getAttribute("data-k") === ativo);
      });
    }

    function eixoEm(ev) {
      var svg = el.querySelector("svg");
      if (!svg || !geo) return -1;
      var rect = svg.getBoundingClientRect(), k = geo.w / rect.width;
      var x = (ev.clientX - rect.left) * k - geo.cx, y = (ev.clientY - rect.top) * k - geo.cy;
      if (Math.hypot(x, y) < geo.r * 0.12) return -1;
      var a = Math.atan2(y, x) + Math.PI / 2;
      return ((Math.round(a / (2 * Math.PI / geo.n)) % geo.n) + geo.n) % geo.n;
    }

    function mostrarDica(k, ev) {
      if (k < 0) { dica.hidden = true; return; }
      var m = eixos[k];
      var html = "<b>" + esc(m.rot) + "</b>" + dados.map(function (d) {
        var v = d.brutos[k];
        var txt = v == null ? "–" : m.fmt(v) + (conjunto === "fund" ? " · p" + d.notas[k] : "");
        return '<div><span><i style="--c:' + d.cor + '"></i>' + esc(d.tk) + '</span><span class="num">' + txt + "</span></div>";
      }).join("");
      if (medianas[k] != null) html += '<div><span class="mudo">' + esc(L("Mediana do mercado", "Market median")) + '</span><span class="num">' + m.fmt(medianas[k]) + "</span></div>";
      if (m.sentido < 0) html += '<div class="mudo">' + esc(L("Menor é melhor: fica mais para fora", "Lower is better: plotted further out")) + "</div>";
      dica.innerHTML = html;
      dica.hidden = false;
      var dx = ev.clientX + 14;
      if (dx + dica.offsetWidth > window.innerWidth - 8) dx = ev.clientX - dica.offsetWidth - 14;
      dica.style.left = Math.max(8, dx) + "px";
      dica.style.top = Math.max(8, ev.clientY - dica.offsetHeight - 12) + "px";
    }

    function aoMover(ev) {
      var k = eixoEm(ev);
      if (k !== ativo) { ativo = k; marcarAtivo(); }
      mostrarDica(k, ev);
    }
    function aoSair() { ativo = -1; marcarAtivo(); dica.hidden = true; }
    el.addEventListener("pointermove", aoMover);
    el.addEventListener("pointerdown", aoMover);
    el.addEventListener("pointerleave", function (ev) { if (ev.pointerType === "mouse") aoSair(); });

    // ------------------------------------------------------------ legenda, tabela e aviso
    function legenda() {
      app.querySelector("#t-legenda").innerHTML = '<div class="legenda">' + dados.map(function (d) {
        return '<span><i style="--c:' + d.cor + '"></i>' + esc(d.tk) + " · " + esc(X.nomeCurto(d.e.nome)) + "</span>";
      }).join("") + '<span><i class="tracejada"></i>' + esc(L("Mediana das ações líquidas", "Median of liquid stocks")) + "</span></div>";
    }

    function tabela() {
      var cab = "<thead><tr><th>" + esc(L("Indicador", "Metric")) + "</th>" + dados.map(function (d) {
        return '<th><span class="teia-th"><i style="--c:' + d.cor + '"></i>' + esc(d.tk) + "</span></th>";
      }).join("") + "<th>" + esc(L("Mediana", "Median")) + "</th></tr></thead>";
      var corpo = eixos.map(function (m, k) {
        return "<tr><td>" + esc(m.rot) + (m.sentido < 0 ? ' <span class="mudo">↓</span>' : "") + "</td>" + dados.map(function (d) {
          var v = d.brutos[k];
          if (v == null) return '<td class="num mudo">–</td>';
          var p = d.notas[k], fundo = "";
          if (p != null) {
            var forca = Math.round(Math.abs(p - 50) / 50 * 26);  // até 26% de cor nos extremos
            fundo = ' style="background:color-mix(in srgb, var(' + (p >= 50 ? "--pos" : "--neg") + ") " + forca + '%, transparent)"';
          }
          return '<td class="num"' + fundo + ">" + m.fmt(v) + (conjunto === "fund" ? '<small class="mudo"> p' + p + "</small>" : "") + "</td>";
        }).join("") + '<td class="num mudo">' + (medianas[k] == null ? "–" : m.fmt(medianas[k])) + "</td></tr>";
      }).join("");
      app.querySelector("#t-tabela").innerHTML = "<table>" + cab + "<tbody>" + corpo + "</tbody></table>";
    }

    function aviso() {
      var txt = conjunto === "fund"
        ? L("Fundamentos em percentil entre as " + liquidas.length + " ações com liquidez de pelo menos R$ 1 mi/dia: p80 quer dizer melhor que 80% delas. Múltiplos, ROE, margem e dívida dos últimos 12 meses quando há ITR; crescimento da receita em 5 anos. ↓ = menor é melhor. Sem dado num eixo (P/L de quem teve prejuízo, dívida de bancos), o ponto vai ao centro.",
            "Fundamentals as percentiles among the " + liquidas.length + " stocks trading at least R$ 1M/day: p80 means better than 80% of them. Multiples, ROE, margin and debt are trailing 12 months when quarterly filings exist; revenue growth over 5 years. ↓ = lower is better. With no value on a spoke (P/E of a loss-maker, bank debt) the point sits at the centre.")
        : L("Os cinco componentes do índice de previsibilidade, de 0 a 100, sobre os últimos 10 exercícios. Empresas com menos de 5 anos de balanço não têm nota.",
            "The five components of the predictability score, 0 to 100, over the last 10 fiscal years. Companies with fewer than 5 years of filings have no score.");
      app.querySelector("#t-aviso").textContent = txt;
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
        X.linhas(cresc, anos.slice(base), dados.map(function (d, j) {
          return { nome: d.tk, cor: d.cor, v: recs[j].slice(base).map(function (v) { return v > 0 ? v / recs[j][base] * 100 : null; }) };
        }), function (v) { return v == null ? "–" : X.nf(0).format(v); }, { eixo: function (v) { return X.nf(0).format(v); }, limites: null });
        app.querySelector("#t-cresc-nota").textContent = L("Receita de " + anos[base] + " = 100", "Revenue in " + anos[base] + " = 100") +
          (X.estado.moeda === "usd" ? L(", em US$", ", in US$") : L(", em R$", ", in R$")) + ".";
      }
      X.linhas(app.querySelector("#t-margem"), anos, dados.map(function (d) {
        var r = porAno(d, "receita"), l = porAno(d, "lucro_liquido");
        return { nome: d.tk, cor: d.cor, v: r.map(function (v, k) { return v > 0 && l[k] != null ? l[k] / v : null; }) };
      }), function (v) { return X.pct(v, 1); });
    }

    /** 5. Tamanho e liquidez: barras na mesma escala dentro de cada indicador */
    function tamanho() {
      var ms = [
        { rot: L("Valor de mercado", "Market cap"), val: function (e) { return hojeR(e.valor_mercado); } },
        { rot: L("Receita (12 meses)", "Revenue (TTM)"), val: function (e) { var t = e.ttm; var v = t && t.receita != null ? t.receita : e.series.receita[e.series.receita.length - 1]; return hojeR(v); } },
        { rot: L("Volume negociado por dia", "Daily traded volume"), val: function (e) { return e.liquidez == null ? null : hojeR(e.liquidez / 1000); } },
      ];
      app.querySelector("#t-tamanho").innerHTML = ms.map(function (m) {
        var vs = dados.map(function (d) { return m.val(d.e); });
        var max = Math.max.apply(null, vs.filter(finito).concat([1]));
        return '<div class="tam-bloco"><h3>' + esc(m.rot) + "</h3>" + dados.map(function (d, j) {
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
      app.querySelectorAll("[data-conjunto]").forEach(function (b) { b.setAttribute("aria-pressed", String(b.getAttribute("data-conjunto") === conjunto)); });
    }

    function atualizar() {
      history.replaceState(null, "", "#/teia/" + escolhidas.join(","));
      calcular(); chips(); desenhar(); legenda(); tabela(); aviso(); maisGraficos();
    }

    app.querySelector("#t-escolhidas").addEventListener("click", function (ev) {
      var b = ev.target.closest("[data-tirar]");
      if (!b) return;
      escolhidas = escolhidas.filter(function (tk) { return tk !== b.getAttribute("data-tirar"); });
      atualizar();
    });
    app.querySelectorAll("[data-conjunto]").forEach(function (b) {
      b.addEventListener("click", function () { conjunto = b.getAttribute("data-conjunto"); ativo = -1; atualizar(); });
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
    var largura = 0;
    var obs = new ResizeObserver(function () {
      if (el.clientWidth && el.clientWidth !== largura) { largura = el.clientWidth; desenhar(); maisGraficos(); }
    });
    obs.observe(el);

    atualizar();
    largura = el.clientWidth;

    atual = { parar: function () { obs.disconnect(); dica.hidden = true; } };
  }

  window.RealTermsTeia = { render: render, parar: parar };
  // app.js roda primeiro; se a página aberta é a teia, desenha agora
  if (document.body.getAttribute("data-pagina") === "teia") render(document.getElementById("app"));
})();
