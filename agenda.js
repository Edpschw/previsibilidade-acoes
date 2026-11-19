/* Real Terms — agenda de proventos (#/agenda): pagamentos de dividendos e JCP já aprovados.
 * Dados das fichas da B3 (data/agenda.js, gravado por scripts/processar.py); API window.RealTerms do app.js. */
(function () {
  "use strict";

  var filtro = { tipo: "", janela: 90, busca: "", liquidas: true };

  function render(app) {
    var X = window.RealTerms, D = X.D, L = X.L, esc = X.esc;
    document.title = X.t("nav_agenda") + " · Real Terms";
    var hoje = new Date().toISOString().slice(0, 10);

    // todos os pagamentos por vir, um item por ticker × evento
    var todos = [];
    X.EMPRESAS.forEach(function (e) {
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

    app.innerHTML =
      '<section class="mapa-cab"><span class="olho"><span class="capitulo">R$</span>' + esc(L("Agenda de proventos", "Dividend calendar")) + "</span>" +
      "<h1>" + esc(L("Quem paga, quanto e quando", "Who pays, how much and when")) + "</h1>" +
      '<p class="mudo">' + esc(L(
        "Dividendos e juros sobre capital próprio (JCP) já aprovados e ainda por pagar, segundo a B3. Recebe quem tinha a ação na data-com, que nesta lista já passou: a B3 publica o provento depois dela. O yield de cada evento usa a cotação de hoje.",
        "Dividends and interest on equity (JCP) already approved and not yet paid, according to B3. Shareholders of record on the record date get paid, and for these events that date has passed: B3 publishes each payment after it. Each event's yield uses today's price.")) + "</p></section>" +
      '<div class="mapa-controles">' +
      '<label><span>' + esc(L("Tipo", "Type")) + '</span><select id="a-tipo"><option value="">' + esc(L("Todos", "All")) + '</option><option value="dividendo">' + esc(nomeTipo("dividendo")) + '</option><option value="jcp">' + esc(nomeTipo("jcp")) + "</option></select></label>" +
      '<label><span>' + esc(L("Pagamento em até", "Paid within")) + '</span><select id="a-janela"><option value="30">30 ' + esc(L("dias", "days")) + '</option><option value="90">90 ' + esc(L("dias", "days")) + '</option><option value="365">' + esc(L("12 meses", "12 months")) + '</option><option value="0">' + esc(L("Qualquer data", "Any date")) + "</option></select></label>" +
      '<label><span>' + esc(L("Buscar", "Search")) + '</span><input id="a-busca" type="search" placeholder="ITUB4" autocomplete="off" spellcheck="false"></label>' +
      '<label class="check"><input type="checkbox" id="a-liq"> ' + esc(L("Só líquidas (≥ R$ 1 mi/dia)", "Liquid only (≥ R$ 1M/day)")) + "</label>" +
      '</div><div id="a-resumo" class="i-stats agenda-resumo"></div><div id="a-lista"></div>' +
      '<p class="aviso">' + esc(L(
        "O imposto retido na fonte varia com o tipo de provento e a residência do investidor (o JCP sempre tem retenção); confirme com seu custodiante. Datas e valores como publicados pela B3; a empresa pode alterá-los.",
        "Withholding tax depends on the payment type and the investor's residence (interest on equity is always subject to it); check with your custodian. Dates and amounts as published by B3; companies may change them.")) + "</p>";

    $("#a-tipo").value = filtro.tipo;
    $("#a-janela").value = String(filtro.janela);
    $("#a-busca").value = filtro.busca;
    $("#a-liq").checked = filtro.liquidas;
    $("#a-tipo").addEventListener("change", function (ev) { filtro.tipo = ev.target.value; lista(); });
    $("#a-janela").addEventListener("change", function (ev) { filtro.janela = +ev.target.value; lista(); });
    $("#a-busca").addEventListener("input", function (ev) { filtro.busca = ev.target.value.trim().toUpperCase(); lista(); });
    $("#a-liq").addEventListener("change", function (ev) { filtro.liquidas = ev.target.checked; lista(); });
    $("#a-lista").addEventListener("click", function (ev) {
      var a = ev.target.closest("[data-t]");
      if (a) location.hash = "#/" + a.getAttribute("data-t");
    });

    function lista() {
      var limite = filtro.janela ? new Date(Date.now() + filtro.janela * 864e5).toISOString().slice(0, 10) : "9999";
      var itens = todos.filter(function (it) {
        return (!filtro.tipo || it.x.tipo === filtro.tipo) && it.x.pag <= limite &&
          (!filtro.liquidas || it.e.liquidez >= 1e6) &&
          (!filtro.busca || it.x.t.indexOf(filtro.busca) === 0 || X.nomeCurto(it.e.nome).toUpperCase().indexOf(filtro.busca) >= 0);
      }).sort(function (a, b) { return a.x.pag < b.x.pag ? -1 : a.x.pag > b.x.pag ? 1 : (b.yield || 0) - (a.yield || 0); });

      var empresas = {};
      itens.forEach(function (it) { empresas[it.e.cnpj] = 1; });
      var maior = itens.filter(function (it) { return it.yield != null; }).sort(function (a, b) { return b.yield - a.yield; })[0];
      var prox = itens[0];
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
      var html = "", mesAtual = "";
      itens.forEach(function (it) {
        var mes = it.x.pag.slice(0, 7);
        if (mes !== mesAtual) {
          if (mesAtual) html += "</div></section>";
          html += '<section class="cartao agenda-mes"><h2>' + esc(mesTitulo(it.x.pag)) + '</h2><div class="agenda-itens">';
          mesAtual = mes;
        }
        var d = dia(it.x.pag);
        html += '<a class="agenda-item" href="#/' + it.x.t + '" data-t="' + it.x.t + '">' +
          '<span class="agenda-dia"><b>' + d.n + "</b><small>" + esc(d.sem) + "</small></span>" +
          '<span class="agenda-quem"><b>' + it.x.t + "</b><small>" + esc(X.nomeCurto(it.e.nome)) + "</small></span>" +
          '<span class="selo-h ' + (it.x.tipo === "jcp" ? "" : "forte") + '">' + esc(nomeTipo(it.x.tipo)) + "</span>" +
          '<span class="agenda-num"><b class="num">' + moeda(it.x.valor) + "</b><small>" + esc(L("por ação", "per share")) + "</small></span>" +
          '<span class="agenda-num"><b class="num">' + (it.yield != null ? X.pct(it.yield, 2) : "–") + "</b><small>yield</small></span>" +
          '<span class="agenda-num mudo"><b class="num">' + esc(X.data(it.x.com)) + "</b><small>" + esc(L("data-com", "record date")) + "</small></span>" +
          "</a>";
      });
      $("#a-lista").innerHTML = html + "</div></section>";
    }
    lista();
  }

  function $(sel) { return document.querySelector(sel); }

  window.RealTermsAgenda = { render: render };
  if (document.body.getAttribute("data-pagina") === "agenda") render(document.getElementById("app"));
})();
