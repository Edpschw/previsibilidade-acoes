/* Lastro — ranking e página da empresa a partir de window.DADOS (gerado por scripts/processar.py).
 * Valores na base estão em R$ mil. Em US$, fluxos usam a PTAX média do ano e saldos de balanço a PTAX do fim do ano.
 * Textos em i18n.js (PT/EN); rótulos curtos dos cards usam L(pt, en) aqui mesmo. */
(function () {
  "use strict";

  var D = window.DADOS;
  var EMPRESAS = D.empresas;
  var POR_TICKER = {};
  EMPRESAS.forEach(function (e) { e.tickers.forEach(function (t) { POR_TICKER[t] = e; }); });

  var SALDOS = { ativo_total: 1, pl: 1, pl_controladora: 1, divida_bruta: 1, caixa: 1, divida_liquida: 1, valor_mercado: 1 };

  var estado = {
    moeda: ler("lastro-moeda") || "brl",
    lingua: ler("lastro-lingua") || (/^pt/i.test(navigator.language || "") ? "pt" : "en"),
    ord: { col: "score", dir: -1 },
    filtros: { setor: "", controle: "", segmento: "", exterior: false, semFin: false, ativas: true },
    periodo: 10,
  };

  function ler(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function gravar(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* sem storage */ } }

  // ---------------------------------------------------------------- idioma

  function t(k) {
    var d = window.I18N[estado.lingua] || window.I18N.pt;
    return d[k] != null ? d[k] : (window.I18N.pt[k] != null ? window.I18N.pt[k] : k);
  }
  function tf(k) {
    var args = arguments;
    return t(k).replace(/\{(\d)\}/g, function (m, n) { return args[+n + 1]; });
  }
  function L(pt, en) { return estado.lingua === "en" ? en : pt; }
  function mapa(tipo, v) { return estado.lingua === "en" ? (window.I18N_MAPAS[tipo][v] || v) : v; }
  function locale() { return estado.lingua === "en" ? "en-US" : "pt-BR"; }

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
  function precosAno(e, tk) {
    var p = e.precos_ano[tk];
    if (!p) return null;
    return p.map(function (v, i) {
      if (v == null || estado.moeda === "brl") return v;
      var x = D.ptax[String(e.anos[i])];
      return x ? v / x.fim : null;
    });
  }
  function cotacaoDe(e, tk) { return e.cotacao[tk] || e.cotacao[e.ticker] || null; }
  function ultimo(arr) { return arr[arr.length - 1]; }
  function div(a, b) { return a == null || b == null || b === 0 ? null : a / b; }
  function simbolo() { return estado.moeda === "usd" ? "US$" : "R$"; }

  var NF = {};
  function nf(casas) {
    var k = locale() + casas;
    if (!NF[k]) NF[k] = new Intl.NumberFormat(locale(), { minimumFractionDigits: casas, maximumFractionDigits: casas });
    return NF[k];
  }

  /** valor em milhares → "R$ 12,3 bi" / "R$ 12.3 bn" */
  function dinheiro(vMil, curto) {
    if (vMil == null || isNaN(vMil)) return "–";
    if (vMil === 0) return curto ? "0" : simbolo() + " 0";
    var v = vMil * 1000, a = Math.abs(v), s, suf;
    var SUF = estado.lingua === "en" ? [" tn", " bn", " M", " k"] : [" tri", " bi", " mi", " mil"];
    if (a >= 1e12) { s = v / 1e12; suf = SUF[0]; }
    else if (a >= 1e9) { s = v / 1e9; suf = SUF[1]; }
    else if (a >= 1e6) { s = v / 1e6; suf = SUF[2]; }
    else if (a >= 1e3) { s = v / 1e3; suf = SUF[3]; }
    else { s = v; suf = ""; }
    var casas = Math.abs(s) >= 100 ? 0 : Math.abs(s) >= 10 ? 1 : 2;
    return (curto ? "" : simbolo() + " ") + nf(casas).format(s) + suf;
  }
  function porAcao(v) { return v == null || !isFinite(v) ? "–" : simbolo() + " " + nf(2).format(v); }
  function pct(v, casas) { return v == null || !isFinite(v) ? "–" : nf(casas == null ? 1 : casas).format(v * 100) + "%"; }
  function vezes(v) { return v == null || !isFinite(v) ? "–" : nf(2).format(v) + "x"; }
  function classe(v) { return v == null ? "" : v < 0 ? "neg" : ""; }
  function data(iso) {
    if (!iso) return "–";
    if (estado.lingua === "en") {
      var dt = new Date(iso + "T12:00:00Z");
      return dt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
    }
    return iso.slice(8, 10) + "/" + iso.slice(5, 7) + "/" + iso.slice(0, 4);
  }

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
    var x = e.ttm, vm = e.valor_mercado;
    if (!x) return null;
    var lc = x.lucro_controladora, plc = x.pl_controladora, eb = x.ebitda, dl = x.divida_liquida, rec = x.receita;
    var conv = function (v) {
      if (v == null || estado.moeda === "brl") return v;
      var p = D.ptax[x.ate.slice(0, 4)];
      return p ? v / p.media : null;
    };
    return {
      ate: x.ate,
      pl: vm && lc > 0 ? vm / lc : null,
      pvp: vm && plc > 0 ? vm / plc : null,
      evEbitda: !e.financeiro && vm && eb > 0 && dl != null ? (vm + dl) / eb : null,
      psr: !e.financeiro && vm && rec > 0 ? vm / rec : null,
      roe: plc > 0 && lc != null ? lc / plc : null,
      mLiq: rec > 0 && x.lucro_liquido != null ? x.lucro_liquido / rec : null,
      dlEbitda: e.financeiro || !(eb > 0) || dl == null ? null : dl / eb,
      lucroC: lc,
      receita: conv(rec), lucro: conv(x.lucro_liquido), dividendos: conv(x.dividendos_pagos),
    };
  }

  /** indicadores do último exercício na moeda atual (múltiplos sobre 12 meses quando há ITR) */
  function indicadores(e) {
    var r = serie(e, "receita"), ll = serie(e, "lucro_liquido"), lc = serie(e, "lucro_controladora");
    var pl = serie(e, "pl_controladora"), ebitda = serie(e, "ebitda"), dl = serie(e, "divida_liquida");
    var acoes = ultimo(e.series.acoes);
    var fco = ultimo(serie(e, "fco")), capex = ultimo(serie(e, "capex")), dvd = ultimo(serie(e, "dividendos_pagos"));
    var m = multiplos(e, e.valor_mercado, e.anos.length - 1), cot = cotacaoDe(e, e.ticker), d12 = doze(e);
    var base = d12 || m;
    return {
      preco: cot ? hoje(cot.preco) : null,
      vm: hoje(e.valor_mercado),
      liquidez: hoje(e.liquidez),
      d12: d12,
      pl: base.pl, pvp: base.pvp, evEbitda: base.evEbitda, psr: base.psr,
      roe12: d12 ? d12.roe : null, mLiq12: d12 ? d12.mLiq : null, dlEbitda12: d12 ? d12.dlEbitda : null,
      // DY de 12 meses pelos proventos com data-com na B3; sem ficha, cai no pago no exercício (DFP)
      dy: e.proventos_12m != null && e.valor_mercado ? e.proventos_12m / e.valor_mercado : m.dy,
      dyExercicio: m.dy,
      ano: ultimo(e.anos),
      receita: ultimo(r),
      lucro: ultimo(ll),
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
    if (v == null) return { txt: t("nivel_sem"), cor: "var(--muted)" };
    if (v >= 75) return { txt: t("nivel_alta"), cor: "var(--pos)" };
    if (v >= 50) return { txt: t("nivel_media"), cor: "var(--warn)" };
    return { txt: t("nivel_baixa"), cor: "var(--neg)" };
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
  /** setor: classificação da B3 no idioma da tela; sem ela, a da CVM (em português) */
  function setor(e) {
    if (e.setor_b3) return e.setor_b3[estado.lingua] || e.setor_b3.pt;
    return e.setor.replace(/^Emp\. Adm\. Part\. ?- ?/, "");
  }
  function maiuscula(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  // ---------------------------------------------------------------- ranking

  function colunas() {
    return [
      { id: "ticker", rot: t("col_acao"), esq: true, val: function (e) { return e.ticker; } },
      { id: "setor", rot: t("col_setor"), esq: true, val: function (e) { return setor(e); } },
      { id: "score", rot: t("col_score"), val: function (e) { var s = score(e); return s ? s.total : null; } },
      { id: "preco", rot: t("col_preco"), val: function (e, i) { return i.preco; }, fmt: porAcao },
      { id: "vm", rot: t("col_vm"), val: function (e, i) { return i.vm; }, fmt: function (v) { return dinheiro(v); } },
      { id: "pl", rot: t("col_pl"), val: function (e, i) { return i.pl; }, fmt: vezes },
      { id: "pvp", rot: t("col_pvp"), val: function (e, i) { return i.pvp; }, fmt: vezes },
      { id: "dy", rot: t("col_dy"), val: function (e, i) { return i.dy; }, fmt: function (v) { return pct(v); } },
      { id: "roe", rot: t("col_roe"), val: function (e, i) { return i.d12 ? i.roe12 : i.roe; }, fmt: function (v) { return pct(v); } },
      { id: "mLiq", rot: t("col_mliq"), val: function (e, i) { return i.d12 ? i.mLiq12 : i.mLiq; }, fmt: function (v) { return pct(v); } },
      { id: "dlEbitda", rot: t("col_dlebitda"), val: function (e, i) { return i.d12 ? i.dlEbitda12 : i.dlEbitda; }, fmt: vezes },
      { id: "liquidez", rot: t("col_liq"), val: function (e, i) { return i.liquidez; }, fmt: function (v) { return v ? dinheiro(v / 1000) : "–"; } },
    ];
  }

  function opcoes(campo, rotulo) {
    var vals = {};
    EMPRESAS.forEach(function (e) { var v = campo === "setor" ? setor(e) : e[campo]; vals[v] = (vals[v] || 0) + 1; });
    var nome = function (v) { return campo === "setor" ? v : mapa(campo, v); };
    return '<option value="">' + rotulo + "</option>" + Object.keys(vals)
      .sort(function (a, b) { return nome(a).localeCompare(nome(b), locale()); })
      .map(function (v) { return '<option value="' + esc(v) + '">' + esc(nome(v)) + " (" + vals[v] + ")</option>"; }).join("");
  }

  function telaRanking() {
    document.title = t("titulo");
    var app = $("#app"), cols = colunas();
    var anoIni = Math.min.apply(null, EMPRESAS.map(function (e) { return e.anos[0]; }));
    app.innerHTML =
      '<section class="intro"><h1>' + t("h1") + "</h1><p>" + esc(tf("intro", EMPRESAS.length, anoIni, D.ano_final)) + "</p></section>" +
      '<div class="filtros">' +
      '<select id="f-setor" aria-label="' + t("rot_setor") + '">' + opcoes("setor", t("todos_setores")) + "</select>" +
      '<select id="f-segmento" aria-label="' + t("rot_segmento") + '">' + opcoes("segmento", t("todos_segmentos")) + "</select>" +
      '<select id="f-controle" aria-label="' + t("rot_controle") + '">' + opcoes("controle", t("qualquer_controle")) + "</select>" +
      '<label class="check"><input type="checkbox" id="f-exterior"> ' + t("f_exterior") + "</label>" +
      '<label class="check"><input type="checkbox" id="f-semfin"> ' + t("f_semfin") + "</label>" +
      '<label class="check" title="' + esc(t("f_ativas_dica")) + '"><input type="checkbox" id="f-ativas"> ' + t("f_ativas") + "</label>" +
      '<span class="contagem" id="contagem"></span></div>' +
      '<div class="tabela-wrap"><table id="ranking"><thead><tr>' +
      cols.map(function (c) { return '<th data-ord="' + c.id + '"' + (c.esq ? ' class="esq"' : "") + ">" + c.rot + "</th>"; }).join("") +
      "</tr></thead><tbody></tbody></table></div>";

    var f = estado.filtros;
    $("#f-setor").value = f.setor; $("#f-segmento").value = f.segmento; $("#f-controle").value = f.controle;
    if ($("#f-setor").value !== f.setor) f.setor = "";  // setor do outro idioma
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
    var f = estado.filtros, cols = colunas();
    var linhas = EMPRESAS.filter(function (e) {
      return (!f.setor || setor(e) === f.setor) && (!f.segmento || e.segmento === f.segmento) &&
        (!f.controle || e.controle === f.controle) && (!f.exterior || e.exterior.length) && (!f.semFin || !e.financeiro) &&
        (!f.ativas || Object.keys(e.cotacao).length);
    }).map(function (e) { return { e: e, i: indicadores(e) }; });

    var col = cols.filter(function (c) { return c.id === estado.ord.col; })[0];
    linhas.sort(function (a, b) {
      var va = col.val(a.e, a.i), vb = col.val(b.e, b.i);
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      if (typeof va === "string") return estado.ord.dir * va.localeCompare(vb, locale());
      return estado.ord.dir * (va - vb);
    });

    $$("#ranking th").forEach(function (th) {
      th.setAttribute("aria-sort", th.getAttribute("data-ord") === estado.ord.col ? (estado.ord.dir > 0 ? "ascending" : "descending") : "none");
    });
    $("#contagem").textContent = tf("contagem", linhas.length, data(D.cotacoes_em), D.ano_final, simbolo());

    $("#ranking tbody").innerHTML = linhas.length ? linhas.map(function (l) {
      var e = l.e, i = l.i, s = score(e), nv = nivelScore(s && s.total);
      var ext = e.exterior.length ? ' <span class="selo" title="' + esc(tf("tambem_em", e.exterior.map(function (p) { return mapa("pais", p); }).join(", "))) + '">ADR</span>' : "";
      var ano = i.ano < D.ano_final ? ' <span class="selo" title="' + esc(t("ultimo_exercicio")) + '">' + i.ano + "</span>" : "";
      return '<tr data-t="' + e.ticker + '">' +
        '<td><div class="tk"><b>' + e.ticker + ext + ano + "</b><span>" + esc(nomeCurto(e.nome)) + "</span></div></td>" +
        '<td class="esq setor-cel" title="' + esc(setor(e)) + '">' + esc(setor(e)) + "</td>" +
        "<td>" + (s ? '<span class="barra-score" title="' + nv.txt + '"><i style="--w:' + s.total + "%;--cor:" + nv.cor + '"></i><b>' + s.total + "</b></span>" : '<span class="mudo">–</span>') + "</td>" +
        cols.slice(3).map(function (c) { var v = c.val(e, i); return '<td class="num ' + classe(v) + '">' + c.fmt(v) + "</td>"; }).join("") +
        "</tr>";
    }).join("") : '<tr><td colspan="' + cols.length + '" class="vazio">' + t("nenhuma") + "</td></tr>";
  }

  // ---------------------------------------------------------------- empresa: resumo e selos

  /** Frase de resumo gerada a partir dos números (lucro, dívida, dividendos, tendência de 12 meses). */
  function resumo(e, i) {
    var s = e.series, partes = [];
    var idx = e.anos.map(function (a, k) { return k; }).filter(function (k) { return s.receita[k] != null && s.lucro_liquido[k] != null; }).slice(-10);
    var n = idx.length;
    if (n >= 3) {
      var pos = idx.filter(function (k) { return s.lucro_liquido[k] > 0; }).length;
      partes.push(pos === n ? tf("r_lucro_todos", n) : pos === 0 ? tf("r_lucro_nunca", n) : tf("r_lucro", pos, n));
    }
    if (!e.financeiro) {
      var dl = i.d12 ? e.ttm.divida_liquida : ultimo(s.divida_liquida);
      var eb = i.d12 ? e.ttm.ebitda : ultimo(s.ebitda);
      if (dl != null) {
        if (dl < 0) partes.push(t("r_caixa"));
        else if (eb != null && eb <= 0) partes.push(t("r_div_ebitda_neg"));
        else if (eb) {
          var x = dl / eb, txt = vezes(x);
          partes.push(tf(x < 1 ? "r_div_baixa" : x < 3 ? "r_div_mod" : "r_div_alta", txt));
        }
      }
    }
    var comDvd = idx.filter(function (k) { return s.dividendos_pagos[k] != null; });
    if (comDvd.length >= 3) {
      var pagou = comDvd.filter(function (k) { return s.dividendos_pagos[k] > 0; }).length;
      partes.push(pagou === comDvd.length ? t("r_dvd_todos") : pagou === 0 ? t("r_dvd_nunca") : tf("r_dvd", pagou, comDvd.length));
    }
    var fy = ultimo(s.lucro_controladora);
    if (i.d12 && i.d12.lucroC != null && fy > 0) {
      if (i.d12.lucroC < 0) partes.push(t("r_12m_prej"));
      else {
        var v = i.d12.lucroC / fy - 1;
        if (v > 0.2) partes.push(tf("r_12m_acima", pct(v, 0), i.ano));
        else if (v < -0.2) partes.push(tf("r_12m_abaixo", pct(-v, 0), i.ano));
      }
    }
    if (!partes.length) return "";
    var frase = partes.slice(0, -1).join(", ") + (partes.length > 1 ? L("; ", "; ") : "") + ultimo(partes);
    return maiuscula(frase) + ".";
  }

  function selos(e) {
    var out = [];
    var add = function (txt, cls, dica) { out.push('<span class="selo-h ' + (cls || "") + '"' + (dica ? ' title="' + esc(dica) + '"' : "") + ">" + esc(txt) + "</span>"); };
    add(setor(e), "forte");
    if (e.segmento && e.segmento !== "Não informado") add(mapa("segmento", e.segmento));
    if (/^Estatal/.test(e.controle)) add(t("selo_estatal"), "aviso");
    if (/^Estrangeiro/.test(e.controle)) add(t("selo_estrangeiro"));
    if (e.exterior.length) add(tf("selo_adr", e.exterior.map(function (p) { return mapa("pais", p); }).join(", ")));
    if (e.financeiro) add(t("selo_financeira"), "", t("dica_financeira"));
    if (e.individual) add(t("selo_individual"), "", t("dica_individual"));
    if (e.anos.length < 3) add(t("selo_ipo"), "", t("dica_ipo"));
    return out.join("");
  }

  // ---------------------------------------------------------------- empresa

  function componentes() {
    return [
      { id: "lucro", peso: 30, nome: L("Lucro positivo", "Positive earnings"), desc: L("Fração dos anos com lucro líquido acima de zero.", "Share of years with net income above zero.") },
      { id: "margem", peso: 25, nome: L("Margem estável", "Stable margin"), desc: L("Quanto menos a margem líquida oscila, maior a nota. Desvio de 15 p.p. ou mais zera.", "The less the net margin swings, the higher the score. A 15-point standard deviation or more scores zero.") },
      { id: "receita", peso: 15, nome: L("Receita estável", "Stable revenue"), desc: L("Oscilação do crescimento anual da receita. Desvio de 30 p.p. ou mais zera.", "Volatility of annual revenue growth. A 30-point standard deviation or more scores zero.") },
      { id: "tendencia", peso: 15, nome: L("Crescimento constante", "Steady growth"), desc: L("Quanto a receita segue uma reta ascendente (R²). Tendência de queda zera.", "How closely revenue follows a rising straight line (R²). A falling trend scores zero.") },
      { id: "dividendos", peso: 15, nome: L("Dividendos regulares", "Regular dividends"), desc: L("Fração dos anos com dividendos ou JCP pagos.", "Share of years with dividends or interest on equity paid.") },
    ];
  }

  /** seções da página: [id, chave do rótulo] na ordem em que aparecem */
  function secoesDe(i) {
    var s = [["s-valuation", "sec_valuation"]];
    if (i.d12) s.push(["s-12m", "sec_12m"]);
    s.push(["s-fund", "sec_fund"], ["s-hist", "sec_hist"], ["s-indice", "sec_indice"], ["s-dem", "sec_dem"], ["s-metodo", "sec_metodo"]);
    return s;
  }
  function capitulo(secs, id) {
    var k = secs.map(function (x) { return x[0]; }).indexOf(id);
    return '<span class="capitulo">' + (k < 9 ? "0" : "") + (k + 1) + "</span>";
  }

  function telaEmpresa(ticker) {
    var e = POR_TICKER[ticker];
    var app = $("#app");
    if (!e) {
      app.innerHTML = '<a class="voltar" href="#/">' + t("voltar") + '</a><div class="cartao vazio">' + tf("nao_encontrado", esc(ticker)) + "</div>";
      return;
    }
    document.title = ticker + " · " + nomeCurto(e.nome) + " · Lastro";
    estado.ticker = ticker;
    var i = indicadores(e), s = score(e), nv = nivelScore(s && s.total), cot = cotacaoDe(e, ticker);
    var secs = secoesDe(i);
    var raio = 44, circ = 2 * Math.PI * raio;
    var frase = resumo(e, i);

    // --- cabeçalho
    var stat = function (rot, val) { return '<div class="stat"><span>' + rot + '</span><b class="num">' + val + "</b></div>"; };
    var cab =
      '<a class="voltar" href="#/">' + t("voltar") + "</a>" +
      '<section class="cartao hero">' +
      '<div class="hero-principal">' +
      "<h1>" + esc(nomeCurto(e.nome)) + "</h1>" +
      '<div class="tickers">' + e.tickers.map(function (tk) { return '<a class="chip' + (tk === ticker ? " ativo" : "") + '" href="#/' + tk + '">' + tk + "</a>"; }).join("") + "</div>" +
      (cot ? '<div class="hero-preco"><span class="preco num">' + porAcao(hoje(cot.preco)) + "</span>" +
        '<span class="mudo">' + esc(tf("fechamento", ticker, data(cot.data))) + (e.cotacao[ticker] ? "" : esc(tf("sem_negocio_ticker", e.ticker))) + "</span></div>"
        : '<div class="hero-preco mudo">' + t("sem_negocios") + "</div>") +
      (frase ? '<p class="resumo">' + esc(frase) + "</p>" : "") +
      '<div class="selos">' + selos(e) + "</div>" +
      '<div class="stats">' +
      stat(t("st_vm"), dinheiro(i.vm)) + stat(t("st_pl"), vezes(i.pl)) + stat(t("st_dy"), pct(i.dy)) +
      stat(t("st_liq"), i.liquidez ? dinheiro(i.liquidez / 1000) + t("por_dia") : "–") +
      "</div>" +
      (e.site ? '<a class="site" href="' + esc(/^https?:/.test(e.site) ? e.site : "https://" + e.site) + '" target="_blank" rel="noopener">' + esc(e.site.replace(/^https?:\/\//, "")) + " ↗</a>" : "") +
      "</div>" +
      '<div class="score-box"><svg class="anel" viewBox="0 0 104 104" aria-hidden="true"><circle class="fundo" cx="52" cy="52" r="' + raio + '"/>' +
      (s ? '<circle cx="52" cy="52" r="' + raio + '" stroke="' + nv.cor + '" stroke-dasharray="' + (circ * s.total / 100) + " " + circ + '" stroke-linecap="round" transform="rotate(-90 52 52)"/>' : "") +
      '<text x="52" y="53">' + (s ? s.total : "–") + "</text></svg>" +
      '<div><div class="rot">' + t("previsibilidade") + '</div><div class="nivel" style="color:' + nv.cor + '">' + nv.txt + "</div>" +
      '<div class="mudo janela">' + (s ? esc(tf("janela_score", s.anos[0], s.anos[1], simbolo())) : t("menos_5")) + "</div>" +
      '<a class="mini" href="#" data-ir="s-indice">' + L("Como sai o índice ↓", "How it is built ↓") + "</a></div></div>" +
      "</section>";

    // --- navegação por seções
    var nav = '<nav class="secoes" aria-label="' + esc(t("secoes")) + '"><div class="secoes-trilho"><i></i></div><ol>' +
      secs.map(function (x, k) {
        return '<li><a href="#" data-ir="' + x[0] + '"><span class="n">' + (k < 9 ? "0" : "") + (k + 1) + '</span><span class="r">' + t(x[1]) + "</span></a></li>";
      }).join("") + "</ol></nav>";

    // --- cards
    var valuation = [
      [L("P/L", "P/E"), vezes(i.pl), L("Valor de mercado / lucro da controladora ", "Market cap / net income attributable to shareholders ") + (i.d12 ? L("dos 12 meses até ", "over the 12 months to ") + data(i.d12.ate) : L("de ", "for ") + i.ano)],
      [L("P/VP", "P/B"), vezes(i.pvp), L("Valor de mercado / patrimônio da controladora ", "Market cap / shareholders' equity ") + (i.d12 ? L("em ", "on ") + data(i.d12.ate) : L("no fim de ", "at year-end ") + i.ano)],
      [L("DY 12 meses", "Yield, 12 months"), pct(i.dy), e.proventos_12m != null ? L("Proventos em dinheiro com data-com nos últimos 12 meses (B3) / valor de mercado", "Cash distributions with ex-date in the last 12 months (B3) / market cap") : L("Sem ficha na B3: dividendos e JCP pagos em ", "No B3 record: dividends and interest on equity paid in ") + i.ano + L(" / valor de mercado", " / market cap")],
      [L("DY do exercício", "Yield, fiscal year"), pct(i.dyExercicio), L("Dividendos e JCP pagos em ", "Dividends and interest on equity paid in ") + i.ano + L(" (fluxo de caixa da DFP) / valor de mercado atual", " (cash flow statement) / current market cap")],
      ["EV/EBITDA", vezes(i.evEbitda), L("(Valor de mercado + dívida líquida) / EBITDA", "(Market cap + net debt) / EBITDA") + (i.d12 ? L(" dos últimos 12 meses", ", trailing 12 months") : "")],
      [L("P/Receita", "P/Sales"), vezes(i.psr), L("Valor de mercado / receita", "Market cap / revenue") + (i.d12 ? L(" dos últimos 12 meses", ", trailing 12 months") : "")],
      [L("Valor de mercado", "Market cap"), dinheiro(i.vm), e.acoes_b3 ? L("Ações ON e PN atuais segundo a B3, sem tesouraria, × cotação de cada classe", "Current common and preferred shares per B3, ex-treasury, × each class's price") : L("Ações ON e PN da DFP × cotação de cada classe", "Common and preferred shares from the annual filing × each class's price")],
    ];
    var doze12 = i.d12 ? [
      [L("Receita 12m", "Revenue TTM"), dinheiro(i.d12.receita), L("Receita dos 12 meses até ", "Revenue over the 12 months to ") + data(i.d12.ate)],
      [L("Lucro 12m", "Net income TTM"), dinheiro(i.d12.lucro), L("Lucro líquido dos 12 meses até ", "Net income over the 12 months to ") + data(i.d12.ate)],
      [L("Margem líquida 12m", "Net margin TTM"), pct(i.d12.mLiq), L("Lucro / receita dos últimos 12 meses", "Net income / revenue, trailing 12 months")],
      [L("ROE 12m", "ROE TTM"), pct(i.d12.roe), L("Lucro da controladora 12m / patrimônio em ", "Trailing net income to shareholders / equity on ") + data(i.d12.ate)],
      [L("Dív. líq./EBITDA 12m", "Net debt/EBITDA TTM"), vezes(i.d12.dlEbitda), L("Dívida líquida em ", "Net debt on ") + data(i.d12.ate) + L(" / EBITDA dos últimos 12 meses", " / trailing 12-month EBITDA")],
      [L("Dividendos pagos 12m", "Dividends paid TTM"), dinheiro(i.d12.dividendos), L("Dividendos e JCP pagos nos 12 meses (fluxo de caixa)", "Dividends and interest on equity paid over 12 months (cash flow)")],
    ] : null;
    var cards = [
      [L("Receita", "Revenue"), dinheiro(i.receita), L("Receita líquida do exercício", "Net revenue for the fiscal year")],
      [L("Lucro líquido", "Net income"), dinheiro(i.lucro), L("Lucro consolidado, inclui minoritários", "Consolidated, includes minority interests")],
      [L("LPA", "EPS"), porAcao(i.lpa), L("Lucro da controladora por ação em circulação", "Net income to shareholders per share outstanding")],
      [L("VPA", "Book value/share"), porAcao(i.vpa), L("Patrimônio da controladora por ação", "Shareholders' equity per share")],
      ["ROE", pct(i.roe), L("Lucro da controladora / patrimônio da controladora", "Net income to shareholders / shareholders' equity")],
      ["ROA", pct(i.roa), L("Lucro líquido / ativo total", "Net income / total assets")],
      [L("Margem bruta", "Gross margin"), pct(i.mBruta), L("Resultado bruto / receita", "Gross profit / revenue")],
      [L("Margem EBIT", "EBIT margin"), pct(i.mEbit), L("Resultado antes do financeiro / receita", "Operating income / revenue")],
      [L("Margem EBITDA", "EBITDA margin"), pct(i.mEbitda), L("EBIT + depreciação e amortização do fluxo de caixa", "EBIT + depreciation and amortization from the cash flow statement")],
      [L("Margem líquida", "Net margin"), pct(i.mLiq), L("Lucro líquido / receita", "Net income / revenue")],
      [L("Dív. líquida", "Net debt"), dinheiro(i.dividaLiq), L("Empréstimos e financiamentos − caixa e aplicações", "Loans and financing − cash and investments"), "divida"],
      [L("Dív. líq./EBITDA", "Net debt/EBITDA"), vezes(i.dlEbitda), L("Anos de geração operacional para quitar a dívida líquida", "Years of operating cash generation to repay net debt"), "divida"],
      [L("Dív. líq./PL", "Net debt/equity"), vezes(i.dlPl), L("Dívida líquida / patrimônio da controladora", "Net debt / shareholders' equity"), "divida"],
      [L("Dividendos pagos", "Dividends paid"), dinheiro(ultimo(serie(e, "dividendos_pagos"))), L("Dividendos e JCP pagos no ano (caixa)", "Dividends and interest on equity paid in the year (cash)")],
      [L("Dividendo/ação", "Dividend/share"), porAcao(i.dpa), L("Dividendos e JCP pagos no ano / ações em circulação", "Dividends and interest on equity paid / shares outstanding")],
      [L("Payout (caixa)", "Payout (cash)"), pct(i.payout, 0), L("Dividendos pagos no ano / lucro da controladora do ano", "Dividends paid in the year / net income to shareholders")],
      [L("Fluxo de caixa livre", "Free cash flow"), dinheiro(i.fcl), L("Caixa operacional − investimento em imobilizado e intangível", "Operating cash flow − capital expenditure")],
      [L("CAGR receita 5a", "Revenue CAGR 5y"), pct(i.cagrRec), L("Crescimento anual composto da receita em 5 anos", "Compound annual revenue growth over 5 years")],
      [L("CAGR lucro 5a", "Earnings CAGR 5y"), pct(i.cagrLuc), L("Crescimento anual composto do lucro em 5 anos", "Compound annual earnings growth over 5 years")],
    ];
    var cartoes = function (lista) {
      return '<div class="grade-ind">' + lista.map(function (c) {
        var negativo = c[3] !== "divida" && /^-|^R\$ -|^US\$ -/.test(c[1]);
        return '<div class="ind"><div class="r"><abbr title="' + esc(c[2]) + '">' + c[0] + '</abbr></div><div class="v ' + (negativo ? "neg" : "") + '">' + c[1] + "</div></div>";
      }).join("") + "</div>";
    };
    var titulo = function (id, chave, extra) { return '<div class="cab-secao"><h2>' + capitulo(secs, id) + (extra || t(chave)) + "</h2>"; };

    var blocos =
      '<section class="cartao secao" id="s-valuation">' + titulo("s-valuation", "sec_valuation") +
      '<span class="mudo sub">' + esc(tf("valuation_sub", data(cot && cot.data), i.d12 ? tf("sobre_12m", data(i.d12.ate)) : tf("sobre_balanco", i.ano))) + "</span></div>" +
      cartoes(valuation) + "</section>" +
      (doze12 ? '<section class="cartao secao" id="s-12m">' + titulo("s-12m", "sec_12m") +
        '<span class="mudo sub">' + L("Até ", "To ") + data(i.d12.ate) + " · DFP + ITR</span></div>" + cartoes(doze12) + "</section>" : "") +
      '<section class="cartao secao" id="s-fund">' + titulo("s-fund", "", tf("fund_titulo", i.ano)) +
      '<span class="mudo sub">' + (estado.moeda === "usd" ? t("convertidos") : t("em_reais")) + "</span></div>" + cartoes(cards) +
      (e.financeiro ? '<p class="aviso">' + t("aviso_fin") + "</p>" : "") + "</section>";

    var comp = '<section class="cartao secao" id="s-indice"><h2>' + capitulo(secs, "s-indice") + t("indice_titulo") + '</h2><div class="comp">' + (s ? componentes().map(function (c) {
      var v = s.componentes[c.id];
      if (v == null) {
        return '<div class="comp-item"><span class="nome">' + c.nome + '</span><span class="peso">' + t("sem_dado_peso") + "</span>" +
          '<span class="trilho"></span><span class="desc">' + t("sem_fin_detalhado") + "</span></div>";
      }
      return '<div class="comp-item"><span class="nome">' + c.nome + '</span><span class="peso num">' + v + "/100 · " + t("peso") + " " + c.peso + "</span>" +
        '<span class="trilho"><i style="width:' + v + '%"></i></span><span class="desc">' + c.desc + "</span></div>";
    }).join("") : '<p class="mudo">' + t("precisa_5") + "</p>") + "</div></section>";

    var periodo = '<div class="seg" role="group" aria-label="' + t("periodo") + '">' + [[5, t("a5")], [10, t("a10")], [0, t("tudo")]].map(function (p) {
      return '<button data-periodo="' + p[0] + '" aria-pressed="' + (estado.periodo === p[0]) + '">' + p[1] + "</button>";
    }).join("") + "</div>";

    var graficos =
      '<div class="duas bloco">' +
      '<section class="cartao"><h2>' + esc(tf("g_cotacao", ticker)) + '</h2><div class="grafico" id="g-cotacao"></div>' +
      '<p class="aviso">' + t("g_cotacao_aviso") + "</p></section>" +
      '<section class="cartao"><h2>' + t("g_mult") + '</h2><div class="grafico" id="g-multiplos"></div>' +
      '<p class="aviso">' + t("g_mult_aviso") + "</p></section></div>" +
      '<div class="duas bloco">' +
      '<section class="cartao"><h2>' + t("g_resultado") + '</h2><div class="grafico" id="g-resultado"></div></section>' +
      '<section class="cartao"><h2>' + t("g_margens") + '</h2><div class="grafico" id="g-margens"></div></section></div>' +
      '<div class="duas bloco">' +
      '<section class="cartao"><h2>' + (e.financeiro ? t("g_pl") : t("g_divida")) + '</h2><div class="grafico" id="g-divida"></div></section>' +
      '<section class="cartao"><h2>' + t("g_caixa") + '</h2><div class="grafico" id="g-caixa"></div></section></div>' +
      '<div class="duas bloco">' +
      '<section class="cartao"><h2>' + t("g_dividendos") + '</h2><div class="grafico" id="g-dividendos"></div></section>' + comp + "</div>";

    app.innerHTML = cab + nav +
      '<div class="corpo-empresa">' + blocos +
      '<div class="cab-secao bloco secao" id="s-hist" style="margin-top:28px"><h2>' + capitulo(secs, "s-hist") + t("sec_hist") + "</h2>" + periodo + "</div>" + graficos +
      '<section class="cartao bloco secao" id="s-dem"><h2>' + capitulo(secs, "s-dem") + t("dem_titulo") + '</h2><div class="tabela-wrap" id="t-dem"></div></section>' +
      '<section class="cartao bloco metodo secao" id="s-metodo"><details><summary>' + capitulo(secs, "s-metodo") + t("metodo_titulo") + "</summary><ul>" +
      window.I18N_METODO[estado.lingua].map(function (li) { return "<li>" + esc(li) + "</li>"; }).join("") +
      "</ul></details></section></div>";

    $$("[data-periodo]", app).forEach(function (b) {
      b.addEventListener("click", function () {
        estado.periodo = +b.getAttribute("data-periodo");
        $$("[data-periodo]", app).forEach(function (x) { x.setAttribute("aria-pressed", String(x === b)); });
        desenharEmpresa(e);
      });
    });
    $$("[data-ir]", app).forEach(function (a) {
      a.addEventListener("click", function (ev) {
        ev.preventDefault();
        var alvo = document.getElementById(a.getAttribute("data-ir"));
        if (!alvo) return;
        var det = alvo.querySelector("details");
        if (det) det.open = true;
        alvo.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
      });
    });
    desenharEmpresa(e);
    observarSecoes();
  }

  // ---------------------------------------------------------------- navegação por seções

  var observador = null;
  function observarSecoes() {
    if (observador) observador.disconnect();
    var nav = $(".secoes");
    if (!nav || !("IntersectionObserver" in window)) return;
    var links = $$("a[data-ir]", nav);
    var marcar = function (id) {
      links.forEach(function (a) { a.classList.toggle("ativa", a.getAttribute("data-ir") === id); });
      var ativo = $("a.ativa", nav), ol = $("ol", nav);
      if (ativo && ol.scrollWidth > ol.clientWidth) {  // barra horizontal: mantém o item ativo visível
        ol.scrollTo({ left: Math.max(0, ativo.parentNode.offsetLeft - ol.offsetLeft - 24), behavior: "smooth" });
      }
    };
    observador = new IntersectionObserver(function (entradas) {
      var visiveis = entradas.filter(function (x) { return x.isIntersecting; });
      if (visiveis.length) marcar(visiveis[0].target.id);
    }, { rootMargin: "-30% 0px -60% 0px" });
    $$(".secao[id]").forEach(function (s) { observador.observe(s); });
    marcar(links.length ? links[0].getAttribute("data-ir") : "");
    progresso();
  }

  /** fração da página já rolada, para o trilho de progresso da navegação */
  function progresso() {
    var nav = $(".secoes");
    if (!nav) return;
    var h = document.documentElement.scrollHeight - window.innerHeight;
    nav.style.setProperty("--progresso", h > 0 ? Math.min(1, window.scrollY / h) : 0);
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

    var tk = e.precos_ano[estado.ticker] ? estado.ticker : e.ticker;
    var px = precosAno(e, tk);
    if (px) {
      linhas($("#g-cotacao"), anos, [{ nome: tk, cor: "var(--c1)", v: px.slice(ini) }], porAcao,
        { eixo: function (v) { return nf(v >= 100 ? 0 : 2).format(v); }, limites: null });
    } else {
      $("#g-cotacao").innerHTML = '<p class="mudo">' + esc(tf("sem_cot_ano", tk)) + "</p>";
    }
    var mult = anos.map(function (a, k) { return multiplos(e, e.series.valor_mercado[ini + k], ini + k); });
    linhas($("#g-multiplos"), anos, [
      { nome: L("P/L", "P/E"), cor: "var(--c3)", v: mult.map(function (m) { return m.pl; }) },
      { nome: L("P/VP", "P/B"), cor: "var(--c4)", v: mult.map(function (m) { return m.pvp; }) },
    ], vezes, { eixo: function (v) { return nf(0).format(v) + "x"; }, limites: [0, 60] });
    var rec = r.s("receita"), ll = r.s("lucro_liquido");
    barras($("#g-resultado"), anos, [
      { nome: t("s_receita"), cor: "var(--c1)", v: rec },
      { nome: t("s_lucro"), cor: "var(--c2)", v: ll },
    ], dinheiro);

    var margem = function (num) { return num.map(function (v, k) { return div(v, rec[k]); }); };
    var linhasM = [{ nome: t("s_mliq"), cor: "var(--c2)", v: margem(ll) }];
    if (!e.financeiro) {
      linhasM.unshift({ nome: t("s_mebit"), cor: "var(--c3)", v: margem(r.s("ebit")) });
      linhasM.unshift({ nome: t("s_mbruta"), cor: "var(--c1)", v: margem(r.s("lucro_bruto")) });
    }
    linhas($("#g-margens"), anos, linhasM, function (v) { return pct(v); });

    if (e.financeiro) {
      barras($("#g-divida"), anos, [{ nome: t("s_pl"), cor: "var(--c4)", v: r.s("pl") }], dinheiro);
    } else {
      barras($("#g-divida"), anos, [
        { nome: t("s_dl"), cor: "var(--c5)", v: r.s("divida_liquida") },
        { nome: t("s_ebitda"), cor: "var(--c3)", v: r.s("ebitda") },
      ], dinheiro);
    }

    var neg = function (arr) { return arr.map(function (v) { return v == null ? null : -v; }); };
    barras($("#g-caixa"), anos, [
      { nome: t("s_fco"), cor: "var(--c2)", v: r.s("fco") },
      { nome: t("s_capex"), cor: "var(--c5)", v: neg(r.s("capex")) },
      { nome: t("s_dividendos"), cor: "var(--c4)", v: neg(r.s("dividendos_pagos")) },
    ], dinheiro);

    var acoes = e.series.acoes.slice(e.anos.length - anos.length);
    var dvd = r.s("dividendos_pagos");
    barras($("#g-dividendos"), anos, [{ nome: t("s_total_pago"), cor: "var(--c4)", v: dvd }], dinheiro, {
      extra: function (k) {
        var out = [];
        if (acoes[k] && dvd[k] != null) out.push([t("s_por_acao"), porAcao(dvd[k] * 1000 / acoes[k])]);
        if (mult[k].dy != null) out.push([t("s_yield_ano"), pct(mult[k].dy)]);
        return out;
      },
    });

    tabelaDemonstracoes(e, r);
  }

  function tabelaDemonstracoes(e, r) {
    var anos = r.anos;
    var lin = [
      ["d_receita", "receita"], ["d_bruto", "lucro_bruto", 1], ["d_ebit", "ebit", 1], ["d_ebitda", "ebitda", 1],
      ["d_lucro", "lucro_liquido"], ["d_controladora", "lucro_controladora", 1],
      ["d_ativo", "ativo_total"], ["d_pl", "pl"], ["d_div_bruta", "divida_bruta", 1], ["d_caixa", "caixa", 1],
      ["d_dl", "divida_liquida", 1], ["d_fco", "fco"], ["d_capex", "capex", 1], ["d_dvd", "dividendos_pagos", 1],
    ];
    $("#t-dem").innerHTML = '<table class="tabela-dem"><thead><tr><th>' + simbolo() + "</th>" +
      anos.map(function (a) { return "<th>" + a + "</th>"; }).join("") + "</tr></thead><tbody>" +
      lin.map(function (l) {
        var v = r.s(l[1]);
        if (v.every(function (x) { return x == null; })) return "";
        return '<tr class="' + (l[2] ? "sub" : "") + '"><td>' + t(l[0]) + "</td>" +
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
    for (var x = lo; x <= hi + passo / 2; x += passo) ticks.push(Math.abs(x) < passo / 1e6 ? 0 : x);
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
      esc_.ticks.map(function (tk) {
        return '<line class="' + (tk === 0 ? "zero" : "grade") + '" x1="' + M.l + '" x2="' + (w - M.r) + '" y1="' + y(tk) + '" y2="' + y(tk) + '"/>' +
          '<text class="eixo" x="' + (M.l - 8) + '" y="' + (y(tk) + 4) + '" text-anchor="end">' + fmtEixo(tk) + "</text>";
      }).join("") +
      anos.map(function (a, k) {
        return k % passoRot === (anos.length - 1) % passoRot ? '<text class="eixo" x="' + x(k) + '" y="' + (h - 6) + '" text-anchor="middle">' + a + "</text>" : "";
      }).join("");
    return { w: w, h: h, x: x, y: y, bw: bw, svg: svg, ih: ih };
  }

  function legenda(series, linha) {
    return '<div class="legenda">' + series.map(function (s) {
      return '<span><i class="' + (linha ? "linha" : "") + '" style="--c:' + s.cor + '"></i>' + esc(s.nome) + "</span>";
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
        return '<div><span><i style="--c:' + s.cor + '"></i>' + esc(s.nome) + '</span><span class="num">' + fmt(s.v[k]) + "</span></div>";
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
    if (!todos.some(function (v) { return v != null; })) { el.innerHTML = '<p class="mudo">' + t("sem_dados") + "</p>"; return; }
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
    if (!todos.some(function (v) { return v != null; })) { el.innerHTML = '<p class="mudo">' + t("sem_dados") + "</p>"; return; }
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
        return e.tickers.some(function (tk) { return norm(tk).indexOf(q) === 0; }) || norm(e.nome).indexOf(q) >= 0;
      }).slice(0, 8);
      sel = achados.length ? 0 : -1;
      lista.innerHTML = achados.map(function (e, k) {
        var tk = e.tickers.filter(function (x) { return norm(x).indexOf(q) === 0; })[0] || e.ticker;
        return '<li role="option" data-t="' + tk + '" aria-selected="' + (k === sel) + '"><b>' + tk + "</b><span>" + esc(nomeCurto(e.nome)) + "</span></li>";
      }).join("") || '<li class="mudo">' + t("nada_encontrado") + "</li>";
      lista.hidden = false;
    }
    function ir(tk) { location.hash = "#/" + tk; input.value = ""; lista.hidden = true; input.blur(); }
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
    if (observador) { observador.disconnect(); observador = null; }
    if (m) telaEmpresa(m[1].toUpperCase()); else telaRanking();
  }

  /** textos fixos do index.html (data-i18n, data-i18n-html, data-i18n-ph, data-i18n-aria) */
  function aplicarLingua() {
    document.documentElement.lang = estado.lingua === "en" ? "en" : "pt-BR";
    $$("[data-i18n]").forEach(function (el) { el.textContent = t(el.getAttribute("data-i18n")); });
    $$("[data-i18n-html]").forEach(function (el) { el.innerHTML = t(el.getAttribute("data-i18n-html")); });
    $$("[data-i18n-ph]").forEach(function (el) { el.placeholder = t(el.getAttribute("data-i18n-ph")); });
    $$("[data-i18n-aria]").forEach(function (el) { el.setAttribute("aria-label", t(el.getAttribute("data-i18n-aria"))); });
    $$("[data-lingua]").forEach(function (b) { b.setAttribute("aria-pressed", String(b.getAttribute("data-lingua") === estado.lingua)); });
    $("#gerado").textContent = tf("rodape_gerado", D.gerado_em, D.ano_final, nf(4).format(D.ptax[String(D.ano_final)].media));
  }

  function aplicarMoeda() {
    $$("[data-moeda]").forEach(function (b) { b.setAttribute("aria-pressed", String(b.getAttribute("data-moeda") === estado.moeda)); });
  }

  /** altura do cabeçalho fixo, para a barra de seções grudar logo abaixo dele */
  function medirTopo() {
    document.documentElement.style.setProperty("--topo-h", $(".topo").offsetHeight + "px");
  }

  function redesenhar() {
    var rolagem = window.scrollY; rota(); window.scrollTo(0, rolagem);
  }

  function iniciar() {
    $$("[data-moeda]").forEach(function (b) {
      b.addEventListener("click", function () {
        estado.moeda = b.getAttribute("data-moeda"); gravar("lastro-moeda", estado.moeda); aplicarMoeda(); redesenhar();
      });
    });
    $$("[data-lingua]").forEach(function (b) {
      b.addEventListener("click", function () {
        estado.lingua = b.getAttribute("data-lingua"); gravar("lastro-lingua", estado.lingua); aplicarLingua(); redesenhar();
      });
    });
    aplicarMoeda();
    aplicarLingua();

    var tema = ler("lastro-tema");
    if (tema) document.documentElement.setAttribute("data-theme", tema);
    $("#tema").addEventListener("click", function () {
      var atual = document.documentElement.getAttribute("data-theme") ||
        (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
      var novo = atual === "dark" ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", novo); gravar("lastro-tema", novo);
    });

    var tm;
    window.addEventListener("resize", function () {
      clearTimeout(tm);
      tm = setTimeout(function () {
        medirTopo();
        var m = location.hash.match(/^#\/([A-Z0-9]+)/i);
        if (m && POR_TICKER[m[1].toUpperCase()]) desenharEmpresa(POR_TICKER[m[1].toUpperCase()]);
      }, 150);
    });
    window.addEventListener("scroll", progresso, { passive: true });
    window.addEventListener("hashchange", function () { rota(); window.scrollTo(0, 0); });
    medirTopo();
    busca();
    rota();
  }

  iniciar();
})();
