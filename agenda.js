/* Real Terms — agenda de proventos (#/agenda): pagamentos de dividendos e JCP já aprovados.
 * Dados das fichas da B3 (data/agenda.js, gravado por scripts/processar.py); API window.RealTerms do app.js.
 * Por padrão a lista é um ranking pelo maior yield; "Data de pagamento" agrupa por mês. */
(function () {
  "use strict";

  var filtro = { tipo: "", janela: 90, busca: "", ordem: "yield" };

  function render(app) {
    var X = window.RealTerms, D = X.D, L = X.L, esc = X.esc;
    document.title = X.t("nav_agenda") + " · Real Terms";
    var hoje = new Date().toISOString().slice(0, 10);

    // todos os pagamentos por vir, um item por ticker × evento
    var todos = [];
    X.visiveis().forEach(function (e) {  // com o filtro de setor, só as empresas do setor
      ((window.AGENDA && window.AGENDA.empresas[e.cnpj]) || []).forEach(function (x) {
        if (!x.pag || x.pag < hoje) return;
        var preco = (e.cotacao[x.t] || {}).preco;
        todos.push({ e: e, x: x, preco: preco, yield: preco ? x.valor / preco : null });
      });
    });

    var moeda = function (v) {
      if (v == null) return "–";
      var conv = X.estado.moeda === "usd" ? v / D.ptax_atual.valor : v;
      return (X.estado.moeda === "usd" ? "US$ " : "R$ ") + X.nf(conv < 0.1 ? 4 : 2).format(conv);
    };
    var nomeTipo = function (t) {
      return t === "dividendo" ? L("Dividendo", "Dividend") : t === "jcp" ? L("JCP", "Interest on equity") :
        t === "rendimento" ? L("Rendimento", "Income") : t === "restituicao" ? L("Restituição de capital", "Capital return") : t;
    };
    var mesTitulo = function (iso) {
      var d = new Date(iso + "T12:00:00Z");
      var s = d.toLocaleDateString(X.locale(), { month: "long", year: "numeric", timeZone: "UTC" });
      return s.charAt(0).toUpperCase() + s.slice(1);
    };
    var dia = function (iso) {
      var d = new Date(iso + "T12:00:00Z");
      return { n: d.getUTCDate(), sem: d.toLocaleDateString(X.locale(), { weekday: "short", timeZone: "UTC" }) };
    };
    var limiteDe = function (janela) { return janela ? new Date(Date.now() + janela * 864e5).toISOString().slice(0, 10) : "9999"; };

    var pilulas = function (grupo, opcoes) {
      return '<div class="pilulas" role="group" data-grupo="' + grupo + '">' + opcoes.map(function (o) {
        return '<button type="button" data-valor="' + o[0] + '">' + esc(o[1]) + (o[2] != null ? ' <span class="conta" data-conta="' + o[0] + '"></span>' : "") + "</button>";
      }).join("") + "</div>";
    };

    app.innerHTML =
      '<section class="mapa-cab"><span class="olho"><span class="capitulo">R$</span>' + esc(L("Agenda de proventos", "Dividend calendar")) + "</span>" +
      "<h1>" + esc(L("Quem paga, quanto e quando", "Who pays, how much and when")) + "</h1>" +
      '<p class="mudo">' + esc(L(
        "Dividendos e juros sobre capital próprio (JCP) já aprovados e ainda por pagar, segundo a B3. Recebe quem tinha a ação na data-com, que nesta lista já passou: a B3 publica o provento depois dela. O yield de cada evento usa a cotação de hoje.",
        "Dividends and interest on equity (JCP) already approved and not yet paid, according to B3. Shareholders of record on the record date get paid, and for these events that date has passed: B3 publishes each payment after it. Each event's yield uses today's price.")) + "</p></section>" +
      '<section class="cartao filtros-card">' +
      '<div class="filtros-linha">' +
      '<label class="busca-local"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg>' +
      '<input id="a-busca" type="search" placeholder="' + esc(L("Buscar empresa ou ticker", "Search company or ticker")) + '" autocomplete="off" spellcheck="false" aria-label="' + esc(L("Buscar", "Search")) + '"></label>' +
      '<div class="filtro-grupo"><span class="filtro-rot">' + esc(L("Ordenar", "Sort")) + "</span>" +
      pilulas("ordem", [["yield", L("Maior yield", "Highest yield")], ["data", L("Data de pagamento", "Payment date")]]) + "</div>" +
      "</div>" +
      '<div class="filtros-linha">' +
      '<div class="filtro-grupo"><span class="filtro-rot">' + esc(L("Tipo", "Type")) + "</span>" +
      pilulas("tipo", [["", L("Todos", "All"), 1], ["dividendo", L("Dividendos", "Dividends"), 1], ["jcp", L("JCP", "Interest on equity"), 1]]) + "</div>" +
      '<div class="filtro-grupo"><span class="filtro-rot">' + esc(L("Pagamento em", "Paid within")) + "</span>" +
      pilulas("janela", [["30", L("30 dias", "30 days")], ["90", L("90 dias", "90 days")], ["365", L("12 meses", "12 months")], ["0", L("Tudo", "Any")]]) + "</div>" +
      "</div></section>" +
      '<div id="a-resumo" class="i-stats agenda-resumo"></div><div id="a-lista"></div>' +
      '<p class="aviso">' + esc(L(
        "O imposto retido na fonte varia com o tipo de provento e a residência do investidor (o JCP sempre tem retenção); confirme com seu custodiante. Datas e valores como publicados pela B3; a empresa pode alterá-los.",
        "Withholding tax depends on the payment type and the investor's residence (interest on equity is always subject to it); check with your custodian. Dates and amounts as published by B3; companies may change them.")) + "</p>";

    // ------------------------------------------------------------ controles
    function marcar() {
      Array.prototype.forEach.call(app.querySelectorAll(".pilulas"), function (g) {
        var atual = String(filtro[g.getAttribute("data-grupo")]);
        Array.prototype.forEach.call(g.querySelectorAll("button"), function (b) {
          b.setAttribute("aria-pressed", String(b.getAttribute("data-valor") === atual));
        });
      });
    }
    app.querySelector(".filtros-card").addEventListener("click", function (ev) {
      var b = ev.target.closest(".pilulas button");
      if (!b) return;
      var grupo = b.parentNode.getAttribute("data-grupo"), v = b.getAttribute("data-valor");
      filtro[grupo] = grupo === "janela" ? +v : v;
      marcar(); lista();
    });
    $("#a-busca").value = filtro.busca;
    $("#a-busca").addEventListener("input", function (ev) { filtro.busca = ev.target.value.trim().toUpperCase(); lista(); });
    $("#a-lista").addEventListener("click", function (ev) {
      var a = ev.target.closest("[data-t]");
      if (a) location.hash = "#/" + a.getAttribute("data-t");
    });
    marcar();

    // ------------------------------------------------------------ lista
    function passa(it, semTipo) {
      return (semTipo || !filtro.tipo || it.x.tipo === filtro.tipo) && it.x.pag <= limiteDe(filtro.janela) &&
        (!filtro.busca || it.x.t.indexOf(filtro.busca) === 0 || X.nomeCurto(it.e.nome).toUpperCase().indexOf(filtro.busca) >= 0);
    }

    function item(it, lead, comData) {
      return '<a class="agenda-item' + (comData ? " com-data" : "") + '" href="#/' + it.x.t + '" data-t="' + it.x.t + '">' + lead +
        '<span class="agenda-quem"><b>' + it.x.t + "</b><small>" + esc(X.nomeCurto(it.e.nome)) + "</small></span>" +
        '<span class="selo-h ' + (it.x.tipo === "jcp" ? "" : "forte") + '">' + esc(nomeTipo(it.x.tipo)) + "</span>" +
        '<span class="agenda-num destaque"><b class="num">' + (it.yield != null ? X.pct(it.yield, 2) : "–") + "</b><small>yield</small></span>" +
        '<span class="agenda-num a-valor"><b class="num">' + moeda(it.x.valor) + "</b><small>" + esc(L("por ação", "per share")) + "</small></span>" +
        (comData ? '<span class="agenda-num a-pag"><b class="num">' + esc(X.data(it.x.pag)) + "</b><small>" + esc(L("pagamento", "payment")) + "</small></span>" : "") +
        '<span class="agenda-num a-com mudo"><b class="num">' + esc(X.data(it.x.com)) + "</b><small>" + esc(L("data-com", "record date")) + "</small></span>" +
        "</a>";
    }

    function lista() {
      // contagem por tipo com os demais filtros aplicados
      ["", "dividendo", "jcp"].forEach(function (t) {
        var n = todos.filter(function (it) { return passa(it, true) && (!t || it.x.tipo === t); }).length;
        var alvo = app.querySelector('[data-conta="' + t + '"]');
        if (alvo) alvo.textContent = n;
      });

      var itens = todos.filter(function (it) { return passa(it); });
      if (filtro.ordem === "yield") {
        itens.sort(function (a, b) { return (b.yield == null ? -1 : b.yield) - (a.yield == null ? -1 : a.yield) || (a.x.pag < b.x.pag ? -1 : 1); });
      } else {
        itens.sort(function (a, b) { return a.x.pag < b.x.pag ? -1 : a.x.pag > b.x.pag ? 1 : (b.yield || 0) - (a.yield || 0); });
      }

      var empresas = {};
      itens.forEach(function (it) { empresas[it.e.cnpj] = 1; });
      var maior = itens.filter(function (it) { return it.yield != null; }).sort(function (a, b) { return b.yield - a.yield; })[0];
      var prox = itens.slice().sort(function (a, b) { return a.x.pag < b.x.pag ? -1 : 1; })[0];
      var st = function (v, r) { return '<div class="i-stat"><b class="num">' + v + "</b><span>" + esc(r) + "</span></div>"; };
      $("#a-resumo").innerHTML =
        st(itens.length, L("pagamentos no período", "payments in the period")) +
        st(Object.keys(empresas).length, L("empresas pagadoras", "paying companies")) +
        st(prox ? X.data(prox.x.pag) : "–", L("próximo pagamento", "next payment") + (prox ? " · " + prox.x.t : "")) +
        st(maior ? X.pct(maior.yield, 2) : "–", L("maior yield de um evento", "largest single-event yield") + (maior ? " · " + maior.x.t : ""));

      if (!itens.length) {
        $("#a-lista").innerHTML = '<div class="cartao vazio">' + esc(L("Nenhum pagamento com esses filtros.", "No payments match these filters.")) + "</div>";
        return;
      }
      if (filtro.ordem === "yield") {
        $("#a-lista").innerHTML = '<section class="cartao agenda-mes"><h2>' + esc(L("Ranking por yield", "Ranked by yield")) + '</h2><div class="agenda-itens">' +
          itens.map(function (it, k) { return item(it, '<span class="agenda-dia rank"><b>' + (k + 1) + "</b></span>", true); }).join("") + "</div></section>";
        return;
      }
      var html = "", mesAtual = "";
      itens.forEach(function (it) {
        var mes = it.x.pag.slice(0, 7);
        if (mes !== mesAtual) {
          if (mesAtual) html += "</div></section>";
          html += '<section class="cartao agenda-mes"><h2>' + esc(mesTitulo(it.x.pag)) + '</h2><div class="agenda-itens">';
          mesAtual = mes;
        }
        var d = dia(it.x.pag);
        html += item(it, '<span class="agenda-dia"><b>' + d.n + "</b><small>" + esc(d.sem) + "</small></span>", false);
      });
      $("#a-lista").innerHTML = html + "</div></section>";
    }
    lista();
  }

  function $(sel) { return document.querySelector(sel); }

  window.RealTermsAgenda = { render: render };
  if (document.body.getAttribute("data-pagina") === "agenda") render(document.getElementById("app"));
})();
