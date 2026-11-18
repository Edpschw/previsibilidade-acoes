/* Lastro — ranking e página da empresa a partir de window.DADOS (gerado por scripts/processar.py).
 * Valores na base estão em R$ mil. Em US$, fluxos usam a PTAX média do ano e saldos de balanço a PTAX do fim do ano. */
(function () {
  "use strict";

  var D = window.DADOS;
  var EMPRESAS = D.empresas;
  var POR_TICKER = {};
  EMPRESAS.forEach(function (e) { e.tickers.forEach(function (t) { POR_TICKER[t] = e; }); });

  var SALDOS = { ativo_total: 1, pl: 1, pl_controladora: 1, divida_bruta: 1, caixa: 1, divida_liquida: 1, valor_mercado: 1 };

  var estado = {
    moeda: ler("lastro-moeda") || "brl",
    ord: { col: "score", dir: -1 },
    filtros: { setor: "", controle: "", segmento: "", exterior: false, semFin: false, ativas: true },
    periodo: 10,
  };

  function ler(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function gravar(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* sem storage */ } }

  // ---------------------------------------------------------------- números

  function serie(e, chave) {
    var bruto = e.series[chave];
    if (estado.moeda === "brl" || chave === "acoes") return bruto;
    var tipo = SALDOS[chave] ? "fim" : "media";
    return bruto.map(function (v, i) {
      var p = D.ptax[String(e.anos[i])];
      return v == null || !p ? null : v / p[tipo];
    });
  }
  /** valor atual (cotação de hoje) em R$ → moeda da tela, pela PTAX mais recente */
  function hoje(v) { return v == null || estado.moeda === "brl" ? v : v / D.ptax_atual.valor; }
  /** fechamentos de fim de ano de um ticker na moeda da tela */
  function precosAno(e, t) {
    var p = e.precos_ano[t];
    if (!p) return null;
    return p.map(function (v, i) {
      if (v == null || estado.moeda === "brl") return v;
      var x = D.ptax[String(e.anos[i])];
      return x ? v / x.fim : null;
    });
  }
  function cotacaoDe(e, t) { return e.cotacao[t] || e.cotacao[e.ticker] || null; }
  function ultimo(arr) { return arr[arr.length - 1]; }
  function div(a, b) { return a == null || b == null || b === 0 ? null : a / b; }
  function simbolo() { return estado.moeda === "usd" ? "US$" : "R$"; }

  var NF = {};
  function nf(casas) {
    if (!NF[casas]) NF[casas] = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });
    return NF[casas];
  }

  /** valor em milhares → "R$ 12,3 bi" */
  function dinheiro(vMil, curto) {
    if (vMil == null || isNaN(vMil)) return "–";
    if (vMil === 0) return curto ? "0" : simbolo() + " 0";
    var v = vMil * 1000, a = Math.abs(v), s, suf;
    if (a >= 1e12) { s = v / 1e12; suf = " tri"; }
    else if (a >= 1e9) { s = v / 1e9; suf = " bi"; }
    else if (a >= 1e6) { s = v / 1e6; suf = " mi"; }
    else if (a >= 1e3) { s = v / 1e3; suf = " mil"; }
    else { s = v; suf = ""; }
    var casas = Math.abs(s) >= 100 ? 0 : Math.abs(s) >= 10 ? 1 : 2;
    return (curto ? "" : simbolo() + " ") + nf(casas).format(s) + suf;
  }
  function porAcao(v) { return v == null || !isFinite(v) ? "–" : simbolo() + " " + nf(2).format(v); }
  function pct(v, casas) { return v == null || !isFinite(v) ? "–" : nf(casas == null ? 1 : casas).format(v * 100) + "%"; }
  function vezes(v) { return v == null || !isFinite(v) ? "–" : nf(2).format(v) + "x"; }
  function classe(v) { return v == null ? "" : v < 0 ? "neg" : ""; }

  function cagr(arr, n) {
    var fim = arr.length - 1, ini = fim - n;
    if (ini < 0) return null;
    var a = arr[ini], b = arr[fim];
    if (a == null || b == null || a <= 0 || b <= 0) return null;
    return Math.pow(b / a, 1 / n) - 1;
  }

  /** múltiplos: sempre calculados em R$ (razões não dependem da moeda) */
  function multiplos(e, vm, k) {
    var s = e.series, at = function (c) { return s[c][k]; };
    var lc = at("lucro_controladora"), pl = at("pl_controladora"), ebitda = at("ebitda"), dl = at("divida_liquida");
    var dvd = at("dividendos_pagos");
    return {
      pl: vm && lc > 0 ? vm / lc : null,
      pvp: vm && pl > 0 ? vm / pl : null,
      dy: vm && dvd != null ? dvd / vm : null,
      evEbitda: !e.financeiro && vm && ebitda > 0 && dl != null ? (vm + dl) / ebitda : null,
      psr: !e.financeiro && vm && at("receita") > 0 ? vm / at("receita") : null,
    };
  }

  /** múltiplos e retornos dos últimos 12 meses (DFP + ITR); null se a empresa não tem ITR recente */
  function doze(e) {
    var t = e.ttm, vm = e.valor_mercado;
    if (!t) return null;
    var lc = t.lucro_controladora, plc = t.pl_controladora, eb = t.ebitda, dl = t.divida_liquida, rec = t.receita;
    var conv = function (v) {
      if (v == null || estado.moeda === "brl") return v;
      var p = D.ptax[t.ate.slice(0, 4)];
      return p ? v / p.media : null;
    };
    return {
      ate: t.ate,
      pl: vm && lc > 0 ? vm / lc : null,
      pvp: vm && plc > 0 ? vm / plc : null,
      evEbitda: !e.financeiro && vm && eb > 0 && dl != null ? (vm + dl) / eb : null,
      psr: !e.financeiro && vm && rec > 0 ? vm / rec : null,
      roe: plc > 0 && lc != null ? lc / plc : null,
      mLiq: rec > 0 && t.lucro_liquido != null ? t.lucro_liquido / rec : null,
      dlEbitda: e.financeiro || !(eb > 0) || dl == null ? null : dl / eb,
      receita: conv(rec), lucro: conv(t.lucro_liquido), dividendos: conv(t.dividendos_pagos),
    };
  }

  /** indicadores do último exercício na moeda atual */
  function indicadores(e) {
    var r = serie(e, "receita"), ll = serie(e, "lucro_liquido"), lc = serie(e, "lucro_controladora");
    var pl = serie(e, "pl_controladora"), ebitda = serie(e, "ebitda"), dl = serie(e, "divida_liquida");
    var acoes = ultimo(e.series.acoes);
    var fco = ultimo(serie(e, "fco")), capex = ultimo(serie(e, "capex")), dvd = ultimo(serie(e, "dividendos_pagos"));
    var m = multiplos(e, e.valor_mercado, e.anos.length - 1), cot = cotacaoDe(e, e.ticker);
    return {
      preco: cot ? hoje(cot.preco) : null,
      vm: hoje(e.valor_mercado),
      liquidez: hoje(e.liquidez),
      // múltiplos sobre os últimos 12 meses quando há ITR; senão, sobre o último exercício
      d12: doze(e),
      pl: (doze(e) || m).pl, pvp: (doze(e) || m).pvp, evEbitda: (doze(e) || m).evEbitda, psr: (doze(e) || m).psr,
      roe12: doze(e) ? doze(e).roe : null, mLiq12: doze(e) ? doze(e).mLiq : null, dlEbitda12: doze(e) ? doze(e).dlEbitda : null,
      // DY de 12 meses pelos proventos com data-com na B3; sem ficha, cai no pago no exercício (DFP)
      dy: e.proventos_12m != null && e.valor_mercado ? e.proventos_12m / e.valor_mercado : m.dy,
      dyExercicio: m.dy,
      ano: ultimo(e.anos),
      receita: ultimo(r),
      lucro: ultimo(ll),
      lucroC: ultimo(lc),
      lpa: acoes ? div(ultimo(lc) * 1000, acoes) : null,
      vpa: acoes ? div(ultimo(pl) * 1000, acoes) : null,
      dpa: acoes && dvd != null ? dvd * 1000 / acoes : null,
      roe: ultimo(pl) > 0 ? div(ultimo(lc), ultimo(pl)) : null,
      roa: div(ultimo(ll), ultimo(serie(e, "ativo_total"))),
      mBruta: e.financeiro ? null : div(ultimo(serie(e, "lucro_bruto")), ultimo(r)),
      mEbit: e.financeiro ? null : div(ultimo(serie(e, "ebit")), ultimo(r)),
      mEbitda: e.financeiro ? null : div(ultimo(ebitda), ultimo(r)),
      mLiq: div(ultimo(ll), ultimo(r)),
      dlEbitda: e.financeiro || !(ultimo(ebitda) > 0) ? null : div(ultimo(dl), ultimo(ebitda)),
      dlPl: e.financeiro || !(ultimo(pl) > 0) ? null : div(ultimo(dl), ultimo(pl)),
      dividaLiq: e.financeiro ? null : ultimo(dl),
      payout: ultimo(lc) > 0 && dvd != null ? dvd / ultimo(lc) : null,
      fcl: !e.financeiro && fco != null ? fco - (capex || 0) : null, // caixa operacional de banco mistura depósitos e crédito
      cagrRec: cagr(r, 5),
      cagrLuc: cagr(lc, 5),
    };
  }

  function score(e) { return e.score[estado.moeda]; }
  function nivelScore(v) {
    if (v == null) return { txt: "Sem histórico", cor: "var(--muted)" };
    if (v >= 75) return { txt: "Alta", cor: "var(--pos)" };
    if (v >= 50) return { txt: "Média", cor: "var(--warn)" };
    return { txt: "Baixa", cor: "var(--neg)" };
  }

  // ---------------------------------------------------------------- utilidades de DOM

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function $(sel, raiz) { return (raiz || document).querySelector(sel); }
  function $$(sel, raiz) { return Array.prototype.slice.call((raiz || document).querySelectorAll(sel)); }
  function nomeCurto(n) {
    return n.replace(/\s+(S\.?\/?A\.?|S\/A|SA)\b.*$/i, "").replace(/\s+-\s+em Recupera.*$/i, "")
      .toLowerCase().replace(/(^|[\s.(/-])([a-zà-ú])/g, function (m, a, b) { return a + b.toUpperCase(); })
      .replace(/\b(De|Da|Do|Das|Dos|E)\b/g, function (m) { return m.toLowerCase(); });
  }
  function dataBR(iso) { return iso ? iso.slice(8, 10) + "/" + iso.slice(5, 7) + "/" + iso.slice(0, 4) : "–"; }
  function setorCurto(s) { return s.replace(/^Emp\. Adm\. Part\. - /, "").replace(/^Emp\. Adm\. Part\.-/, ""); }

  // ---------------------------------------------------------------- ranking

  var COLUNAS = [
    { id: "ticker", rot: "Ação", esq: true, val: function (e) { return e.ticker; } },
    { id: "setor", rot: "Setor", esq: true, val: function (e) { return setorCurto(e.setor); } },
    { id: "score", rot: "Previsibilidade", val: function (e) { var s = score(e); return s ? s.total : null; } },
    { id: "preco", rot: "Cotação", val: function (e, i) { return i.preco; }, fmt: porAcao },
    { id: "vm", rot: "Valor de mercado", val: function (e, i) { return i.vm; }, fmt: function (v) { return dinheiro(v); } },
    { id: "pl", rot: "P/L", val: function (e, i) { return i.pl; }, fmt: vezes },
    { id: "pvp", rot: "P/VP", val: function (e, i) { return i.pvp; }, fmt: vezes },
    { id: "dy", rot: "DY", val: function (e, i) { return i.dy; }, fmt: function (v) { return pct(v); } },
    { id: "roe", rot: "ROE 12m", val: function (e, i) { return i.d12 ? i.roe12 : i.roe; }, fmt: function (v) { return pct(v); } },
    { id: "mLiq", rot: "Marg. líq. 12m", val: function (e, i) { return i.d12 ? i.mLiq12 : i.mLiq; }, fmt: function (v) { return pct(v); } },
    { id: "dlEbitda", rot: "Dív.líq./EBITDA", val: function (e, i) { return i.d12 ? i.dlEbitda12 : i.dlEbitda; }, fmt: vezes },
    { id: "liquidez", rot: "Liquidez/dia", val: function (e, i) { return i.liquidez; }, fmt: function (v) { return v ? dinheiro(v / 1000) : "–"; } },
  ];

  function opcoes(campo, rotulo) {
    var vals = {};
    EMPRESAS.forEach(function (e) { var v = campo === "setor" ? setorCurto(e.setor) : e[campo]; vals[v] = (vals[v] || 0) + 1; });
    return '<option value="">' + rotulo + "</option>" + Object.keys(vals).sort(function (a, b) { return a.localeCompare(b, "pt"); })
      .map(function (v) { return '<option value="' + esc(v) + '">' + esc(v) + " (" + vals[v] + ")</option>"; }).join("");
  }

  function telaRanking() {
    document.title = "Lastro · Ações brasileiras";
    var app = $("#app");
    app.innerHTML =
      '<section class="intro"><h1>Ações brasileiras pelos fundamentos</h1>' +
      "<p></p></section>";
    var anoIni = Math.min.apply(null, EMPRESAS.map(function (e) { return e.anos[0]; }));
    $(".intro p", app).textContent = EMPRESAS.length + " empresas listadas na B3 com demonstrações anuais entregues à CVM de " + anoIni +
      " a " + D.ano_final + ". O índice de previsibilidade (0–100) mede a regularidade de lucro, margem, receita e dividendos nos últimos 10 anos. Clique numa linha para ver a empresa.";

    app.insertAdjacentHTML("beforeend",
      '<div class="filtros">' +
      '<select id="f-setor" aria-label="Setor">' + opcoes("setor", "Todos os setores") + "</select>" +
      '<select id="f-segmento" aria-label="Segmento de listagem">' + opcoes("segmento", "Todos os segmentos") + "</select>" +
      '<select id="f-controle" aria-label="Controle acionário">' + opcoes("controle", "Qualquer controle") + "</select>" +
      '<label class="check"><input type="checkbox" id="f-exterior"> Negociada no exterior</label>' +
      '<label class="check"><input type="checkbox" id="f-semfin"> Ocultar financeiras</label>' +
      '<label class="check" title="Esconde empresas sem negócio na B3 no último mês (deslistadas ou sem liquidez)"><input type="checkbox" id="f-ativas"> Só negociadas no último mês</label>' +
      '<span class="contagem" id="contagem"></span></div>' +
      '<div class="tabela-wrap"><table id="ranking"><thead><tr>' +
      COLUNAS.map(function (c) { return '<th data-ord="' + c.id + '"' + (c.esq ? ' class="esq"' : "") + ">" + c.rot + "</th>"; }).join("") +
      "</tr></thead><tbody></tbody></table></div>");

    var f = estado.filtros;
    $("#f-setor").value = f.setor; $("#f-segmento").value = f.segmento; $("#f-controle").value = f.controle;
    $("#f-exterior").checked = f.exterior; $("#f-semfin").checked = f.semFin; $("#f-ativas").checked = f.ativas;
    ["setor", "segmento", "controle"].forEach(function (k) {
      $("#f-" + k).addEventListener("change", function (ev) { f[k] = ev.target.value; corpoRanking(); });
    });
    $("#f-exterior").addEventListener("change", function (ev) { f.exterior = ev.target.checked; corpoRanking(); });
    $("#f-semfin").addEventListener("change", function (ev) { f.semFin = ev.target.checked; corpoRanking(); });
    $("#f-ativas").addEventListener("change", function (ev) { f.ativas = ev.target.checked; corpoRanking(); });
    $$("#ranking th[data-ord]").forEach(function (th) {
      th.addEventListener("click", function () {
        var col = th.getAttribute("data-ord");
        estado.ord = { col: col, dir: estado.ord.col === col ? -estado.ord.dir : (col === "ticker" || col === "setor" ? 1 : -1) };
        corpoRanking();
      });
    });
    $("#ranking tbody").addEventListener("click", function (ev) {
      var tr = ev.target.closest("tr[data-t]");
      if (tr) location.hash = "#/" + tr.getAttribute("data-t");
    });
    corpoRanking();
  }

  function corpoRanking() {
    var f = estado.filtros;
    var linhas = EMPRESAS.filter(function (e) {
      return (!f.setor || setorCurto(e.setor) === f.setor) && (!f.segmento || e.segmento === f.segmento) &&
        (!f.controle || e.controle === f.controle) && (!f.exterior || e.exterior.length) && (!f.semFin || !e.financeiro) &&
        (!f.ativas || Object.keys(e.cotacao).length);
    }).map(function (e) { return { e: e, i: indicadores(e) }; });

    var col = COLUNAS.filter(function (c) { return c.id === estado.ord.col; })[0];
    linhas.sort(function (a, b) {
      var va = col.val(a.e, a.i), vb = col.val(b.e, b.i);
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      if (typeof va === "string") return estado.ord.dir * va.localeCompare(vb, "pt");
      return estado.ord.dir * (va - vb);
    });

    $$("#ranking th").forEach(function (th) {
      th.setAttribute("aria-sort", th.getAttribute("data-ord") === estado.ord.col ? (estado.ord.dir > 0 ? "ascending" : "descending") : "none");
    });
    $("#contagem").textContent = linhas.length + " empresas · cotações de " + dataBR(D.cotacoes_em) + ", balanços de " + D.ano_final +
      (estado.moeda === "usd" ? " · em US$" : " · em R$");

    $("#ranking tbody").innerHTML = linhas.length ? linhas.map(function (l) {
      var e = l.e, i = l.i, s = score(e), nv = nivelScore(s && s.total);
      var ext = e.exterior.length ? ' <span class="selo" title="Também negociada em: ' + esc(e.exterior.join(", ")) + '">ADR</span>' : "";
      var ano = i.ano < D.ano_final ? ' <span class="selo" title="Último exercício disponível">' + i.ano + "</span>" : "";
      return '<tr data-t="' + e.ticker + '">' +
        '<td><div class="tk"><b>' + e.ticker + ext + ano + "</b><span>" + esc(nomeCurto(e.nome)) + "</span></div></td>" +
        '<td class="esq setor-cel" title="' + esc(e.setor) + '">' + esc(setorCurto(e.setor)) + "</td>" +
        "<td>" + (s ? '<span class="barra-score" title="' + nv.txt + '"><i style="--w:' + s.total + "%;--cor:" + nv.cor + '"></i><b>' + s.total + "</b></span>" : '<span class="mudo">–</span>') + "</td>" +
        COLUNAS.slice(3).map(function (c) { var v = c.val(e, i); return '<td class="num ' + classe(v) + '">' + c.fmt(v) + "</td>"; }).join("") +
        "</tr>";
    }).join("") : '<tr><td colspan="' + COLUNAS.length + '" class="vazio">Nenhuma empresa com esses filtros.</td></tr>';
  }

  // ---------------------------------------------------------------- empresa

  var COMPONENTES = [
    { id: "lucro", nome: "Lucro positivo", peso: 30, desc: "Fração dos anos com lucro líquido acima de zero." },
    { id: "margem", nome: "Margem estável", peso: 25, desc: "Quanto menos a margem líquida oscila, maior a nota. Desvio de 15 p.p. ou mais zera." },
    { id: "receita", nome: "Receita estável", peso: 15, desc: "Oscilação do crescimento anual da receita. Desvio de 30 p.p. ou mais zera." },
    { id: "tendencia", nome: "Crescimento constante", peso: 15, desc: "Quanto a receita segue uma reta ascendente (R²). Tendência de queda zera." },
    { id: "dividendos", nome: "Dividendos regulares", peso: 15, desc: "Fração dos anos com dividendos ou JCP pagos." },
  ];

  function telaEmpresa(ticker) {
    var e = POR_TICKER[ticker];
    var app = $("#app");
    if (!e) {
      app.innerHTML = '<a class="voltar" href="#/">← Todas as empresas</a><div class="cartao vazio">Ticker <b>' + esc(ticker) + "</b> não encontrado na base.</div>";
      return;
    }
    document.title = ticker + " · " + nomeCurto(e.nome) + " · Lastro";
    estado.ticker = ticker;
    var i = indicadores(e), s = score(e), nv = nivelScore(s && s.total), cot = cotacaoDe(e, ticker);
    var raio = 33, circ = 2 * Math.PI * raio;

    var cab =
      '<a class="voltar" href="#/">← Todas as empresas</a>' +
      '<section class="cartao cab-empresa"><div>' +
      "<h1>" + esc(nomeCurto(e.nome)) + "</h1>" +
      '<div class="tickers">' + e.tickers.map(function (t) { return '<a class="chip' + (t === ticker ? " ativo" : "") + '" href="#/' + t + '">' + t + "</a>"; }).join("") + "</div>" +
      (cot ? '<div class="preco-linha"><span class="preco num">' + porAcao(hoje(cot.preco)) + "</span>" +
        '<span class="mudo">' + ticker + " · fechamento de " + dataBR(cot.data) +
        (e.cotacao[ticker] ? "" : " (sem negócio no período; preço de " + e.ticker + ")") +
        " · valor de mercado <b>" + dinheiro(i.vm) + "</b> · liquidez média <b>" + dinheiro(i.liquidez / 1000) + "/dia</b></span></div>"
        : '<div class="preco-linha mudo">Sem negócios na B3 no último mês.</div>') +
      '<div class="meta">' +
      "<span>Setor <b>" + esc(setorCurto(e.setor)) + "</b></span>" +
      "<span>Segmento <b>" + esc(e.segmento) + "</b></span>" +
      "<span>Controle <b>" + esc(e.controle) + "</b></span>" +
      (e.exterior.length ? "<span>Também negociada em <b>" + esc(e.exterior.join(", ")) + "</b></span>" : "") +
      (e.individual ? '<span title="A empresa não tem controladas e publica só a demonstração individual"><b>Demonstração individual</b></span>' : "") +
      (e.site ? '<span><a href="' + esc(/^https?:/.test(e.site) ? e.site : "https://" + e.site) + '" target="_blank" rel="noopener">' + esc(e.site.replace(/^https?:\/\//, "")) + " ↗</a></span>" : "") +
      "</div></div>" +
      '<div class="score-box"><svg class="anel" viewBox="0 0 78 78" aria-hidden="true"><circle class="fundo" cx="39" cy="39" r="' + raio + '"/>' +
      (s ? '<circle cx="39" cy="39" r="' + raio + '" stroke="' + nv.cor + '" stroke-dasharray="' + (circ * s.total / 100) + " " + circ + '" stroke-linecap="round" transform="rotate(-90 39 39)"/>' : "") +
      "<text x=\"39\" y=\"40\">" + (s ? s.total : "–") + "</text></svg>" +
      '<div><div class="rot">Previsibilidade</div><div class="nivel" style="color:' + nv.cor + '">' + nv.txt + "</div>" +
      '<div class="mudo" style="font-size:12.5px">' + (s ? s.anos[0] + "–" + s.anos[1] + ", em " + simbolo() : "menos de 5 anos de dados") + "</div></div></div>" +
      "</section>";

    var valuation = [
      ["P/L", vezes(i.pl), "Valor de mercado / lucro da controladora " + (i.d12 ? "dos 12 meses até " + dataBR(i.d12.ate) : "de " + i.ano)],
      ["P/VP", vezes(i.pvp), "Valor de mercado / patrimônio da controladora " + (i.d12 ? "em " + dataBR(i.d12.ate) : "no fim de " + i.ano)],
      ["DY 12 meses", pct(i.dy), e.proventos_12m != null ? "Proventos em dinheiro com data-com nos últimos 12 meses (B3) / valor de mercado" : "Sem ficha na B3: dividendos e JCP pagos em " + i.ano + " / valor de mercado"],
      ["DY do exercício", pct(i.dyExercicio), "Dividendos e JCP pagos em " + i.ano + " (fluxo de caixa da DFP) / valor de mercado atual"],
      ["EV/EBITDA", vezes(i.evEbitda), "(Valor de mercado + dívida líquida) / EBITDA" + (i.d12 ? " dos últimos 12 meses" : "")],
      ["P/Receita", vezes(i.psr), "Valor de mercado / receita" + (i.d12 ? " dos últimos 12 meses" : "")],
      ["Valor de mercado", dinheiro(i.vm), (e.acoes_b3 ? "Ações ON e PN atuais segundo a B3, sem tesouraria," : "Ações ON e PN da DFP de " + i.ano + ",") + " × cotação de cada classe"],
    ];
    var cards = [
      ["Receita", dinheiro(i.receita), "Receita líquida do exercício"],
      ["Lucro líquido", dinheiro(i.lucro), "Lucro consolidado, inclui minoritários"],
      ["LPA", porAcao(i.lpa), "Lucro da controladora por ação em circulação"],
      ["VPA", porAcao(i.vpa), "Patrimônio da controladora por ação"],
      ["ROE", pct(i.roe), "Lucro da controladora / patrimônio da controladora"],
      ["ROA", pct(i.roa), "Lucro líquido / ativo total"],
      ["Margem bruta", pct(i.mBruta), "Resultado bruto / receita"],
      ["Margem EBIT", pct(i.mEbit), "Resultado antes do financeiro / receita"],
      ["Margem EBITDA", pct(i.mEbitda), "EBIT + depreciação e amortização do fluxo de caixa"],
      ["Margem líquida", pct(i.mLiq), "Lucro líquido / receita"],
      ["Dív. líquida", dinheiro(i.dividaLiq), "Empréstimos e financiamentos − caixa e aplicações"],
      ["Dív. líq./EBITDA", vezes(i.dlEbitda), "Anos de geração operacional para quitar a dívida líquida"],
      ["Dív. líq./PL", vezes(i.dlPl), "Dívida líquida / patrimônio da controladora"],
      ["Dividendos pagos", dinheiro(ultimo(serie(e, "dividendos_pagos"))), "Dividendos e JCP pagos no ano (caixa)"],
      ["Dividendo/ação", porAcao(i.dpa), "Dividendos e JCP pagos no ano / ações em circulação"],
      ["Payout (caixa)", pct(i.payout, 0), "Dividendos pagos no ano / lucro da controladora do ano"],
      ["Fluxo de caixa livre", dinheiro(i.fcl), "Caixa operacional − investimento em imobilizado e intangível"],
      ["CAGR receita 5a", pct(i.cagrRec), "Crescimento anual composto da receita em 5 anos"],
      ["CAGR lucro 5a", pct(i.cagrLuc), "Crescimento anual composto do lucro em 5 anos"],
    ];
    var cartoes = function (lista) {
      return '<div class="grade-ind">' + lista.map(function (c) {
        return '<div class="ind"><div class="r"><abbr title="' + esc(c[2]) + '">' + c[0] + '</abbr></div><div class="v ' + (!/^Dív/.test(c[0]) && /^-|^R\$ -|^US\$ -/.test(c[1]) ? "neg" : "") + '">' + c[1] + "</div></div>";
      }).join("") + "</div>";
    };
    var doze12 = i.d12 ? [
      ["Receita 12m", dinheiro(i.d12.receita), "Receita dos 12 meses até " + dataBR(i.d12.ate) + " (DFP + ITR)"],
      ["Lucro 12m", dinheiro(i.d12.lucro), "Lucro líquido dos 12 meses até " + dataBR(i.d12.ate)],
      ["Margem líquida 12m", pct(i.d12.mLiq), "Lucro / receita dos últimos 12 meses"],
      ["ROE 12m", pct(i.d12.roe), "Lucro da controladora 12m / patrimônio da controladora em " + dataBR(i.d12.ate)],
      ["Dív. líq./EBITDA 12m", vezes(i.d12.dlEbitda), "Dívida líquida em " + dataBR(i.d12.ate) + " / EBITDA dos últimos 12 meses"],
      ["Dividendos pagos 12m", dinheiro(i.d12.dividendos), "Dividendos e JCP pagos nos 12 meses (fluxo de caixa)"],
    ] : null;
    var grade = '<section class="cartao"><div class="cab-secao"><h2>Valuation</h2>' +
      '<span class="mudo" style="font-size:13px">Cotação de ' + dataBR(cot && cot.data) + " sobre " +
      (i.d12 ? "os 12 meses até " + dataBR(i.d12.ate) : "o balanço de " + i.ano) + "</span></div>" + cartoes(valuation) +
      (doze12 ? '<h3 style="margin:16px 0 10px">Últimos 12 meses</h3>' + cartoes(doze12) : "") +
      '</section><section class="cartao"><div class="cab-secao"><h2>Fundamentos de ' + i.ano + "</h2>" +
      '<span class="mudo" style="font-size:13px">' + (estado.moeda === "usd" ? "Convertidos pela PTAX" : "Em reais") + "</span></div>" + cartoes(cards) +
      (e.financeiro ? '<p class="aviso">Para bancos e seguradoras, margens operacionais e dívida não se aplicam da mesma forma e ficam em branco.</p>' : "") + "</section>";

    var comp = '<section class="cartao"><h2>Como sai o índice</h2><div class="comp">' + (s ? COMPONENTES.map(function (c) {
      var v = s.componentes[c.id];
      if (v == null) {
        return '<div class="comp-item"><span class="nome">' + c.nome + '</span><span class="peso">sem dado · peso redistribuído</span>' +
          '<span class="trilho"></span><span class="desc">A empresa não detalha o fluxo de financiamento na DFP.</span></div>';
      }
      return '<div class="comp-item"><span class="nome">' + c.nome + '</span><span class="peso num">' + v + "/100 · peso " + c.peso + "</span>" +
        '<span class="trilho"><i style="width:' + v + '%"></i></span><span class="desc">' + c.desc + "</span></div>";
    }).join("") : '<p class="mudo">Precisa de pelo menos 5 anos de receita e lucro.</p>') + "</div></section>";

    var periodo = '<div class="seg" role="group" aria-label="Período">' + [[5, "5a"], [10, "10a"], [0, "Tudo"]].map(function (p) {
      return '<button data-periodo="' + p[0] + '" aria-pressed="' + (estado.periodo === p[0]) + '">' + p[1] + "</button>";
    }).join("") + "</div>";

    var graficos =
      '<div class="duas bloco">' +
      '<section class="cartao"><h2>Cotação de ' + ticker + ' no fim de cada ano</h2><div class="grafico" id="g-cotacao"></div>' +
      '<p class="aviso">Sem ajuste por desdobramentos e grupamentos: saltos bruscos podem ser eventos societários.</p></section>' +
      '<section class="cartao"><h2>P/L e P/VP no fim de cada ano</h2><div class="grafico" id="g-multiplos"></div>' +
      '<p class="aviso">Anos com prejuízo ficam sem P/L. Antes de 2020 a CVM não publica a quantidade de ações na DFP; ela é estimada pelo LPA declarado.</p></section></div>' +
      '<div class="duas bloco">' +
      '<section class="cartao"><h2>Receita e lucro</h2><div class="grafico" id="g-resultado"></div></section>' + comp + "</div>" +
      '<div class="duas bloco">' +
      '<section class="cartao"><h2>Margens</h2><div class="grafico" id="g-margens"></div></section>' +
      '<section class="cartao"><h2>' + (e.financeiro ? "Patrimônio líquido" : "Dívida líquida e EBITDA") + '</h2><div class="grafico" id="g-divida"></div></section></div>' +
      '<div class="duas bloco">' +
      '<section class="cartao"><h2>Fluxo de caixa</h2><div class="grafico" id="g-caixa"></div></section>' +
      '<section class="cartao"><h2>Dividendos e JCP pagos</h2><div class="grafico" id="g-dividendos"></div></section></div>';

    app.innerHTML = cab + '<div class="bloco" style="margin-top:16px">' + grade + "</div>" +
      '<div class="cab-secao bloco" style="margin-top:24px"><h2>Histórico</h2>' + periodo + "</div>" + graficos +
      '<section class="cartao bloco"><h2>Demonstrações resumidas</h2><div class="tabela-wrap" id="t-dem"></div></section>' +
      '<section class="cartao bloco metodo"><details><summary>Metodologia e limitações</summary><ul>' +
      "<li>Dados consolidados da DFP. Quando a empresa reapresenta, vale a última versão entregue; um ano sem DFP própria usa a coluna de comparação do ano seguinte.</li>" +
      "<li>Contas localizadas pelo nome no plano de contas da CVM, porque o código varia entre empresas e setores.</li>" +
      "<li>EBITDA = resultado antes do financeiro + depreciação, amortização e exaustão lançadas no fluxo de caixa. Dívida = empréstimos e financiamentos (inclui debêntures e, em geral, arrendamentos).</li>" +
      "<li>Dividendos pelo regime de caixa (pagos no ano), por isso o payout pode passar de 100% num ano e ficar baixo no outro.</li>" +
      "<li>Em US$, resultado e fluxo usam a PTAX média do ano; balanço usa a PTAX do último dia útil. O índice em US$ é recalculado com receita e lucro convertidos, o que capta o efeito do câmbio.</li>" +
      "<li>Tickers e quantidade atual de ações vêm da B3 (lista de emissores e ficha de cada empresa); setor, controle e composição de units, do formulário cadastral da CVM. Empresas sem controladas publicam só a demonstração individual, usada no lugar da consolidada.</li>" +
      "<li>Valor de mercado atual = ações ON e PN informadas pela B3, menos a tesouraria do último balanço, × cotação de cada classe. No histórico, ações da DFP do ano (antes de 2020, estimadas pelo LPA declarado), com correção de erros de escala quando a quantidade salta por potência de 10 e o valor de mercado saltaria mais de 5×. Cotações sem ajuste por desdobramento.</li>" +
      "<li>Últimos 12 meses = último exercício (DFP) + acumulado do ano corrente − acumulado do mesmo período do ano anterior, os dois do ITR mais recente. P/L, P/VP, EV/EBITDA, ROE e margem do ranking usam os 12 meses quando a empresa tem ITR posterior ao último balanço anual.</li>" +
      "<li>DY 12 meses = proventos em dinheiro com data-com nos últimos 12 meses (B3) / valor de mercado. DY do exercício = dividendos e JCP pagos no último exercício (fluxo de caixa da DFP) / valor de mercado.</li>" +
      "<li>Ticker principal = o de maior volume negociado no último mês.</li>" +
      "</ul></details></section>";

    $$("[data-periodo]", app).forEach(function (b) {
      b.addEventListener("click", function () {
        estado.periodo = +b.getAttribute("data-periodo");
        $$("[data-periodo]", app).forEach(function (x) { x.setAttribute("aria-pressed", String(x === b)); });
        desenharEmpresa(e);
      });
    });
    desenharEmpresa(e);
  }

  function recorte(e) {
    var n = estado.periodo ? Math.min(estado.periodo, e.anos.length) : e.anos.length;
    var ini = e.anos.length - n;
    return {
      anos: e.anos.slice(ini),
      s: function (k) { return serie(e, k).slice(ini); },
    };
  }

  function desenharEmpresa(e) {
    var r = recorte(e), anos = r.anos, ini = e.anos.length - anos.length;

    var t = e.precos_ano[estado.ticker] ? estado.ticker : e.ticker;
    var px = precosAno(e, t);
    if (px) {
      linhas($("#g-cotacao"), anos, [{ nome: t, cor: "var(--c1)", v: px.slice(ini) }], porAcao,
        { eixo: function (v) { return nf(v >= 100 ? 0 : 2).format(v); }, limites: null });
    } else {
      $("#g-cotacao").innerHTML = '<p class="mudo">Sem cotações de fim de ano para ' + t + ".</p>";
    }
    var mult = anos.map(function (a, k) { return multiplos(e, e.series.valor_mercado[ini + k], ini + k); });
    linhas($("#g-multiplos"), anos, [
      { nome: "P/L", cor: "var(--c3)", v: mult.map(function (m) { return m.pl; }) },
      { nome: "P/VP", cor: "var(--c4)", v: mult.map(function (m) { return m.pvp; }) },
    ], vezes, { eixo: function (v) { return nf(0).format(v) + "x"; }, limites: [0, 60] });
    var rec = r.s("receita"), ll = r.s("lucro_liquido");
    barras($("#g-resultado"), anos, [
      { nome: "Receita", cor: "var(--c1)", v: rec },
      { nome: "Lucro líquido", cor: "var(--c2)", v: ll },
    ], dinheiro);

    var margem = function (num) { return num.map(function (v, k) { return div(v, rec[k]); }); };
    var linhasM = [{ nome: "Margem líquida", cor: "var(--c2)", v: margem(ll) }];
    if (!e.financeiro) {
      linhasM.unshift({ nome: "Margem EBIT", cor: "var(--c3)", v: margem(r.s("ebit")) });
      linhasM.unshift({ nome: "Margem bruta", cor: "var(--c1)", v: margem(r.s("lucro_bruto")) });
    }
    linhas($("#g-margens"), anos, linhasM, function (v) { return pct(v); });

    if (e.financeiro) {
      barras($("#g-divida"), anos, [{ nome: "Patrimônio líquido", cor: "var(--c4)", v: r.s("pl") }], dinheiro);
    } else {
      barras($("#g-divida"), anos, [
        { nome: "Dívida líquida", cor: "var(--c5)", v: r.s("divida_liquida") },
        { nome: "EBITDA", cor: "var(--c3)", v: r.s("ebitda") },
      ], dinheiro);
    }

    var neg = function (arr) { return arr.map(function (v) { return v == null ? null : -v; }); };
    barras($("#g-caixa"), anos, [
      { nome: "Operacional", cor: "var(--c2)", v: r.s("fco") },
      { nome: "Capex", cor: "var(--c5)", v: neg(r.s("capex")) },
      { nome: "Dividendos", cor: "var(--c4)", v: neg(r.s("dividendos_pagos")) },
    ], dinheiro);

    var acoes = e.series.acoes.slice(e.anos.length - anos.length);
    var dvd = r.s("dividendos_pagos");
    barras($("#g-dividendos"), anos, [{ nome: "Total pago", cor: "var(--c4)", v: dvd }], dinheiro, {
      extra: function (k) {
        var out = [];
        if (acoes[k] && dvd[k] != null) out.push(["Por ação", porAcao(dvd[k] * 1000 / acoes[k])]);
        if (mult[k].dy != null) out.push(["Yield no ano", pct(mult[k].dy)]);
        return out;
      },
    });

    tabelaDemonstracoes(e, r);
  }

  function tabelaDemonstracoes(e, r) {
    var anos = r.anos;
    var lin = [
      ["Receita líquida", "receita"], ["Resultado bruto", "lucro_bruto", 1], ["EBIT", "ebit", 1], ["EBITDA", "ebitda", 1],
      ["Lucro líquido", "lucro_liquido"], ["Atribuído à controladora", "lucro_controladora", 1],
      ["Ativo total", "ativo_total"], ["Patrimônio líquido", "pl"], ["Dívida bruta", "divida_bruta", 1], ["Caixa e aplicações", "caixa", 1],
      ["Dívida líquida", "divida_liquida", 1], ["Caixa operacional", "fco"], ["Capex", "capex", 1], ["Dividendos e JCP pagos", "dividendos_pagos", 1],
    ];
    $("#t-dem").innerHTML = '<table class="tabela-dem"><thead><tr><th>' + simbolo() + "</th>" +
      anos.map(function (a) { return "<th>" + a + "</th>"; }).join("") + "</tr></thead><tbody>" +
      lin.map(function (l) {
        var v = r.s(l[1]);
        if (v.every(function (x) { return x == null; })) return "";
        return '<tr class="' + (l[2] ? "sub" : "") + '"><td>' + l[0] + "</td>" +
          v.map(function (x) { return '<td class="num ' + classe(x) + '">' + dinheiro(x, true) + "</td>"; }).join("") + "</tr>";
      }).join("") + "</tbody></table>";
  }

  // ---------------------------------------------------------------- gráficos SVG

  var ALTURA = 230, M = { t: 10, r: 8, b: 26, l: 58 };

  function escala(min, max) {
    if (min === max) { max = min + 1; }
    var bruto = (max - min) / 4, mag = Math.pow(10, Math.floor(Math.log10(bruto))), f = bruto / mag;
    var passo = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * mag;
    var lo = Math.floor(min / passo) * passo, hi = Math.ceil(max / passo) * passo, ticks = [];
    for (var t = lo; t <= hi + passo / 2; t += passo) ticks.push(Math.abs(t) < passo / 1e6 ? 0 : t);
    return { lo: lo, hi: hi, ticks: ticks };
  }

  function base(el, anos, todos, fmtEixo) {
    var w = Math.max(280, el.clientWidth), h = ALTURA;
    var vals = todos.filter(function (v) { return v != null && isFinite(v); });
    var min = Math.min(0, Math.min.apply(null, vals.length ? vals : [0]));
    var max = Math.max(0, Math.max.apply(null, vals.length ? vals : [1]));
    var esc_ = escala(min, max);
    var iw = w - M.l - M.r, ih = h - M.t - M.b;
    var y = function (v) { return M.t + ih - (v - esc_.lo) / (esc_.hi - esc_.lo) * ih; };
    var bw = iw / anos.length;
    var x = function (k) { return M.l + bw * k + bw / 2; };
    var passoRot = Math.ceil(anos.length / Math.max(1, Math.floor(iw / 44)));
    var svg = '<svg viewBox="0 0 ' + w + " " + h + '" height="' + h + '" role="img">' +
      esc_.ticks.map(function (t) {
        return '<line class="' + (t === 0 ? "zero" : "grade") + '" x1="' + M.l + '" x2="' + (w - M.r) + '" y1="' + y(t) + '" y2="' + y(t) + '"/>' +
          '<text class="eixo" x="' + (M.l - 8) + '" y="' + (y(t) + 4) + '" text-anchor="end">' + fmtEixo(t) + "</text>";
      }).join("") +
      anos.map(function (a, k) {
        return k % passoRot === (anos.length - 1) % passoRot ? '<text class="eixo" x="' + x(k) + '" y="' + (h - 6) + '" text-anchor="middle">' + a + "</text>" : "";
      }).join("");
    return { w: w, h: h, x: x, y: y, bw: bw, svg: svg, ih: ih };
  }

  function legenda(series, linha) {
    return '<div class="legenda">' + series.map(function (s) {
      return '<span><i class="' + (linha ? "linha" : "") + '" style="--c:' + s.cor + '"></i>' + s.nome + "</span>";
    }).join("") + "</div>";
  }

  function interagir(el, g, anos, series, fmt, extra) {
    var svg = el.querySelector("svg"), dica = $("#dica"), foco = el.querySelector(".foco");
    function mostrar(ev) {
      var rect = svg.getBoundingClientRect();
      var px = (ev.clientX - rect.left) * (g.w / rect.width);
      var k = Math.floor((px - M.l) / g.bw);
      if (k < 0 || k >= anos.length) { esconder(); return; }
      foco.setAttribute("x", M.l + g.bw * k); foco.removeAttribute("hidden");
      var html = "<b>" + anos[k] + "</b>" + series.map(function (s) {
        return '<div><span><i style="--c:' + s.cor + '"></i>' + s.nome + '</span><span class="num">' + fmt(s.v[k]) + "</span></div>";
      }).join("");
      var x = extra && extra(k);
      if (x && x.length) (Array.isArray(x[0]) ? x : [x]).forEach(function (p) {
        html += '<div><span class="mudo">' + p[0] + '</span><span class="num">' + p[1] + "</span></div>";
      });
      dica.innerHTML = html; dica.hidden = false;
      var dx = ev.clientX + 14, dw = dica.offsetWidth;
      if (dx + dw > window.innerWidth - 8) dx = ev.clientX - dw - 14;
      dica.style.left = dx + "px"; dica.style.top = Math.max(8, ev.clientY - dica.offsetHeight - 10) + "px";
    }
    function esconder() { dica.hidden = true; foco.setAttribute("hidden", ""); }
    svg.addEventListener("mousemove", mostrar);
    svg.addEventListener("mouseleave", esconder);
    svg.addEventListener("touchstart", function (ev) { mostrar(ev.touches[0]); }, { passive: true });
  }

  function focoRect(g) { return '<rect class="foco" hidden x="0" y="' + M.t + '" width="' + g.bw + '" height="' + g.ih + '"/>'; }

  function barras(el, anos, series, fmt, opts) {
    if (!el) return;
    var todos = [].concat.apply([], series.map(function (s) { return s.v; }));
    if (!todos.some(function (v) { return v != null; })) { el.innerHTML = '<p class="mudo">Sem dados no período.</p>'; return; }
    var g = base(el, anos, todos, function (v) { return dinheiro(v, true); });
    var n = series.length, gap = Math.max(2, g.bw * 0.22), larg = Math.max(2, (g.bw - gap) / n - 1);
    var corpo = focoRect(g);
    series.forEach(function (s, j) {
      s.v.forEach(function (v, k) {
        if (v == null) return;
        var x0 = M.l + g.bw * k + gap / 2 + j * (larg + 1), y0 = g.y(Math.max(0, v)), y1 = g.y(Math.min(0, v));
        corpo += '<rect x="' + x0 + '" y="' + y0 + '" width="' + larg + '" height="' + Math.max(1, y1 - y0) + '" rx="' + Math.min(3, larg / 3) + '" fill="' + s.cor + '"/>';
      });
    });
    el.innerHTML = g.svg.replace("</svg>", "") + corpo + "</svg>" + legenda(series);
    interagir(el, g, anos, series, fmt, opts && opts.extra);
  }

  /** opts.eixo formata o eixo (padrão: %); opts.limites recorta valores extremos ([min, max] ou null). */
  function linhas(el, anos, series, fmt, opts) {
    if (!el) return;
    opts = opts || {};
    var lim = opts.limites === undefined ? [-1, 1.5] : opts.limites;
    var corta = function (v) { return v == null || !lim ? v : Math.max(lim[0], Math.min(lim[1], v)); };
    var todos = [].concat.apply([], series.map(function (s) { return s.v; })).map(corta);
    if (!todos.some(function (v) { return v != null; })) { el.innerHTML = '<p class="mudo">Sem dados no período.</p>'; return; }
    var g = base(el, anos, todos, opts.eixo || function (v) { return nf(0).format(v * 100) + "%"; });
    var corpo = focoRect(g);
    series.forEach(function (s) {
      var d = "", aberto = false;
      s.v.forEach(function (v, k) {
        if (v == null) { aberto = false; return; }
        var vv = corta(v);
        d += (aberto ? "L" : "M") + g.x(k).toFixed(1) + " " + g.y(vv).toFixed(1);
        aberto = true;
        corpo += '<circle cx="' + g.x(k) + '" cy="' + g.y(vv) + '" r="2.6" fill="' + s.cor + '"/>';
      });
      corpo += '<path d="' + d + '" fill="none" stroke="' + s.cor + '" stroke-width="2.2" stroke-linejoin="round"/>';
    });
    el.innerHTML = g.svg.replace("</svg>", "") + corpo + "</svg>" + legenda(series, true);
    interagir(el, g, anos, series, fmt);
  }

  // ---------------------------------------------------------------- busca

  function busca() {
    var input = $("#busca"), lista = $("#sugestoes"), sel = -1, achados = [];
    function norm(s) { return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase(); }
    function render() {
      var q = norm(input.value.trim());
      if (!q) { lista.hidden = true; return; }
      achados = EMPRESAS.filter(function (e) {
        return e.tickers.some(function (t) { return norm(t).indexOf(q) === 0; }) || norm(e.nome).indexOf(q) >= 0;
      }).slice(0, 8);
      sel = achados.length ? 0 : -1;
      lista.innerHTML = achados.map(function (e, k) {
        var t = e.tickers.filter(function (t) { return norm(t).indexOf(q) === 0; })[0] || e.ticker;
        return '<li role="option" data-t="' + t + '" aria-selected="' + (k === sel) + '"><b>' + t + "</b><span>" + esc(nomeCurto(e.nome)) + "</span></li>";
      }).join("") || '<li class="mudo">Nada encontrado</li>';
      lista.hidden = false;
    }
    function ir(t) { location.hash = "#/" + t; input.value = ""; lista.hidden = true; input.blur(); }
    input.addEventListener("input", render);
    input.addEventListener("keydown", function (ev) {
      var itens = $$("li[data-t]", lista);
      if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
        ev.preventDefault();
        if (!itens.length) return;
        sel = (sel + (ev.key === "ArrowDown" ? 1 : -1) + itens.length) % itens.length;
        itens.forEach(function (li, k) { li.setAttribute("aria-selected", String(k === sel)); });
      } else if (ev.key === "Enter" && itens[sel]) {
        ir(itens[sel].getAttribute("data-t"));
      } else if (ev.key === "Escape") {
        lista.hidden = true;
      }
    });
    lista.addEventListener("mousedown", function (ev) {
      var li = ev.target.closest("li[data-t]");
      if (li) { ev.preventDefault(); ir(li.getAttribute("data-t")); }
    });
    input.addEventListener("blur", function () { setTimeout(function () { lista.hidden = true; }, 100); });
  }

  // ---------------------------------------------------------------- roteamento e controles

  function rota() {
    var m = location.hash.match(/^#\/([A-Z0-9]+)/i);
    $("#dica").hidden = true;
    if (m) telaEmpresa(m[1].toUpperCase()); else telaRanking();
  }

  function aplicarMoeda() {
    $$("[data-moeda]").forEach(function (b) { b.setAttribute("aria-pressed", String(b.getAttribute("data-moeda") === estado.moeda)); });
  }

  function iniciar() {
    $("#gerado").textContent = "Base gerada em " + D.gerado_em + ". PTAX média de " + D.ano_final + ": R$ " + nf(4).format(D.ptax[String(D.ano_final)].media) + " por US$.";
    $$("[data-moeda]").forEach(function (b) {
      b.addEventListener("click", function () {
        estado.moeda = b.getAttribute("data-moeda"); gravar("lastro-moeda", estado.moeda); aplicarMoeda();
        var rolagem = window.scrollY; rota(); window.scrollTo(0, rolagem);
      });
    });
    aplicarMoeda();

    var tema = ler("lastro-tema");
    if (tema) document.documentElement.setAttribute("data-theme", tema);
    $("#tema").addEventListener("click", function () {
      var atual = document.documentElement.getAttribute("data-theme") ||
        (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
      var novo = atual === "dark" ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", novo); gravar("lastro-tema", novo);
    });

    var t;
    window.addEventListener("resize", function () {
      clearTimeout(t);
      t = setTimeout(function () { var m = location.hash.match(/^#\/([A-Z0-9]+)/i); if (m && POR_TICKER[m[1].toUpperCase()]) desenharEmpresa(POR_TICKER[m[1].toUpperCase()]); }, 150);
    });
    window.addEventListener("hashchange", function () { rota(); window.scrollTo(0, 0); });
    busca();
    rota();
  }

  iniciar();
})();
