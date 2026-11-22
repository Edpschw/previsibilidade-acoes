/* Real Terms — página de entrada (#/ e #/curso/N): um curso do básico ao avançado, em telas.
 *
 * Linguagem visual de "experiência em slides": palco escuro com grade fina, partículas de traços,
 * título que se decodifica letra a letra, contador, setas circulares e menu com todas as aulas.
 * Cada aula explica um conceito e mostra "na prática" com uma empresa de verdade da base, que o
 * usuário escolhe (seletor "Exemplo"). Todos os números vêm de window.RealTerms (app.js).
 * Navegação: setas, teclado (← →), deslizar no celular e endereço #/curso/7. */
(function () {
  "use strict";

  var X, L, esc;
  var CHAVE_EMPRESA = "rt-curso-empresa", CHAVE_VISTAS = "rt-curso-vistas";
  var GLIFOS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789/%$#";
  var NIVEIS = [
    ["Introdução", "Introduction"],
    ["Nível 1 · O básico", "Level 1 · The basics"],
    ["Nível 2 · Ler a empresa", "Level 2 · Reading a company"],
    ["Nível 3 · Avançado", "Level 3 · Advanced"],
  ];

  function ler(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function guardar(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* navegação privada */ } }
  function reduzMovimento() { return window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches; }
  function finito(v) { return v != null && isFinite(v); }
  function T(par) { return L(par[0], par[1]); }
  function mediana(arr) {
    var a = arr.filter(finito).sort(function (x, y) { return x - y; });
    if (!a.length) return null;
    var m = a.length >> 1;
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  }
  function ultimoIdx(arr) { for (var k = (arr || []).length - 1; k >= 0; k--) if (finito(arr[k])) return k; return -1; }
  function simbolo() { return X.estado.moeda === "usd" ? "US$" : "R$"; }
  function hojeMoeda(v) { return v == null || X.estado.moeda === "brl" ? v : v / X.D.ptax_atual.valor; }

  // ---------------------------------------------------------------- contexto da empresa de exemplo

  var cacheMercado = {};
  /** medianas das empresas visíveis (com o filtro de setor do topo), na moeda da tela */
  function mercado() {
    var base = X.visiveis(), chave = X.estado.moeda + "|" + base.length + "|" + (base[0] && base[0].ticker);
    if (cacheMercado[chave]) return cacheMercado[chave];
    var info = base.filter(function (e) { return Object.keys(e.cotacao).length; })
      .map(function (e) { return { e: e, i: X.indicadores(e) }; });
    var col = function (f) { return info.map(function (x) { return f(x.i, x.e); }); };
    var m = {
      n: info.length, info: info,
      pl: mediana(col(function (i) { return i.pl > 0 ? i.pl : null; })),
      pvp: mediana(col(function (i) { return i.pvp > 0 ? i.pvp : null; })),
      ev: mediana(col(function (i) { return i.evEbitda > 0 ? i.evEbitda : null; })),
      dy: mediana(col(function (i) { return i.dy; })),
      roe: mediana(col(function (i) { return i.d12 ? i.roe12 : i.roe; })),
      mliq: mediana(col(function (i) { return i.d12 ? i.mLiq12 : i.mLiq; })),
      dl: mediana(col(function (i) { return i.d12 ? i.dlEbitda12 : i.dlEbitda; })),
    };
    return (cacheMercado[chave] = m);
  }

  function contexto(e) {
    var i = X.indicadores(e), s = function (k) { return X.serie(e, k) || []; };
    var k = ultimoIdx(s("receita"));
    var b3 = e.acoes_b3, cvm = e.acoes_cvm;
    var circ = b3 && b3.on + b3.pn > 0 ? b3.on + b3.pn
      : cvm ? cvm.on + cvm.pn - cvm.tesouraria_on - cvm.tesouraria_pn : e.series.acoes[e.series.acoes.length - 1];
    var cot = X.cotacaoDe(e, e.ticker);
    return {
      e: e, i: i, s: s, k: k, ano: e.anos[k], anos: e.anos, tk: e.ticker, nm: X.nomeCurto(e.nome),
      circ: circ, preco: cot ? hojeMoeda(cot.preco) : null, pa: X.porAcaoAnual(e), m: mercado(),
      no: function (chave) { var v = s(chave); return k >= 0 ? v[k] : null; },
    };
  }

  // ---------------------------------------------------------------- desenhos (SVG em traço)

  var VB = 'viewBox="0 0 420 270"';
  function figura(corpo, rot) { return '<svg class="c-vis" ' + VB + ' role="img" aria-label="' + esc(rot) + '">' + corpo + "</svg>"; }
  function atraso(s) { return ' style="--atraso:' + s.toFixed(2) + 's"'; }
  function txt(x, y, t, cls, anchor) {
    return '<text x="' + x + '" y="' + y + '"' + (anchor ? ' text-anchor="' + anchor + '"' : "") + ' class="' + (cls || "") + '">' + esc(t) + "</text>";
  }
  function traco(d, cls, s) { return '<path pathLength="1" d="' + d + '" class="d ' + (cls || "") + '"' + atraso(s || 0) + "/>"; }
  function caixa(x, y, w, h, cls, s) { return '<rect pathLength="1" x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" class="d ' + (cls || "") + '"' + atraso(s || 0) + "/>"; }
  function barraH(x, y, w, h, cls, s) {
    return '<rect x="' + x + '" y="' + y + '" width="' + Math.max(1, w) + '" height="' + h + '" rx="2" class="b ' + (cls || "") + '"' + atraso(s || 0) + "/>";
  }
  function barraV(x, y, w, h, cls, s) {
    return '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + Math.max(1, h) + '" rx="2" class="bv ' + (cls || "") + '"' + atraso(s || 0) + "/>";
  }

  /** barras horizontais com rótulo e valor: itens [{rot, v, fmt, cls}] */
  function barras(itens, rot) {
    var max = Math.max.apply(null, itens.map(function (x) { return finito(x.v) ? Math.abs(x.v) : 0; }).concat([1e-9]));
    var h = Math.min(34, 220 / itens.length - 10), y0 = (270 - itens.length * (h + 14)) / 2 + 6;
    var corpo = traco("M150 " + (y0 - 8) + " V" + (y0 + itens.length * (h + 14) - 6), "eixo", 0);
    itens.forEach(function (x, j) {
      var y = y0 + j * (h + 14), w = finito(x.v) ? Math.abs(x.v) / max * 250 : 0;
      corpo += txt(142, y + h / 2 + 4, x.rot, "rot", "end") +
        barraH(150, y, w, h, (x.cls || "") + (x.v < 0 ? " neg" : ""), 0.15 + j * 0.12) +
        txt(150 + w + 6 > 360 ? 150 + w - 6 : 150 + w + 6, y + h / 2 + 4, x.fmt, "val" + (150 + w + 6 > 360 ? " dentro" : ""), 150 + w + 6 > 360 ? "end" : null);
    });
    return figura(corpo, rot);
  }

  /** linhas em escala comum: series [{v:[], cls, rot}], rotulos = anos */
  function linhasSvg(anos, series, rot, opts) {
    opts = opts || {};
    var todos = [].concat.apply([], series.map(function (s) { return s.v; })).filter(finito);
    if (todos.length < 2) return figura(txt(210, 140, L("Sem histórico suficiente", "Not enough history"), "rot", "middle"), rot);
    var lo = opts.min != null ? Math.min(opts.min, Math.min.apply(null, todos)) : Math.min.apply(null, todos);
    var hi = Math.max.apply(null, todos);
    if (hi - lo < 1e-9) { hi += 1; lo -= 1; }
    var x = function (k) { return 54 + k * (336 / Math.max(1, anos.length - 1)); };
    var y = function (v) { return 220 - (v - lo) / (hi - lo) * 180; };
    var corpo = traco("M54 220 H390", "eixo", 0);
    if (lo < 0 && hi > 0) corpo += traco("M54 " + y(0).toFixed(1) + " H390", "eixo zero", 0);
    if (opts.fmt) corpo += traco("M54 40 H390", "eixo", 0) + txt(48, 44, opts.fmt(hi), "num", "end") + txt(48, 224, opts.fmt(lo), "num", "end");
    series.forEach(function (s, j) {
      var d = "", aberto = false;
      s.v.forEach(function (v, k) {
        if (!finito(v)) { aberto = false; return; }
        d += (aberto ? "L" : "M") + x(k).toFixed(1) + " " + y(v).toFixed(1);
        aberto = true;
      });
      corpo += traco(d, "linha " + (s.cls || ""), 0.1 + j * 0.25);
      var u = ultimoIdx(s.v);
      if (u >= 0) corpo += '<circle cx="' + x(u) + '" cy="' + y(s.v[u]) + '" r="3.5" class="ponto ' + (s.cls || "") + '"' + atraso(0.9 + j * 0.25) + "/>";
    });
    corpo += txt(54, 244, String(anos[0]), "rot") + txt(390, 244, String(anos[anos.length - 1]), "rot", "end");
    var leg = series.map(function (s, j) {
      return '<g class="leg"' + atraso(0.6 + j * 0.2) + '><rect x="' + (30 + j * 150) + '" y="256" width="12" height="3" class="sw ' + (s.cls || "") + '"/>' + txt(48 + j * 150, 261, s.rot, "rot") + "</g>";
    }).join("");
    return figura(corpo + leg, rot);
  }

  // ---------------------------------------------------------------- formatos

  function din(v) { return v == null ? "–" : X.dinheiro(v); }
  function pct(v, c) { return v == null ? "–" : X.pct(v, c == null ? 1 : c); }
  function vz(v) { return v == null ? "–" : X.vezes(v); }
  function b(t) { return "<b>" + esc(t) + "</b>"; }
  function por100(v) { return simbolo() + " " + X.nf(0).format(Math.round(v * 100)); }

  // ---------------------------------------------------------------- as aulas

  var AULAS = [
    // ------------------------------------------------------------ 0 · capa
    {
      nivel: 0, palavra: ["APRENDA", "LEARN"],
      pergunta: ["Do básico ao avançado, com dados de verdade", "From the basics to advanced, with real data"],
      lead: ["Dezoito aulas curtas para entender o que é uma ação, como se lê o balanço de uma empresa e o que verificar antes de investir. Cada aula mostra o conceito com os números reais de uma empresa da bolsa, a que você escolher no seletor <i>Exemplo</i>.",
        "Eighteen short lessons on what a share is, how to read a company's financial statements and what to check before investing. Each lesson shows the idea with the real numbers of a listed company, whichever you pick in the <i>Example</i> selector."],
      pontos: [
        ["<b class=\"c-n\">01–05</b> O básico: empresa, ação, bolsa, preço e dividendos.", "<b class=\"c-n\">01–05</b> The basics: company, share, exchange, price and dividends."],
        ["<b class=\"c-n\">06–12</b> Ler a empresa: balanço, resultado, caixa, múltiplos, retorno e dívida.", "<b class=\"c-n\">06–12</b> Reading a company: statements, earnings, cash, multiples, returns and debt."],
        ["<b class=\"c-n\">13–18</b> Avançado: diluição, ciclos, câmbio, governança, valor e um método.", "<b class=\"c-n\">13–18</b> Advanced: dilution, cycles, currency, governance, value and a method."],
      ],
      atencao: ["Avance com as setas, com ← → do teclado ou deslizando no celular. O menu Aulas leva a qualquer uma.", "Move on with the arrows, the ← → keys or by swiping on a phone. The Lessons menu jumps to any of them."],
      pratica: function (c) {
        var base = X.visiveis(), anoIni = Math.min.apply(null, base.map(function (e) { return e.anos[0]; }));
        var vm = base.reduce(function (s, e) { return s + (e.valor_mercado || 0); }, 0);
        return L("O Real Terms reúne " + b(base.length + " empresas") + " da B3 com balanços de " + anoIni + " a " + X.D.ano_final +
          ", que juntas valem " + b(din(hojeMoeda(vm))) + ". O exemplo das aulas é " + b(c.nm) + "; troque quando quiser.",
          "Real Terms covers " + b(base.length + " companies") + " on B3 with statements from " + anoIni + " to " + X.D.ano_final +
          ", worth " + b(din(hojeMoeda(vm))) + " together. The lessons' example is " + b(c.nm) + "; switch it any time.");
      },
      visual: function () {
        var corpo = "";
        [[40, 170, L("Básico", "Basics")], [160, 120, L("Ler a empresa", "Reading")], [280, 66, L("Avançado", "Advanced")]].forEach(function (d, j) {
          corpo += caixa(d[0], d[1], 100, 220 - d[1], j === 2 ? "ac" : "", 0.1 + j * 0.3) +
            txt(d[0] + 50, d[1] - 10, d[2], "rot" + (j === 2 ? " ac" : ""), "middle") +
            txt(d[0] + 12, d[1] + 24, "0" + (j + 1), "num");
        });
        corpo += traco("M20 220 H400", "eixo", 0) + traco("M90 150 L210 100 L330 46", "linha ac", 1.0);
        return figura(corpo, L("Três níveis do curso", "Three course levels"));
      },
      link: function () { return ["#/curso/1", L("Começar pela aula 1", "Start with lesson 1")]; },
    },

    // ------------------------------------------------------------ nível 1
    {
      nivel: 1, palavra: ["EMPRESA", "COMPANY"],
      pergunta: ["O que é uma empresa?", "What is a company?"],
      lead: ["Uma empresa junta dinheiro, pessoas e ativos para vender produtos ou serviços. Tudo o que ela vende no ano é a <b>Receita</b>. O que sobra depois de pagar custos, salários, juros e impostos é o <b>Lucro líquido</b>, e ele pertence aos donos.",
        "A company brings money, people and assets together to sell goods or services. Everything it sells in a year is its <b>Revenue</b>. What's left after costs, wages, interest and taxes is <b>Net income</b>, and it belongs to the owners."],
      pontos: [
        ["Receita: quanto entrou com as vendas no ano.", "Revenue: what came in from sales during the year."],
        ["Custos e despesas: matéria-prima, salários, aluguel, juros e impostos.", "Costs and expenses: materials, wages, rent, interest and taxes."],
        ["Lucro: o que sobra. Dele saem os dividendos e o dinheiro para crescer.", "Profit: what remains. Dividends and money to grow come out of it."],
      ],
      atencao: ["Receita grande não garante lucro. Olhe sempre quanto sobra de cada real vendido: a margem.", "Big revenue doesn't guarantee profit. Always check how much is left from each unit sold: the margin."],
      pratica: function (c) {
        var r = c.no("receita"), l = c.no("lucro_liquido");
        if (!finito(r)) return L("Sem receita informada para " + c.nm + ".", "No revenue reported for " + c.nm + ".");
        return L("Em " + c.ano + ", " + b(c.nm) + " vendeu " + b(din(r)) + " e terminou o ano com " + b(din(l)) + " de lucro. De cada " + simbolo() + " 100 vendidos, sobraram " + b(por100(l / r)) + ".",
          "In " + c.ano + ", " + b(c.nm) + " sold " + b(din(r)) + " and ended the year with " + b(din(l)) + " in profit. Out of every " + simbolo() + " 100 of sales, " + b(por100(l / r)) + " was left.");
      },
      visual: function (c) {
        var r = c.no("receita"), l = c.no("lucro_liquido");
        return barras([
          { rot: L("Receita", "Revenue"), v: r, fmt: din(r) },
          { rot: L("Custos e despesas", "Costs & expenses"), v: finito(r) && finito(l) ? r - l : null, fmt: finito(r) && finito(l) ? din(r - l) : "–", cls: "mudo" },
          { rot: L("Lucro", "Profit"), v: l, fmt: din(l), cls: "ac" },
        ], L("Receita, custos e lucro", "Revenue, costs and profit"));
      },
      link: function (c) { return ["#/" + c.tk, L("Ver " + c.tk + " por dentro", "Open " + c.tk)]; },
    },
    {
      nivel: 1, palavra: ["AÇÃO", "SHARE"],
      pergunta: ["O que é uma ação?", "What is a share?"],
      lead: ["Para crescer, a empresa divide seu capital em pedaços iguais e vende parte deles na bolsa. Cada pedaço é uma ação. Quem compra vira sócio: tem direito a uma fatia do lucro e, nas ações ordinárias, a voto.",
        "To grow, a company splits its capital into equal pieces and sells some of them on the exchange. Each piece is a share. Buyers become partners: they're entitled to a slice of profits and, with common shares, a vote."],
      pontos: [
        ["<b>Ordinárias (ON)</b> votam; <b>Preferenciais (PN)</b> têm prioridade nos dividendos.", "<b>Common (ON)</b> shares vote; <b>Preferred (PN)</b> shares come first for dividends."],
        ["<b>Valor de mercado</b> = número de ações × cotação: o preço da empresa inteira.", "<b>Market cap</b> = number of shares × price: the price of the whole company."],
        ["O preço de uma ação, sozinho, não diz nada: importa quanto da empresa vem com ela.", "A share price alone says nothing: what matters is how much of the company comes with it."],
      ],
      atencao: ["Uma ação de R$ 5 pode ser mais cara que uma de R$ 50. Compare o preço com o lucro por ação, não com o preço de outras ações.", "A R$ 5 share can be pricier than a R$ 50 one. Compare the price with earnings per share, not with other share prices."],
      pratica: function (c) {
        return L(b(c.nm) + " está dividida em " + b(X.qtd(c.circ) + " ações") + " em circulação. Cada uma custa " + b(c.preco ? X.porAcao(c.preco) : "–") + " na bolsa; a empresa inteira, " + b(din(c.i.vm)) + ".",
          b(c.nm) + " is split into " + b(X.qtd(c.circ) + " shares") + " outstanding. Each costs " + b(c.preco ? X.porAcao(c.preco) : "–") + " on the exchange; the whole company, " + b(din(c.i.vm)) + ".");
      },
      visual: function (c) {
        var corpo = "", lado = 15, gap = 4, cols = 18, lin = 10, x0 = (420 - cols * (lado + gap)) / 2, y0 = 18;
        for (var r = 0; r < lin; r++) for (var k = 0; k < cols; k++) {
          var um = r === 4 && k === 11;
          corpo += '<rect x="' + (x0 + k * (lado + gap)) + '" y="' + (y0 + r * (lado + gap)) + '" width="' + lado + '" height="' + lado + '" rx="2" class="q' + (um ? " ac" : "") + '"' + atraso(0.02 * (r + k)) + "/>";
        }
        corpo += traco("M" + (x0 + 11 * (lado + gap) + lado / 2) + " " + (y0 + 4 * (lado + gap) + lado) + " V232", "linha ac", 0.9) +
          txt(x0 + 11 * (lado + gap) + lado / 2, 250, L("1 ação = 1 fatia de " + X.qtd(c.circ), "1 share = 1 slice of " + X.qtd(c.circ)), "rot ac", "middle");
        return figura(corpo, L("A empresa dividida em ações", "The company split into shares"));
      },
      link: function () { return ["#/acoes", L("Ver todas as empresas", "See every company")]; },
    },
    {
      nivel: 1, palavra: ["BOLSA", "EXCHANGE"],
      pergunta: ["Onde as ações são negociadas?", "Where are shares traded?"],
      lead: ["No Brasil, na B3, a bolsa de São Paulo. Cada ação tem um código, o ticker: quatro letras da empresa e um número da classe. Compradores e vendedores deixam ofertas num livro; o negócio sai quando os preços se encontram.",
        "In Brazil, on B3, the São Paulo exchange. Each share has a code, the ticker: four letters for the company and a number for the class. Buyers and sellers post offers in a book; a trade happens when prices meet."],
      pontos: [
        ["Final 3 = ON; 4, 5 ou 6 = PN; 11 = unit, um pacote de ON e PN.", "Ending 3 = common; 4, 5 or 6 = preferred; 11 = unit, a bundle of both."],
        ["<b>Liquidez</b>: quanto se negocia por dia. Com pouca, vender sem derrubar o preço é difícil.", "<b>Liquidity</b>: how much trades per day. With little of it, selling without pushing the price down is hard."],
        ["Investidor estrangeiro compra pela própria B3 ou por <b>ADR</b>, nos Estados Unidos.", "Foreign investors buy on B3 itself or through <b>ADR</b>s in the United States."],
      ],
      atencao: ["Tickers parecidos não são a mesma classe: confira o número final antes de comprar.", "Similar tickers aren't the same class: check the final number before buying."],
      pratica: function (c) {
        return L("Os códigos de " + b(c.nm) + " são " + b(c.e.tickers.join(", ")) + ". Nos últimos 21 pregões, negociou em média " + b(din(hojeMoeda(c.e.liquidez / 1000))) + " por dia. O Real Terms só mostra empresas com pelo menos R$ 1 milhão por dia.",
          b(c.nm) + "'s tickers are " + b(c.e.tickers.join(", ")) + ". Over the last 21 sessions it traded " + b(din(hojeMoeda(c.e.liquidez / 1000))) + " a day on average. Real Terms only shows companies trading at least R$ 1 million a day.");
      },
      visual: function (c) {
        var corpo = traco("M210 22 V238", "eixo", 0), p = c.preco || 10;
        for (var k = 0; k < 5; k++) {
          var wc = 40 + 110 * Math.pow(0.78, k) * (0.7 + 0.3 * ((k * 37) % 5) / 4), wv = 40 + 110 * Math.pow(0.8, k) * (0.6 + 0.4 * ((k * 53) % 5) / 4);
          corpo += barraH(220, 104 - k * 19, wv, 13, "neg", 0.1 + k * 0.08) + txt(226 + wv, 114 - k * 19, X.nf(2).format(p * (1 + 0.002 * (k + 1))), "num");
          corpo += barraH(200 - wc, 148 + k * 19, wc, 13, "ac inv", 0.1 + k * 0.08) + txt(194 - wc, 158 + k * 19, X.nf(2).format(p * (1 - 0.002 * (k + 1))), "num", "end");
        }
        corpo += txt(400, 16, L("ofertas de venda", "asks"), "rot neg", "end") + txt(20, 262, L("ofertas de compra", "bids"), "rot ac") +
          traco("M150 131 H270", "linha c1", 0.6) + txt(278, 135, L("último negócio ", "last trade ") + (c.preco ? X.porAcao(c.preco) : "–"), "rot c1");
        return figura(corpo, L("Livro de ofertas", "Order book"));
      },
      link: function (c) { return ["#/" + c.tk, L("Ver liquidez e cotação de " + c.tk, "See " + c.tk + " liquidity and price")]; },
    },
    {
      nivel: 1, palavra: ["PREÇO", "PRICE"],
      pergunta: ["O que move o preço de uma ação?", "What moves a share price?"],
      lead: ["No dia a dia, o preço sobe e desce com oferta e procura, notícias, juros e o humor do mercado. Em prazos longos, ele tende a acompanhar o lucro por ação: quem compra uma ação compra uma fatia dos lucros futuros.",
        "Day to day, prices move with supply and demand, news, interest rates and market mood. Over long periods they tend to follow earnings per share: buying a share means buying a slice of future profits."],
      pontos: [
        ["<b>LPA</b> = lucro ÷ número de ações: o lucro de cada ação.", "<b>EPS</b> = profit ÷ number of shares: each share's profit."],
        ["Preço ÷ LPA = <b>P/L</b>: quantos anos de lucro o preço representa.", "Price ÷ EPS = <b>P/E</b>: how many years of profit the price represents."],
        ["Juros altos pesam no preço: a renda fixa vira concorrente.", "High interest rates weigh on prices: fixed income becomes a competitor."],
      ],
      atencao: ["Num ano, preço e lucro se descolam; em dez, costumam andar juntos. Preço que sobe sem lucro vive só de expectativa.", "In one year, price and profit drift apart; over ten, they usually move together. A price rising without profit lives on expectations alone."],
      _series: function (c) {
        var px = X.precosAno(c.e, c.tk), anos = c.anos, ini = Math.max(0, anos.length - 12);
        var lpa = c.pa.lpa, fat = c.pa.fatores;
        var p = anos.map(function (a, k) { return px && finito(px[k]) && finito(fat[k]) ? px[k] / fat[k] : null; });
        var a0 = -1;
        for (var k = ini; k < anos.length; k++) if (finito(p[k]) && p[k] > 0 && finito(lpa[k]) && lpa[k] > 0) { a0 = k; break; }
        return { anos: anos, p: p, lpa: lpa, a0: a0 };
      },
      pratica: function (c) {
        var d = this._series(c), u = ultimoIdx(d.p);
        if (d.a0 < 0 || u <= d.a0 || !finito(d.lpa[u])) return L("Sem cotações e lucros suficientes de " + c.nm + " para comparar.", "Not enough prices and earnings for " + c.nm + " to compare.");
        var vp = d.p[u] / d.p[d.a0] - 1, vl = d.lpa[u] / d.lpa[d.a0] - 1;
        return L("De " + d.anos[d.a0] + " a " + d.anos[u] + ", a cotação de " + b(c.tk) + " variou " + b((vp > 0 ? "+" : "") + pct(vp, 0)) + " e o lucro por ação, " + b((vl > 0 ? "+" : "") + pct(vl, 0)) + ".",
          "From " + d.anos[d.a0] + " to " + d.anos[u] + ", " + b(c.tk) + "'s price changed " + b((vp > 0 ? "+" : "") + pct(vp, 0)) + " and earnings per share " + b((vl > 0 ? "+" : "") + pct(vl, 0)) + ".");
      },
      visual: function (c) {
        var d = this._series(c);
        if (d.a0 < 0) return linhasSvg([0, 1], [], "");
        var anos = d.anos.slice(d.a0), ix = function (arr) { var b0 = arr[d.a0]; return arr.slice(d.a0).map(function (v) { return finito(v) ? Math.max(-100, Math.min(800, v / b0 * 100)) : null; }); };
        return linhasSvg(anos, [
          { v: ix(d.p), cls: "c1", rot: L("Cotação (base 100)", "Price (base 100)") },
          { v: ix(d.lpa), cls: "ac", rot: L("Lucro por ação (base 100)", "EPS (base 100)") },
        ], L("Cotação e lucro por ação", "Price and earnings per share"), { min: 0, fmt: function (v) { return X.nf(0).format(v); } });
      },
      link: function (c) { return ["#/" + c.tk, L("Histórico completo de " + c.tk, c.tk + " full history")]; },
    },
    {
      nivel: 1, palavra: ["DIVIDENDOS", "DIVIDENDS"],
      pergunta: ["Como o acionista recebe?", "How do shareholders get paid?"],
      lead: ["Parte do lucro volta ao acionista em dinheiro: dividendos e juros sobre capital próprio (<b>JCP</b>, com 15% de imposto retido). Recebe quem tem a ação no fim da <b>Data-com</b>; o dinheiro cai na data de pagamento.",
        "Part of the profit goes back to shareholders in cash: dividends and interest on equity (<b>Interest on equity</b>, with 15% tax withheld). Whoever holds the share at the end of the <b>Record date</b> gets paid; the cash arrives on the payment date."],
      pontos: [
        ["No dia seguinte à data-com, o preço costuma cair perto do valor que será pago.", "The day after the record date, the price usually drops by about the amount to be paid."],
        ["<b>Dividend yield</b> = proventos de 12 meses ÷ preço: o \"aluguel\" da ação.", "<b>Dividend yield</b> = 12 months of payouts ÷ price: the share's \"rent\"."],
        ["<b>Payout</b> = fatia do lucro distribuída. No Brasil, o mínimo legal é 25%.", "<b>Payout</b> = share of profit paid out. Brazil's legal minimum is 25%."],
      ],
      atencao: ["Yield acima de 15% quase sempre é pagamento pontual ou preço em queda. Olhe a regularidade, não um ano.", "A yield above 15% is almost always a one-off or a falling price. Look at consistency, not a single year."],
      _proximo: function (c) {
        var hoje = new Date().toISOString().slice(0, 10);
        return ((window.AGENDA && window.AGENDA.empresas[c.e.cnpj]) || []).filter(function (x) { return x.pag && x.pag >= hoje; })[0] || null;
      },
      pratica: function (c) {
        var p = this._proximo(c), tipo = p ? (p.tipo === "jcp" ? "JCP" : L("dividendo", "dividend")) : "";
        var v = p ? (X.estado.moeda === "usd" ? "US$ " + X.nf(4).format(p.valor / X.D.ptax_atual.valor) : "R$ " + X.nf(4).format(p.valor)) : "";
        return L("Nos últimos 12 meses, " + b(c.nm) + " pagou o equivalente a " + b(pct(c.i.dy)) + " do seu valor de mercado (mediana do site: " + pct(c.m.dy) + "). " +
          (p ? "Próximo pagamento: " + b(v + " por ação") + " de " + tipo + " em " + b(X.data(p.pag)) + ", para quem tinha a ação em " + X.data(p.com) + "." : "Não há pagamento aprovado ainda por vir."),
          "Over the last 12 months, " + b(c.nm) + " paid out the equivalent of " + b(pct(c.i.dy)) + " of its market cap (site median: " + pct(c.m.dy) + "). " +
          (p ? "Next payment: " + b(v + " per share") + " (" + tipo + ") on " + b(X.data(p.pag)) + ", for holders on " + X.data(p.com) + "." : "No approved payment is pending."));
      },
      visual: function (c) {
        var p = this._proximo(c), corpo = traco("M40 150 H380", "eixo", 0);
        var pts = [[80, L("data-com", "record"), p ? X.data(p.com) : ""], [190, L("data ex", "ex-date"), ""], [330, L("pagamento", "payment"), p ? X.data(p.pag) : ""]];
        pts.forEach(function (q, j) {
          corpo += '<circle cx="' + q[0] + '" cy="150" r="7" class="no' + (j === 2 ? " ac" : "") + '"' + atraso(0.2 + j * 0.3) + "/>" +
            txt(q[0], 182, q[1], "rot" + (j === 2 ? " ac" : ""), "middle") + (q[2] ? txt(q[0], 200, q[2], "num", "middle") : "");
        });
        corpo += traco("M40 46 H190 L190 70 H380", "linha c1", 0.3) + txt(44, 36, L("preço", "price"), "rot") + txt(196, 88, L("cai perto do valor pago", "drops by about the payout"), "rot") +
          traco("M330 140 V116 M322 124 L330 114 L338 124", "linha ac", 1.0) + txt(330, 106, L("dinheiro na conta", "cash in account"), "rot ac", "middle");
        return figura(corpo, L("Do anúncio ao pagamento", "From record date to payment"));
      },
      link: function () { return ["#/agenda", L("Abrir a agenda de proventos", "Open the dividend calendar")]; },
    },

    // ------------------------------------------------------------ nível 2
    {
      nivel: 2, palavra: ["BALANÇO", "FILINGS"],
      pergunta: ["De onde vêm os números?", "Where do the numbers come from?"],
      lead: ["Toda companhia aberta entrega seus números à CVM, o regulador: a DFP, anual e auditada, e o ITR, a cada trimestre. São três peças que se completam e que este site organiza para você.",
        "Every listed company files its numbers with the CVM, Brazil's regulator: the DFP, annual and audited, and the ITR, every quarter. Three statements that complete each other, organized here for you."],
      pontos: [
        ["Demonstração do resultado (DRE): o filme do ano. Receita, custos e lucro.", "Income statement: the film of the year. Revenue, costs and profit."],
        ["Balanço patrimonial: a foto de um dia. O que a empresa tem e o que deve.", "Balance sheet: a snapshot of one day. What the company owns and owes."],
        ["Fluxo de caixa: o dinheiro que de fato entrou e saiu.", "Cash flow statement: the money that actually came in and went out."],
      ],
      atencao: ["Compare sempre o mesmo período e a mesma base: consolidado (o grupo todo) com consolidado.", "Always compare the same period and the same basis: consolidated (the whole group) with consolidated."],
      pratica: function (c) {
        var ttm = c.e.ttm ? L(" e o trimestre até " + X.data(c.e.ttm.ate), " plus the quarter to " + X.data(c.e.ttm.ate)) : "";
        return L(b(c.nm) + " tem " + b(c.anos.length + " anos") + " de balanços nesta base (" + c.anos[0] + "–" + c.ano + ")" + ttm + ". " +
          (c.e.individual ? "Ela não tem controladas: usa a demonstração individual." : "Os valores são consolidados: o grupo inteiro, com as controladas."),
          b(c.nm) + " has " + b(c.anos.length + " years") + " of statements here (" + c.anos[0] + "–" + c.ano + ")" + ttm + ". " +
          (c.e.individual ? "It has no subsidiaries, so its parent-only statements are used." : "Figures are consolidated: the whole group, subsidiaries included."));
      },
      visual: function () {
        var corpo = "", nomes = [L("Resultado", "Income"), L("Balanço", "Balance"), L("Caixa", "Cash")];
        [20, 155, 290].forEach(function (x, j) {
          corpo += caixa(x, 40, 110, 180, j === 0 ? "ac" : "", 0.1 + j * 0.25) + txt(x + 55, 30, nomes[j], "rot" + (j === 0 ? " ac" : ""), "middle");
        });
        [150, 120, 95, 70].forEach(function (w, k) { corpo += barraH(32, 64 + k * 34, w * 0.58, 18, k === 3 ? "ac" : "mudo", 0.4 + k * 0.1); });
        corpo += barraV(170, 70, 36, 130, "mudo", 0.5) + barraV(224, 70, 36, 80, "neg", 0.6) + barraV(224, 152, 36, 48, "ac", 0.7);
        corpo += traco("M310 190 V110 M302 118 L310 108 L318 118", "linha ac", 0.8) + traco("M345 80 V160 M337 152 L345 162 L353 152", "linha neg", 0.9) +
          traco("M380 190 V140 M372 148 L380 138 L388 148", "linha c1", 1.0);
        return figura(corpo, L("As três demonstrações", "The three statements"));
      },
      link: function (c) { return ["#/" + c.tk, L("Demonstrações de " + c.tk, c.tk + " statements")]; },
    },
    {
      nivel: 2, palavra: ["RESULTADO", "EARNINGS"],
      pergunta: ["Do faturamento ao lucro, degrau a degrau", "From revenue to profit, step by step"],
      lead: ["A demonstração do resultado desce em degraus. Cada degrau tira um tipo de custo e mostra quanto sobrou. As margens dizem que fração da receita chega a cada degrau.",
        "The income statement steps down. Each step removes one kind of cost and shows what's left. Margins tell you what fraction of revenue reaches each step."],
      pontos: [
        ["<b>Margem bruta</b>: depois do custo do produto. Mostra poder de preço.", "<b>Gross margin</b>: after the cost of goods. Shows pricing power."],
        ["<b>Margem EBIT</b>: depois das despesas da operação. Mostra eficiência.", "<b>EBIT margin</b>: after operating expenses. Shows efficiency."],
        ["<b>Margem líquida</b>: depois de juros e impostos. É o que sobra ao acionista.", "<b>Net margin</b>: after interest and taxes. What's left for shareholders."],
      ],
      atencao: ["O lucro de um ano pode ter itens que não se repetem, como venda de ativo ou crédito tributário. Confira com o caixa e com outros anos.", "One year's profit can include one-offs such as an asset sale or a tax credit. Check it against cash flow and other years."],
      pratica: function (c) {
        var r = c.no("receita"), lb = c.no("lucro_bruto"), eb = c.no("ebit"), ll = c.no("lucro_liquido");
        if (c.e.financeiro) return L(b(c.nm) + " é uma financeira: não tem custo de produto. Receita de " + b(din(r)) + " e lucro de " + b(din(ll)) + " em " + c.ano + ", margem de " + b(pct(ll / r)) + ".",
          b(c.nm) + " is a financial company: no cost of goods. Revenue of " + b(din(r)) + " and profit of " + b(din(ll)) + " in " + c.ano + ", a " + b(pct(ll / r)) + " margin.");
        return L("Em " + c.ano + ", " + b(c.nm) + ": margem bruta de " + b(pct(lb / r)) + ", EBIT de " + b(pct(eb / r)) + " e líquida de " + b(pct(ll / r)) + " (mediana do site: " + pct(c.m.mliq) + ").",
          "In " + c.ano + ", " + b(c.nm) + ": gross margin " + b(pct(lb / r)) + ", EBIT margin " + b(pct(eb / r)) + " and net margin " + b(pct(ll / r)) + " (site median: " + pct(c.m.mliq) + ").");
      },
      visual: function (c) {
        var itens = [{ rot: L("Receita", "Revenue"), v: c.no("receita"), fmt: din(c.no("receita")) }];
        if (!c.e.financeiro) {
          itens.push({ rot: L("Lucro bruto", "Gross profit"), v: c.no("lucro_bruto"), fmt: din(c.no("lucro_bruto")), cls: "c1" });
          itens.push({ rot: "EBIT", v: c.no("ebit"), fmt: din(c.no("ebit")), cls: "c1" });
        }
        itens.push({ rot: L("Lucro líquido", "Net income"), v: c.no("lucro_liquido"), fmt: din(c.no("lucro_liquido")), cls: "ac" });
        return barras(itens, L("Degraus do resultado", "Income statement steps"));
      },
      link: function (c) { return ["#/" + c.tk, L("Margens de " + c.tk + " ano a ano", c.tk + " margins by year")]; },
    },
    {
      nivel: 2, palavra: ["PATRIMÔNIO", "BALANCE"],
      pergunta: ["O que a empresa tem e o que deve", "What it owns and what it owes"],
      lead: ["O balanço patrimonial é uma fotografia. De um lado, o ativo: caixa, fábricas, estoques, créditos. Do outro, quem financiou tudo isso: credores (o passivo) e acionistas (o patrimônio líquido). Os dois lados sempre fecham.",
        "The balance sheet is a photograph. On one side, assets: cash, plants, inventory, receivables. On the other, who financed it all: creditors (liabilities) and shareholders (equity). Both sides always match."],
      pontos: [
        ["Ativo = passivo + patrimônio líquido.", "Assets = liabilities + equity."],
        ["<b>Dívida líquida</b> = empréstimos − caixa. Negativa significa que sobra caixa.", "<b>Net debt</b> = borrowings − cash. Negative means cash to spare."],
        ["<b>VPA</b> = patrimônio ÷ ações: a fatia contábil de cada ação.", "<b>Book value/share</b> = equity ÷ shares: each share's slice of the books."],
      ],
      atencao: ["Patrimônio líquido negativo quer dizer que a empresa deve mais do que tem.", "Negative equity means the company owes more than it owns."],
      pratica: function (c) {
        var at = c.no("ativo_total"), pl = c.no("pl"), dl = c.no("divida_liquida");
        return L("No fim de " + c.ano + ", " + b(c.nm) + " tinha " + b(din(at)) + " em ativos e " + b(din(pl)) + " de patrimônio líquido" +
          (c.e.financeiro ? "." : "; dívida líquida de " + b(din(dl)) + ".") + " Cada ação corresponde a " + b(X.porAcao(c.i.vpa)) + " de patrimônio.",
          "At the end of " + c.ano + ", " + b(c.nm) + " had " + b(din(at)) + " in assets and " + b(din(pl)) + " in equity" +
          (c.e.financeiro ? "." : "; net debt of " + b(din(dl)) + ".") + " Each share stands for " + b(X.porAcao(c.i.vpa)) + " of equity.");
      },
      visual: function (c) {
        var at = c.no("ativo_total"), pl = c.no("pl");
        if (!finito(at) || at <= 0) return figura(txt(210, 140, "–", "rot", "middle"), "");
        var h = 190, hp = Math.max(0, Math.min(1, (pl || 0) / at)) * h, y0 = 40;
        var corpo = barraV(70, y0, 110, h, "c1", 0.1) + txt(125, y0 - 10, L("Ativo", "Assets"), "rot", "middle") + txt(125, y0 + h / 2, din(at), "val dentro", "middle") +
          barraV(240, y0, 110, h - hp, "neg", 0.3) + barraV(240, y0 + h - hp, 110, hp, "ac", 0.5) +
          txt(295, y0 - 10, L("Passivo + PL", "Liabilities + equity"), "rot", "middle") +
          (h - hp > 34 ? txt(295, y0 + (h - hp) / 2 - 3, L("credores", "creditors"), "rot escuro", "middle") + txt(295, y0 + (h - hp) / 2 + 13, din(at - (pl || 0)), "val dentro", "middle") : "") +
          (hp > 34 ? txt(295, y0 + h - hp / 2 - 3, L("acionistas", "shareholders"), "rot escuro", "middle") + txt(295, y0 + h - hp / 2 + 13, din(pl), "val dentro", "middle") : "") +
          txt(210, y0 + h / 2 + 6, "=", "igual", "middle");
        return figura(corpo, L("Os dois lados do balanço", "Both sides of the balance sheet"));
      },
      link: function (c) { return ["#/" + c.tk, L("Balanço de " + c.tk, c.tk + " balance sheet")]; },
    },
    {
      nivel: 2, palavra: ["CAIXA", "CASH"],
      pergunta: ["Lucro não é dinheiro no bolso", "Profit isn't cash in hand"],
      lead: ["O lucro segue regras contábeis; o caixa mostra o dinheiro de verdade. A empresa gera caixa operando, gasta parte para manter e crescer (o capex) e o que sobra é o <b>Fluxo de caixa livre</b>: o dinheiro que pode virar dividendo ou pagar dívida.",
        "Profit follows accounting rules; cash shows the real money. A company generates cash by operating, spends part to maintain and grow (capex), and what's left is <b>Free cash flow</b>: money that can become dividends or repay debt."],
      pontos: [
        ["Caixa operacional: dinheiro gerado vendendo e recebendo dos clientes.", "Operating cash flow: money generated by selling and collecting from customers."],
        ["Capex: investimento em máquinas, fábricas e sistemas.", "Capex: investment in machines, plants and systems."],
        ["Fluxo de caixa livre = caixa operacional − capex.", "Free cash flow = operating cash flow − capex."],
      ],
      atencao: ["Lucro subindo com caixa livre negativo por vários anos é um sinal de alerta.", "Rising profit with negative free cash flow for several years is a warning sign."],
      pratica: function (c) {
        if (c.e.financeiro) return L("Em financeiras como " + b(c.nm) + ", o caixa mistura depósitos e crédito e não mede a geração do negócio. Olhe lucro, ROE e patrimônio.",
          "In financial companies like " + b(c.nm) + ", cash mixes deposits and lending and doesn't measure the business. Look at profit, ROE and equity instead.");
        var fco = c.no("fco"), cap = c.no("capex"), ll = c.no("lucro_liquido"), fcl = finito(fco) ? fco - (cap || 0) : null;
        return L("Em " + c.ano + ", " + b(c.nm) + " gerou " + b(din(fco)) + " na operação, investiu " + b(din(cap)) + " e ficou com " + b(din(fcl)) + " de caixa livre, contra " + din(ll) + " de lucro.",
          "In " + c.ano + ", " + b(c.nm) + " generated " + b(din(fco)) + " from operations, invested " + b(din(cap)) + " and kept " + b(din(fcl)) + " in free cash flow, against " + din(ll) + " of profit.");
      },
      visual: function (c) {
        if (c.e.financeiro) return figura(caixa(60, 60, 300, 150, "", 0.1) + txt(210, 140, L("caixa de banco = depósitos e crédito", "bank cash = deposits and lending"), "rot", "middle"), "");
        var fco = c.no("fco"), cap = c.no("capex"), fcl = finito(fco) ? fco - (cap || 0) : null;
        return barras([
          { rot: L("Caixa operacional", "Operating cash"), v: fco, fmt: din(fco), cls: "c1" },
          { rot: "Capex", v: finito(cap) ? -cap : null, fmt: finito(cap) ? din(-cap) : "–" },
          { rot: L("Caixa livre", "Free cash flow"), v: fcl, fmt: din(fcl), cls: "ac" },
          { rot: L("Lucro líquido", "Net income"), v: c.no("lucro_liquido"), fmt: din(c.no("lucro_liquido")), cls: "mudo" },
        ], L("Do caixa operacional ao caixa livre", "From operating to free cash flow"));
      },
      link: function (c) { return ["#/" + c.tk, L("Fluxo de caixa de " + c.tk, c.tk + " cash flow")]; },
    },
    {
      nivel: 2, palavra: ["MÚLTIPLOS", "MULTIPLES"],
      pergunta: ["Está cara ou barata?", "Expensive or cheap?"],
      lead: ["Múltiplos comparam o preço com o que a empresa entrega. Sozinhos dizem pouco; comparados com o setor e com a própria história, dizem bastante.",
        "Multiples compare the price with what the company delivers. Alone they say little; against the sector and the company's own history, they say a lot."],
      pontos: [
        ["<b>P/L</b>: preço ÷ lucro. Quantos anos de lucro você paga.", "<b>P/E</b>: price ÷ earnings. How many years of profit you pay for."],
        ["<b>P/VP</b>: preço ÷ patrimônio. Leia junto com o ROE.", "<b>P/B</b>: price ÷ book value. Read it alongside ROE."],
        ["<b>EV/EBITDA</b>: valor da empresa com a dívida ÷ geração operacional.", "<b>EV/EBITDA</b>: company value including debt ÷ operating generation."],
      ],
      atencao: ["Múltiplo baixo pode ser oportunidade ou armadilha: empresa em declínio fica barata e continua barata.", "A low multiple can be an opportunity or a trap: a declining company gets cheap and stays cheap."],
      pratica: function (c) {
        return L(b(c.tk) + ": P/L " + b(vz(c.i.pl)) + ", P/VP " + b(vz(c.i.pvp)) + ", EV/EBITDA " + b(vz(c.i.evEbitda)) + ". A mediana das " + c.m.n + " empresas do site: P/L " + vz(c.m.pl) + ", P/VP " + vz(c.m.pvp) + ", EV/EBITDA " + vz(c.m.ev) + ".",
          b(c.tk) + ": P/E " + b(vz(c.i.pl)) + ", P/B " + b(vz(c.i.pvp)) + ", EV/EBITDA " + b(vz(c.i.evEbitda)) + ". Median across the site's " + c.m.n + " companies: P/E " + vz(c.m.pl) + ", P/B " + vz(c.m.pvp) + ", EV/EBITDA " + vz(c.m.ev) + ".");
      },
      visual: function (c) {
        var max = 30, x = function (v) { return 30 + Math.min(max, v) / max * 360; };
        var corpo = traco("M30 150 H390", "eixo", 0);
        [0, 5, 10, 15, 20, 25, 30].forEach(function (t) { corpo += txt(x(t), 172, t + "x", "num", "middle"); });
        c.m.info.forEach(function (o, j) {
          var v = o.i.pl;
          if (!(v > 0)) return;
          var y = 150 - 12 - ((j * 37) % 9) * 9;
          corpo += '<circle cx="' + x(v).toFixed(1) + '" cy="' + y + '" r="3" class="pt"' + atraso(0.004 * j) + "/>";
        });
        if (finito(c.m.pl)) corpo += traco("M" + x(c.m.pl).toFixed(1) + " 50 V158", "linha c1", 0.6) + txt(x(c.m.pl), 44, L("mediana ", "median ") + vz(c.m.pl), "rot c1", "middle");
        if (c.i.pl > 0) corpo += '<circle cx="' + x(c.i.pl).toFixed(1) + '" cy="200" r="7" class="no ac"' + atraso(0.9) + "/>" +
          traco("M" + x(c.i.pl).toFixed(1) + " 193 V158", "linha ac", 0.9) + txt(x(c.i.pl), 226, c.tk + " " + vz(c.i.pl) + (c.i.pl > max ? " →" : ""), "rot ac", "middle");
        else corpo += txt(210, 215, c.tk + L(": P/L sem sentido (prejuízo)", ": P/E not meaningful (loss)"), "rot neg", "middle");
        return figura(corpo, L("P/L de todas as empresas do site", "P/E across every company on the site"));
      },
      link: function (c) { return ["#/comparar/" + c.tk, L("Comparar " + c.tk + " com outras", "Compare " + c.tk + " with others")]; },
    },
    {
      nivel: 2, palavra: ["RETORNO", "RETURNS"],
      pergunta: ["O negócio cria valor?", "Does the business create value?"],
      lead: ["Uma boa empresa ganha bem sobre o dinheiro que os sócios deixaram nela. O <b>ROE</b> mede isso: lucro ÷ patrimônio. Se ele fica abaixo do que a renda fixa paga, o acionista estaria melhor em outro lugar.",
        "A good company earns well on the money its partners left in it. <b>ROE</b> measures that: profit ÷ equity. If it stays below what fixed income pays, shareholders would be better off elsewhere."],
      pontos: [
        ["ROE alto e estável por muitos anos é marca de vantagem competitiva.", "A high, steady ROE over many years is the mark of a competitive edge."],
        ["Margens altas protegem a empresa quando os custos sobem.", "High margins protect the company when costs rise."],
        ["Cuidado com ROE inflado por patrimônio pequeno ou por muita dívida.", "Beware of ROE inflated by thin equity or heavy debt."],
      ],
      atencao: ["Olhe vários anos: um ROE alto num ano só pode vir de lucro extraordinário.", "Look at several years: a high ROE in a single year may come from one-off profit."],
      _roe: function (c) {
        var lc = c.s("lucro_controladora"), pl = c.s("pl_controladora");
        return c.anos.map(function (a, k) { return finito(lc[k]) && pl[k] > 0 ? lc[k] / pl[k] * 100 : null; });
      },
      pratica: function (c) {
        var roe = c.i.d12 ? c.i.roe12 : c.i.roe, r = this._roe(c), ult = r.slice(-10).filter(finito);
        var acima = ult.filter(function (v) { return v >= 15; }).length;
        return L("O ROE de " + b(c.nm) + " é " + b(pct(roe)) + " (mediana do site: " + pct(c.m.roe) + "). Nos últimos " + ult.length + " anos, ficou acima de 15% em " + b(acima) + ".",
          b(c.nm) + "'s ROE is " + b(pct(roe)) + " (site median: " + pct(c.m.roe) + "). Over the last " + ult.length + " years, it was above 15% in " + b(acima) + ".");
      },
      visual: function (c) {
        var r = this._roe(c), n = Math.min(12, c.anos.length), ini = c.anos.length - n;
        var med = finito(c.m.roe) ? c.m.roe * 100 : null;
        return linhasSvg(c.anos.slice(ini), [
          { v: r.slice(ini).map(function (v) { return finito(v) ? Math.max(-40, Math.min(80, v)) : null; }), cls: "ac", rot: "ROE " + c.tk + " (%)" },
          { v: r.slice(ini).map(function () { return med; }), cls: "c1", rot: L("mediana atual do site", "current site median") },
        ], L("ROE ano a ano", "ROE by year"), { min: 0, fmt: function (v) { return X.nf(0).format(v) + "%"; } });
      },
      link: function () { return ["#/ranking", L("Ranking por qualidade", "Quality ranking")]; },
    },
    {
      nivel: 2, palavra: ["DÍVIDA", "DEBT"],
      pergunta: ["O balanço aguenta um ano ruim?", "Can the balance sheet take a bad year?"],
      lead: ["Dívida não é ruim por si: bem usada, acelera o crescimento. O risco aparece quando ela fica grande perto do que a empresa gera. A medida mais usada é <b>Dív. líq./EBITDA</b>: quantos anos de geração operacional pagariam a dívida.",
        "Debt isn't bad in itself: used well, it speeds up growth. Risk shows when it gets large relative to what the company generates. The most used yardstick is <b>Net debt/EBITDA</b>: how many years of operating generation would repay it."],
      pontos: [
        ["Abaixo de 1,5x: folgado. Entre 1,5x e 3x: atenção. Acima de 3x: os juros pesam.", "Below 1.5x: comfortable. 1.5x to 3x: watch it. Above 3x: interest weighs."],
        ["Setores de receita estável (energia, saneamento) suportam mais dívida.", "Stable-revenue sectors (power, water) can carry more debt."],
        ["Bancos ficam fora dessa conta: a dívida é a matéria-prima deles.", "Banks are left out: debt is their raw material."],
      ],
      atencao: ["Dívida em dólar com receita em real é um risco extra quando o câmbio sobe.", "Dollar debt with revenue in reais adds risk when the currency weakens."],
      _v: function (c) { return c.i.d12 ? c.i.dlEbitda12 : c.i.dlEbitda; },
      pratica: function (c) {
        if (c.e.financeiro) return L(b(c.nm) + " é financeira: dívida/EBITDA não se aplica. Olhe o patrimônio e a regulação de capital.", b(c.nm) + " is a financial company: debt/EBITDA doesn't apply. Look at equity and capital rules.");
        var v = this._v(c);
        return L("A dívida líquida de " + b(c.nm) + " equivale a " + b(vz(v)) + " o EBITDA (mediana do site: " + vz(c.m.dl) + "). " +
          (v == null ? "" : v < 0 ? "Ela tem mais caixa do que dívida." : v < 1.5 ? "Está na zona folgada." : v < 3 ? "Está na zona de atenção." : "Está acima de 3x: zona de risco."),
          b(c.nm) + "'s net debt is " + b(vz(v)) + " its EBITDA (site median: " + vz(c.m.dl) + "). " +
          (v == null ? "" : v < 0 ? "It holds more cash than debt." : v < 1.5 ? "That's the comfortable zone." : v < 3 ? "That's the watch zone." : "Above 3x: the risk zone."));
      },
      visual: function (c) {
        var cx = 210, cy = 200, r = 140, ang = function (v) { return Math.PI * (1 - Math.max(0, Math.min(5, v)) / 5); };
        var arco = function (a, b2, cls, s) {
          var x1 = cx + r * Math.cos(ang(a)), y1 = cy - r * Math.sin(ang(a)), x2 = cx + r * Math.cos(ang(b2)), y2 = cy - r * Math.sin(ang(b2));
          return traco("M" + x1.toFixed(1) + " " + y1.toFixed(1) + " A" + r + " " + r + " 0 0 1 " + x2.toFixed(1) + " " + y2.toFixed(1), "arco " + cls, s);
        };
        var corpo = arco(0, 1.5, "ac", 0.1) + arco(1.5, 3, "amb", 0.3) + arco(3, 5, "neg", 0.5);
        [0, 1.5, 3, 5].forEach(function (t) { corpo += txt(cx + (r + 16) * Math.cos(ang(t)), cy - (r + 16) * Math.sin(ang(t)) + 4, X.nf(1).format(t) + "x", "num", "middle"); });
        var v = this._v(c);
        if (!c.e.financeiro && finito(v)) {
          var a = ang(v);
          corpo += traco("M" + cx + " " + cy + " L" + (cx + (r - 22) * Math.cos(a)).toFixed(1) + " " + (cy - (r - 22) * Math.sin(a)).toFixed(1), "ponteiro", 0.8) +
            '<circle cx="' + cx + '" cy="' + cy + '" r="6" class="no ac"/>' + txt(cx, cy + 30, c.tk + " " + vz(v), "rot ac", "middle");
        } else corpo += txt(cx, cy + 30, c.tk + L(": não se aplica", ": not applicable"), "rot", "middle");
        return figura(corpo, L("Dívida líquida sobre EBITDA", "Net debt to EBITDA"));
      },
      link: function (c) { return ["#/" + c.tk, L("Dívida de " + c.tk + " ao longo dos anos", c.tk + " debt over the years")]; },
    },

    // ------------------------------------------------------------ nível 3
    {
      nivel: 3, palavra: ["DILUIÇÃO", "DILUTION"],
      pergunta: ["Sua fatia está encolhendo?", "Is your slice shrinking?"],
      lead: ["Quando a empresa emite ações novas, cada ação antiga passa a valer uma fatia menor do lucro: é a diluição. Quando recompra e cancela ações, a fatia cresce. Desdobramentos e grupamentos mudam o tamanho da fatia, não o valor dela; o site já desconta esses eventos.",
        "When a company issues new shares, each existing share is worth a smaller slice of profit: that's dilution. When it buys back and cancels shares, the slice grows. Splits and reverse splits change the slice's size, not its value; the site already adjusts for them."],
      pontos: [
        ["Compare o crescimento do lucro com o do <b>LPA</b>: a diferença é a diluição.", "Compare profit growth with <b>EPS</b> growth: the gap is dilution."],
        ["<b>Variação de ações 5a</b> negativa = recompras.", "A negative <b>Share count change 5y</b> = buybacks."],
        ["Aumentos de capital frequentes indicam um negócio que consome mais caixa do que gera.", "Frequent capital raises point to a business that burns more cash than it makes."],
      ],
      atencao: ["Plano de ações para executivos também dilui, pouco a pouco, todo ano.", "Executive stock plans dilute too, a little every year."],
      pratica: function (c) {
        var ac = c.pa.acoes, n = c.anos.length, ini = Math.max(0, n - 10), a0 = -1, u = ultimoIdx(ac);
        for (var k = ini; k < n; k++) if (finito(ac[k])) { a0 = k; break; }
        if (a0 < 0 || u <= a0) return L("Sem contagem de ações suficiente para " + c.nm + ".", "Not enough share count history for " + c.nm + ".");
        var v = ac[u] / ac[a0] - 1;
        return L("De " + c.anos[a0] + " a " + c.anos[u] + ", o número de ações de " + b(c.nm) + " (na base de hoje) variou " + b((v > 0 ? "+" : "") + pct(v)) + ". Em 5 anos, o lucro cresceu " + b(pct(c.i.cagrLuc)) + " ao ano e o lucro por ação, " + b(pct(c.i.lpaCagr)) + ".",
          "From " + c.anos[a0] + " to " + c.anos[u] + ", " + b(c.nm) + "'s share count (in today's basis) changed " + b((v > 0 ? "+" : "") + pct(v)) + ". Over 5 years, profit grew " + b(pct(c.i.cagrLuc)) + " a year and EPS " + b(pct(c.i.lpaCagr)) + ".");
      },
      visual: function (c) {
        var ac = c.pa.acoes, n = c.anos.length, ini = Math.max(0, n - 10), vals = ac.slice(ini);
        var max = Math.max.apply(null, vals.filter(finito).concat([1])), w = 360 / vals.length, corpo = traco("M30 220 H390", "eixo", 0);
        vals.forEach(function (v, j) {
          if (!finito(v)) return;
          var h = v / max * 170;
          corpo += barraV(30 + j * w + w * 0.18, 220 - h, w * 0.64, h, j === vals.length - 1 ? "ac" : "c1", 0.05 + j * 0.06);
        });
        corpo += txt(30, 244, String(c.anos[ini]), "rot") + txt(390, 244, String(c.anos[n - 1]), "rot", "end") +
          txt(390, 34, X.qtd(vals[vals.length - 1]) + L(" ações", " shares"), "rot ac", "end");
        return figura(corpo, L("Ações em circulação por ano", "Shares outstanding by year"));
      },
      link: function (c) { return ["#/" + c.tk, L("Ações de " + c.tk + " ano a ano", c.tk + " shares by year")]; },
    },
    {
      nivel: 3, palavra: ["CICLO", "CYCLE"],
      pergunta: ["Previsível ou cíclica?", "Predictable or cyclical?"],
      lead: ["Algumas empresas lucram parecido todo ano: energia, saneamento, consumo básico. Outras sobem e descem com o petróleo, o minério ou a economia. O índice de <b>Previsibilidade</b> do site mede essa regularidade em dez anos.",
        "Some companies earn similar amounts every year: power, water, staples. Others rise and fall with oil, iron ore or the economy. The site's <b>Predictability</b> score measures that consistency over ten years."],
      pontos: [
        ["Em cíclicas, P/L baixo no pico do lucro é armadilha: o lucro tende a cair.", "In cyclicals, a low P/E at peak earnings is a trap: profit tends to fall."],
        ["Em previsíveis, dá para projetar o lucro com mais confiança.", "With predictable companies, profit can be projected with more confidence."],
        ["Previsível não quer dizer barata: o preço já pode embutir a qualidade.", "Predictable doesn't mean cheap: the price may already reflect the quality."],
      ],
      atencao: ["Olhe o lucro de dez anos, não de um: o ano atual pode ser o pico ou o vale.", "Look at ten years of profit, not one: this year may be the peak or the trough."],
      _ref: function (c) {
        return X.visiveis().filter(function (e) { return e.score.brl && e.anos.length >= 10 && e !== c.e; })
          .sort(function (a, b2) { return b2.score.brl.total - a.score.brl.total; })[0] || null;
      },
      pratica: function (c) {
        var s = X.score(c.e), nv = X.nivelScore(s && s.total), ref = this._ref(c);
        return L("O índice de " + b(c.nm) + " é " + b(s ? s.total + "/100" : "–") + " (" + nv.txt.toLowerCase() + ")." + (ref ? " A mais previsível do site hoje é " + b(X.nomeCurto(ref.nome)) + ", com " + ref.score.brl.total + "." : ""),
          b(c.nm) + "'s score is " + b(s ? s.total + "/100" : "–") + " (" + nv.txt.toLowerCase() + ")." + (ref ? " The most predictable on the site today is " + b(X.nomeCurto(ref.nome)) + ", at " + ref.score.brl.total + "." : ""));
      },
      visual: function (c) {
        var ref = this._ref(c), n = 10;
        var norm = function (e) {
          var v = (X.serie(e, "lucro_liquido") || []).slice(-n), m = v.filter(finito).reduce(function (a, x) { return a + Math.abs(x); }, 0) / Math.max(1, v.filter(finito).length);
          return v.map(function (x) { return finito(x) && m ? Math.max(-3, Math.min(3, x / m)) : null; });
        };
        var series = [{ v: norm(c.e), cls: "ac", rot: c.tk }];
        if (ref) series.push({ v: norm(ref), cls: "c1", rot: ref.ticker + L(" (mais previsível)", " (most predictable)") });
        return linhasSvg(c.anos.slice(-n), series, L("Lucro em relação à própria média", "Profit relative to its own average"));
      },
      link: function () { return ["#/ranking", L("Ver o ranking", "See the ranking")]; },
    },
    {
      nivel: 3, palavra: ["CÂMBIO", "CURRENCY"],
      pergunta: ["Em reais ou em dólares?", "In reais or in dollars?"],
      lead: ["Quem investe de fora recebe em reais e mede em dólares. Uma empresa que cresce todo ano em reais pode encolher em dólar quando o real perde valor. Por isso o site mostra tudo nas duas moedas e calcula o índice também em US$.",
        "Foreign investors are paid in reais but measure in dollars. A company growing every year in reais can shrink in dollars when the real weakens. That's why the site shows everything in both currencies and computes the score in US$ too."],
      pontos: [
        ["As conversões usam a PTAX, a taxa oficial do Banco Central.", "Conversions use PTAX, the Central Bank's official rate."],
        ["Exportadoras (minério, celulose, petróleo) ganham com o dólar alto.", "Exporters (iron ore, pulp, oil) benefit from a strong dollar."],
        ["Use o seletor R$ | US$ no topo: todas as páginas mudam junto.", "Use the R$ | US$ switch at the top: every page follows."],
      ],
      atencao: ["Retorno em dólar = retorno em reais corrigido pela variação do câmbio no período.", "Dollar return = return in reais adjusted for the currency move over the period."],
      _anos: function () { return Object.keys(X.D.ptax).map(Number).sort(); },
      pratica: function (c) {
        var anos = this._anos(), p0 = X.D.ptax[String(anos[0])].media, p1 = X.D.ptax_atual.valor, sb = c.e.score.brl, su = c.e.score.usd;
        return L("Em " + anos[0] + ", um dólar valia " + b("R$ " + X.nf(2).format(p0)) + "; hoje vale " + b("R$ " + X.nf(2).format(p1)) + ". O índice de " + b(c.nm) + " é " + (sb ? sb.total : "–") + " em reais e " + b(su ? su.total : "–") + " em dólares.",
          "In " + anos[0] + ", one dollar bought " + b("R$ " + X.nf(2).format(p0)) + "; today it buys " + b("R$ " + X.nf(2).format(p1)) + ". " + b(c.nm) + "'s score is " + (sb ? sb.total : "–") + " in reais and " + b(su ? su.total : "–") + " in dollars.");
      },
      visual: function () {
        var anos = this._anos();
        return linhasSvg(anos, [{ v: anos.map(function (a) { return X.D.ptax[String(a)].media; }), cls: "amb", rot: L("R$ por US$ (PTAX média do ano)", "R$ per US$ (yearly average PTAX)") }],
          L("Reais por dólar", "Reais per dollar"), { min: 0, fmt: function (v) { return X.nf(1).format(v); } });
      },
      link: function (c) { return ["#/" + c.tk, L("Ver " + c.tk + " em dólares", "See " + c.tk + " in dollars")]; },
    },
    {
      nivel: 3, palavra: ["GOVERNANÇA", "GOVERNANCE"],
      pergunta: ["Quem manda, e quem protege você?", "Who's in charge, and who protects you?"],
      lead: ["Além dos números, importa quem controla a empresa e que regras ela segue. Os segmentos de listagem da B3 exigem mais transparência e proteção ao minoritário; estatais trazem risco político.",
        "Beyond the numbers, it matters who controls the company and what rules it follows. B3's listing segments require more disclosure and minority protection; state-owned companies carry political risk."],
      pontos: [
        ["<b>Novo Mercado</b>: só ações com voto e tag along de 100% numa venda do controle.", "<b>Novo Mercado</b>: voting shares only and 100% tag-along if control is sold."],
        ["<b>Estatal</b>: preços, investimentos e dividendos podem seguir objetivos do governo.", "<b>State-owned</b>: prices, investment and dividends may follow government goals."],
        ["Concentração também é risco: não ponha tudo numa empresa nem num setor.", "Concentration is a risk too: don't put everything in one company or sector."],
      ],
      atencao: ["Governança boa não compensa um negócio ruim, mas governança ruim estraga um negócio bom.", "Good governance won't fix a bad business, but bad governance can spoil a good one."],
      _seg: function () {
        var base = X.visiveis(), g = [["Novo Mercado", 0, "ac"], ["Nível 2 de Governança Corporativa", 0, "c1"], ["Nível 1 de Governança Corporativa", 0, "amb"], ["", 0, "mudo"]];
        base.forEach(function (e) { var j = g.findIndex(function (x) { return x[0] === e.segmento; }); g[j < 0 ? 3 : j][1]++; });
        return { g: g, n: base.length, est: base.filter(function (e) { return /^Estatal/.test(e.controle); }).length };
      },
      pratica: function (c) {
        var d = this._seg();
        return L(b(c.nm) + ": segmento " + b(X.mapa("segmento", c.e.segmento)) + ", controle " + b(X.mapa("controle", c.e.controle).toLowerCase()) + ". No site, " + d.g[0][1] + " das " + d.n + " empresas estão no Novo Mercado e " + d.est + " são estatais.",
          b(c.nm) + ": " + b(X.mapa("segmento", c.e.segmento)) + " segment, " + b(X.mapa("controle", c.e.controle).toLowerCase()) + " control. On the site, " + d.g[0][1] + " of " + d.n + " companies are in Novo Mercado and " + d.est + " are state-owned.");
      },
      visual: function (c) {
        var d = this._seg(), x = 30, corpo = "", nomes = ["Novo Mercado", L("Nível 2", "Level 2"), L("Nível 1", "Level 1"), L("Básico", "Basic")];
        d.g.forEach(function (s, j) {
          var w = s[1] / Math.max(1, d.n) * 360;
          if (w <= 0) return;
          var meu = c.e.segmento === s[0] || (j === 3 && ["Novo Mercado", "Nível 2 de Governança Corporativa", "Nível 1 de Governança Corporativa"].indexOf(c.e.segmento) < 0);
          corpo += barraH(x, 100, w - 3, 54, s[2] + (meu ? " meu" : ""), 0.1 + j * 0.15) +
            (w > 46 ? txt(x + 8, 92 - (j % 2) * 0, nomes[j], "rot") + txt(x + 8, 133, String(s[1]), "val dentro") : "");
          if (meu) corpo += traco("M" + (x + w / 2).toFixed(1) + " 160 V196", "linha ac", 0.8) + txt(x + w / 2, 214, c.tk, "rot ac", "middle");
          x += w;
        });
        return figura(corpo, L("Empresas do site por segmento de governança", "Site companies by governance segment"));
      },
      link: function () { return ["#/acoes", L("Filtrar por segmento e controle", "Filter by segment and control")]; },
    },
    {
      nivel: 3, palavra: ["VALOR", "VALUE"],
      pergunta: ["Quanto vale uma empresa?", "What is a company worth?"],
      lead: ["Uma empresa vale o dinheiro que vai gerar no futuro, trazido para hoje. Dinheiro de daqui a dez anos vale menos que dinheiro hoje, porque poderia render juros no caminho. Comprar abaixo desse valor dá uma margem de segurança.",
        "A company is worth the cash it will generate in the future, brought back to today. Money ten years out is worth less than money now, because it could earn interest along the way. Buying below that value gives a margin of safety."],
      pontos: [
        ["Lucro ÷ preço (o inverso do P/L) é o rendimento do lucro: compare com os juros.", "Earnings ÷ price (the inverse of P/E) is the earnings yield: compare it with interest rates."],
        ["Crescimento aumenta o valor; risco e juros altos diminuem.", "Growth raises value; risk and high rates lower it."],
        ["Margem de segurança: pague bem menos do que estima, porque a estimativa pode errar.", "Margin of safety: pay well below your estimate, because the estimate can be wrong."],
      ],
      atencao: ["Toda avaliação depende de premissas. O Simular do site mostra cenários, não certezas.", "Every valuation depends on assumptions. The site's Simulate tab shows scenarios, not certainties."],
      pratica: function (c) {
        if (!(c.i.pl > 0)) return L(b(c.nm) + " teve prejuízo nos últimos 12 meses: o rendimento do lucro é negativo e o valor depende da recuperação.", b(c.nm) + " lost money over the last 12 months: its earnings yield is negative and its value depends on a recovery.");
        return L("Se o lucro de 12 meses de " + b(c.nm) + " se repetisse, cada " + simbolo() + " 100 investidos renderiam " + b(simbolo() + " " + X.nf(1).format(100 / c.i.pl)) + " de lucro por ano: um rendimento de " + b(pct(1 / c.i.pl)) + ". Compare com o que a renda fixa paga.",
          "If " + b(c.nm) + "'s last 12 months of profit repeated, every " + simbolo() + " 100 invested would earn " + b(simbolo() + " " + X.nf(1).format(100 / c.i.pl)) + " a year: an earnings yield of " + b(pct(1 / c.i.pl)) + ". Compare it with fixed income.");
      },
      visual: function () {
        var corpo = traco("M30 220 H390", "eixo", 0), w = 32;
        for (var k = 0; k < 10; k++) {
          var x = 40 + k * 35, h = 150, hv = 150 / Math.pow(1.12, k + 1);
          corpo += caixa(x, 220 - h, w - 6, h, "mudo", 0.05 * k) + barraV(x, 220 - hv, w - 6, hv, "ac", 0.3 + 0.06 * k);
        }
        corpo += txt(40, 54, L("caixa futuro", "future cash"), "rot") + txt(390, 54, L("quanto vale hoje (juros de 12% a.a.)", "worth today (12% a year)"), "rot ac", "end") +
          txt(40, 244, L("ano 1", "year 1"), "rot") + txt(390, 244, L("ano 10", "year 10"), "rot", "end");
        return figura(corpo, L("Caixa futuro trazido a valor de hoje", "Future cash discounted to today"));
      },
      link: function (c) { return ["#/simular/" + c.tk, L("Simular " + c.tk, "Simulate " + c.tk)]; },
    },
    {
      nivel: 3, palavra: ["MÉTODO", "METHOD"],
      pergunta: ["Seu roteiro em oito perguntas", "Your checklist in eight questions"],
      lead: ["Juntando tudo: antes de comprar uma ação, responda a estas perguntas. Cada uma tem um lugar no Real Terms.",
        "Putting it all together: before buying a share, answer these questions. Each one has a place on Real Terms."],
      pontos: [
        ["<a href=\"#/{tk}\">1. O que a empresa faz e como ganha dinheiro?</a> Página da empresa.", "<a href=\"#/{tk}\">1. What does it do and how does it make money?</a> Company page."],
        ["<a href=\"#/{tk}\">2. O lucro é regular?</a> Índice de previsibilidade. <a href=\"#/{tk}\">3. O caixa acompanha o lucro?</a> Fluxo de caixa.", "<a href=\"#/{tk}\">2. Is profit consistent?</a> Predictability score. <a href=\"#/{tk}\">3. Does cash follow profit?</a> Cash flow."],
        ["<a href=\"#/ranking\">4. A dívida cabe? 5. O negócio cria valor?</a> Ranking: solidez e qualidade. <a href=\"#/comparar/{tk}\">6. O preço é razoável perto do setor?</a> Comparar.", "<a href=\"#/ranking\">4. Is the debt manageable? 5. Does it create value?</a> Ranking: strength and quality. <a href=\"#/comparar/{tk}\">6. Is the price fair against peers?</a> Compare."],
        ["<a href=\"#/{tk}\">7. Você está sendo diluído?</a> Ações por ano. <a href=\"#/agenda\">8. Paga com regularidade?</a> Agenda. Depois, <a href=\"#/simular/{tk}\">simule</a> antes de decidir.", "<a href=\"#/{tk}\">7. Are you being diluted?</a> Shares by year. <a href=\"#/agenda\">8. Does it pay consistently?</a> Calendar. Then <a href=\"#/simular/{tk}\">simulate</a> before deciding."],
      ],
      atencao: ["O Real Terms é uma ferramenta de dados públicos, não uma recomendação de investimento. A decisão é sua.", "Real Terms is a public-data tool, not investment advice. The decision is yours."],
      pratica: function (c) {
        return L("Comece por " + b(c.nm) + ": abra a página dela, confira as oito perguntas e compare com duas empresas do mesmo setor.",
          "Start with " + b(c.nm) + ": open its page, go through the eight questions and compare it with two peers in the same sector.");
      },
      visual: function () {
        var corpo = "";
        for (var k = 0; k < 8; k++) {
          var col = k < 4 ? 0 : 1, lin = k % 4, x = 40 + col * 190, y = 40 + lin * 50;
          corpo += caixa(x, y, 26, 26, "", 0.08 * k) + traco("M" + (x + 6) + " " + (y + 13) + " L" + (x + 11) + " " + (y + 19) + " L" + (x + 21) + " " + (y + 7), "linha ac", 0.5 + 0.1 * k) +
            traco("M" + (x + 38) + " " + (y + 13) + " H" + (x + 150 - (k * 13) % 50), "eixo", 0.3 + 0.08 * k);
        }
        return figura(corpo, L("Lista de verificação", "Checklist"));
      },
      link: function (c) { return ["#/" + c.tk, L("Começar por " + c.tk, "Start with " + c.tk)]; },
    },
  ];
  var TOTAL = AULAS.length - 1;  // aulas numeradas (a capa é a 0)

  // ---------------------------------------------------------------- estado do palco

  var atual = 0, empresa = null, raiz = null, particulas = null;

  function escolherEmpresa() {
    var vis = X.visiveis().filter(function (e) { return Object.keys(e.cotacao).length; });
    var salvo = ler(CHAVE_EMPRESA), e = salvo && X.POR_TICKER[salvo];
    if (e && vis.indexOf(e) >= 0) return e;
    var pet = X.POR_TICKER.PETR4;
    if (pet && vis.indexOf(pet) >= 0) return pet;
    return vis.slice().sort(function (a, b2) { return (b2.valor_mercado || 0) - (a.valor_mercado || 0); })[0] || X.EMPRESAS[0];
  }
  function vistas() { try { return JSON.parse(ler(CHAVE_VISTAS) || "[]"); } catch (e) { return []; } }
  function marcarVista(k) { var v = vistas(); if (v.indexOf(k) < 0) { v.push(k); guardar(CHAVE_VISTAS, JSON.stringify(v)); } }

  function num(k) { return (k < 10 ? "0" : "") + k; }

  /** título que se decodifica: cada letra passa por glifos aleatórios até assentar; uma fica na cor de destaque */
  function decodificar(h1, palavra) {
    var letras = palavra.split(""), destaque = 1 + Math.floor(Math.random() * Math.max(1, letras.length - 2));
    h1.setAttribute("aria-label", palavra);
    h1.innerHTML = letras.map(function (ch, j) {
      return '<span aria-hidden="true" class="' + (j === destaque ? "dest" : "") + '">' + (ch === " " ? "&nbsp;" : esc(ch)) + "</span>";
    }).join("");
    ajustarTitulo(h1);
    if (reduzMovimento()) return;
    var spans = h1.querySelectorAll("span"), t0 = performance.now();
    (function passo(t) {
      if (!document.body.contains(h1)) return;
      var pronto = true;
      for (var j = 0; j < spans.length; j++) {
        var fim = 120 + j * 55 + 240;
        if (t - t0 < fim) { pronto = false; spans[j].textContent = letras[j] === " " ? " " : GLIFOS.charAt(Math.floor(Math.random() * GLIFOS.length)); spans[j].classList.add("ruido"); }
        else if (spans[j].classList.contains("ruido")) { spans[j].textContent = letras[j] === " " ? " " : letras[j]; spans[j].classList.remove("ruido"); }
      }
      if (!pronto) requestAnimationFrame(passo);
    })(t0);
  }
  /** encolhe o título até caber na coluna */
  function ajustarTitulo(h1) {
    h1.style.fontSize = "";
    // no celular a coluna do texto tem display: contents (largura 0): mede a aula inteira
    var max = parseFloat(getComputedStyle(h1).fontSize), largura = h1.parentNode.clientWidth || h1.closest(".c-aula").clientWidth;
    for (var g = 0; g < 12 && h1.scrollWidth > largura && max > 22; g++) { max *= 0.9; h1.style.fontSize = max + "px"; }
  }

  function linkAbs(html, c) { return html.replace(/\{tk\}/g, c.tk); }

  function desenharAula(dir) {
    var a = AULAS[atual], c = contexto(empresa), slide = raiz.querySelector(".c-slide");
    var lnk = a.link(c);
    slide.className = "c-slide entra" + (dir < 0 ? " volta" : "");
    slide.innerHTML =
      '<article class="c-aula" aria-roledescription="' + esc(L("aula", "lesson")) + '" aria-label="' + esc(num(atual) + " " + T(a.palavra)) + '">' +
      '<div class="c-texto">' +
      '<h1 class="c-palavra"></h1>' +
      '<p class="c-pergunta">' + esc(T(a.pergunta)) + "</p>" +
      '<p class="c-lead">' + T(a.lead) + "</p>" +
      '<ul class="c-pontos">' + a.pontos.map(function (p, j) { return '<li style="--i:' + j + '">' + linkAbs(T(p), c) + "</li>"; }).join("") + "</ul>" +
      '<p class="c-atencao"><span>' + esc(L("Fique atento", "Watch out")) + "</span>" + esc(T(a.atencao)) + "</p>" +
      "</div>" +
      '<div class="c-lado">' +
      '<figure class="c-figura">' + a.visual(c) + "</figure>" +
      '<div class="c-pratica"><span class="c-rot">' + esc(L("Na prática", "In practice")) + " · " + esc(c.tk) + "</span><p>" + a.pratica(c) + "</p></div>" +
      '<a class="c-link" href="' + esc(lnk[0]) + '">' + esc(lnk[1]) + ' <span aria-hidden="true">→</span></a>' +
      "</div></article>";
    decodificar(slide.querySelector(".c-palavra"), T(a.palavra));
    // reinicia a animação de entrada
    void slide.offsetWidth;
    slide.classList.add("ativo");

    raiz.querySelector("#c-n").textContent = num(atual);
    raiz.querySelector("#c-nivel-txt").textContent = T(NIVEIS[a.nivel]);
    raiz.querySelector(".c-ant").disabled = atual === 0;
    raiz.querySelector(".c-prox").disabled = atual === TOTAL;
    Array.prototype.forEach.call(raiz.querySelectorAll(".c-progresso button"), function (bt, k) {
      bt.classList.toggle("feito", vistas().indexOf(k) >= 0);
      bt.setAttribute("aria-current", k === atual ? "step" : "false");
    });
    marcarVista(atual);
  }

  function ir(k, dir) {
    k = Math.max(0, Math.min(TOTAL, k));
    if (k === atual && dir !== 0) return;
    var d = dir == null ? (k > atual ? 1 : -1) : dir;
    atual = k;
    var alvo = k === 0 ? "#/" : "#/curso/" + k;
    if (location.hash !== alvo && !(k === 0 && (location.hash === "" || location.hash === "#"))) history.replaceState(null, "", alvo);
    fecharMenu();
    desenharAula(d);
    if (raiz.getBoundingClientRect().top < 0) raiz.scrollIntoView({ block: "start", behavior: reduzMovimento() ? "auto" : "smooth" });
  }

  // ---------------------------------------------------------------- menu de aulas

  function abrirMenu() {
    var m = raiz.querySelector(".c-menu"), v = vistas();
    m.innerHTML = '<div class="c-menu-in"><button type="button" class="c-fechar" aria-label="' + esc(L("Fechar", "Close")) + '">×</button>' +
      [1, 2, 3].map(function (nv) {
        return '<section><h2>' + esc(T(NIVEIS[nv])) + "</h2><ol>" + AULAS.map(function (a, k) {
          if (a.nivel !== nv) return "";
          return '<li><button type="button" data-aula="' + k + '"' + (k === atual ? ' aria-current="step"' : "") + '><span class="n">' + num(k) + '</span><span class="p">' + esc(T(a.palavra)) +
            '</span><span class="q">' + esc(T(a.pergunta)) + "</span>" + (v.indexOf(k) >= 0 ? '<span class="ok" aria-label="' + esc(L("vista", "seen")) + '">✓</span>' : "") + "</button></li>";
        }).join("") + "</ol></section>";
      }).join("") + "</div>";
    m.hidden = false;
    raiz.querySelector(".c-menu-btn").setAttribute("aria-expanded", "true");
    var b0 = m.querySelector('[aria-current="step"]') || m.querySelector("button[data-aula]");
    if (b0) b0.focus();
  }
  function fecharMenu() {
    var m = raiz && raiz.querySelector(".c-menu");
    if (!m || m.hidden) return;
    m.hidden = true;
    raiz.querySelector(".c-menu-btn").setAttribute("aria-expanded", "false");
  }

  // ---------------------------------------------------------------- partículas de fundo

  function iniciarParticulas(cv) {
    var ctx = cv.getContext("2d"), pts = [], dpr = Math.min(2, window.devicePixelRatio || 1), w = 0, h = 0;
    function medir() {
      w = cv.clientWidth; h = cv.clientHeight;
      cv.width = w * dpr; cv.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    medir();
    for (var k = 0; k < 70; k++) pts.push({ x: Math.random(), y: Math.random(), v: 0.00004 + Math.random() * 0.00012, l: 4 + Math.random() * 14, c: Math.random() < 0.55 ? 0 : 1, a: 0.15 + Math.random() * 0.45 });
    var cores = ["53,201,173", "240,105,92"];
    function quadro() {
      ctx.clearRect(0, 0, w, h);
      pts.forEach(function (p) {
        ctx.strokeStyle = "rgba(" + cores[p.c] + "," + p.a + ")";
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(p.x * w, p.y * h); ctx.lineTo(p.x * w + p.l, p.y * h); ctx.stroke();
      });
    }
    var vivo = true, ultimo = 0;
    function laco(t) {
      if (!vivo || !document.body.contains(cv)) { vivo = false; return; }
      if (!document.hidden) {
        var dt = Math.min(64, t - (ultimo || t)); ultimo = t;
        pts.forEach(function (p) { p.x += p.v * dt; if (p.x > 1.02) { p.x = -0.05; p.y = Math.random(); } });
        quadro();
      }
      requestAnimationFrame(laco);
    }
    window.addEventListener("resize", function () { if (vivo) { medir(); quadro(); } });
    if (reduzMovimento()) { quadro(); return { parar: function () { vivo = false; } }; }
    requestAnimationFrame(laco);
    return { parar: function () { vivo = false; } };
  }

  // ---------------------------------------------------------------- montagem

  function opcoesEmpresas() {
    return X.visiveis().filter(function (e) { return Object.keys(e.cotacao).length; })
      .sort(function (a, b2) { return (b2.valor_mercado || 0) - (a.valor_mercado || 0); })
      .map(function (e) { return '<option value="' + esc(e.ticker) + '"' + (e === empresa ? " selected" : "") + ">" + esc(e.ticker + " · " + X.nomeCurto(e.nome)) + "</option>"; }).join("");
  }

  function render(app) {
    X = window.RealTerms; L = X.L; esc = X.esc;
    document.title = X.t("titulo");
    if (particulas) particulas.parar();
    empresa = escolherEmpresa();
    var m = location.hash.match(/^#\/curso\/(\d+)/);
    atual = m ? Math.max(0, Math.min(TOTAL, +m[1])) : 0;

    app.innerHTML =
      '<section class="curso" aria-label="' + esc(L("Curso: do básico ao avançado", "Course: from the basics to advanced")) + '">' +
      '<div class="c-grade" aria-hidden="true"><i></i><i></i><i></i><i></i></div>' +
      '<canvas class="c-particulas" aria-hidden="true"></canvas>' +
      '<div class="c-topo">' +
      '<div class="c-nivel"><span class="c-barra" aria-hidden="true"></span><span id="c-nivel-txt"></span></div>' +
      '<div class="c-contador" aria-label="' + esc(L("Aula", "Lesson")) + '"><b id="c-n">00</b><span class="c-traco" aria-hidden="true"></span><span>' + num(TOTAL) + "</span></div>" +
      '<div class="c-acoes">' +
      '<label class="c-exemplo"><span>' + esc(L("Exemplo", "Example")) + '</span><select id="c-empresa" aria-label="' + esc(L("Empresa de exemplo das aulas", "Example company for the lessons")) + '">' + opcoesEmpresas() + "</select></label>" +
      '<button type="button" class="c-menu-btn" aria-expanded="false" aria-haspopup="true"><span>' + esc(L("Aulas", "Lessons")) + '</span><i aria-hidden="true"></i></button>' +
      "</div></div>" +
      '<button type="button" class="c-seta c-ant" aria-label="' + esc(L("Aula anterior", "Previous lesson")) + '"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 12H5M11 6l-6 6 6 6"/></svg></button>' +
      '<button type="button" class="c-seta c-prox" aria-label="' + esc(L("Próxima aula", "Next lesson")) + '"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg></button>' +
      '<div class="c-slide" aria-live="polite"></div>' +
      '<nav class="c-progresso" aria-label="' + esc(L("Aulas do curso", "Course lessons")) + '">' + AULAS.map(function (a, k) {
        return '<button type="button" data-aula="' + k + '" class="n' + a.nivel + (k > 0 && AULAS[k - 1].nivel !== a.nivel ? " quebra" : "") + '" title="' + esc(num(k) + " · " + T(a.palavra)) + '" aria-label="' + esc(num(k) + " " + T(a.palavra)) + '"></button>';
      }).join("") + "</nav>" +
      '<p class="c-aviso">' + esc(X.t("rodape_aviso")) + "</p>" +
      '<div class="c-menu" hidden></div>' +
      "</section>";

    raiz = app.querySelector(".curso");
    particulas = iniciarParticulas(raiz.querySelector(".c-particulas"));

    raiz.querySelector(".c-ant").addEventListener("click", function () { ir(atual - 1, -1); });
    raiz.querySelector(".c-prox").addEventListener("click", function () { ir(atual + 1, 1); });
    raiz.querySelector(".c-menu-btn").addEventListener("click", function () { if (raiz.querySelector(".c-menu").hidden) abrirMenu(); else fecharMenu(); });
    raiz.addEventListener("click", function (ev) {
      var bt = ev.target.closest("[data-aula]");
      if (bt) { ir(+bt.getAttribute("data-aula")); return; }
      if (ev.target.closest(".c-fechar") || ev.target.classList.contains("c-menu")) { fecharMenu(); raiz.querySelector(".c-menu-btn").focus(); return; }
      var a = ev.target.closest('a[href^="#/curso/"]');
      if (a) { ev.preventDefault(); ir(+a.getAttribute("href").split("/")[2]); }
    });
    raiz.querySelector("#c-empresa").addEventListener("change", function (ev) {
      empresa = X.POR_TICKER[ev.target.value] || empresa;
      guardar(CHAVE_EMPRESA, empresa.ticker);
      desenharAula(0);
    });

    // deslizar no celular
    var x0 = null, y0 = null;
    raiz.addEventListener("touchstart", function (ev) { if (ev.touches.length === 1 && !ev.target.closest("select, .c-menu")) { x0 = ev.touches[0].clientX; y0 = ev.touches[0].clientY; } }, { passive: true });
    raiz.addEventListener("touchend", function (ev) {
      if (x0 == null) return;
      var dx = ev.changedTouches[0].clientX - x0, dy = ev.changedTouches[0].clientY - y0;
      x0 = null;
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) ir(atual + (dx < 0 ? 1 : -1), dx < 0 ? 1 : -1);
    });

    desenharAula(1);
  }

  // teclado: ← → entre aulas, Esc fecha o menu (só com o curso na tela)
  document.addEventListener("keydown", function (ev) {
    if (!raiz || !document.body.contains(raiz) || ev.altKey || ev.ctrlKey || ev.metaKey) return;
    if (ev.target.closest && ev.target.closest("input, select, textarea")) return;
    if (ev.key === "Escape") { fecharMenu(); return; }
    if (ev.key === "ArrowRight") { ev.preventDefault(); ir(atual + 1, 1); }
    else if (ev.key === "ArrowLeft") { ev.preventDefault(); ir(atual - 1, -1); }
  });
  window.addEventListener("resize", function () {
    if (raiz && document.body.contains(raiz)) { var h = raiz.querySelector(".c-palavra"); if (h) ajustarTitulo(h); }
  });

  window.RealTermsInicio = { render: render, aulas: function () { return AULAS; } };
  // app.js roda primeiro; se a página aberta é o início, desenha agora
  if (document.body.getAttribute("data-pagina") === "inicio") render(document.getElementById("app"));
})();
