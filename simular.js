/* Real Terms — simulador (#/simular/PETR4,VALE3/2020-01-02/10000).
 *
 * Passado: compra de uma ou mais ações (valor dividido em partes iguais) no fechamento do dia escolhido
 * (ou do primeiro pregão do ano), seguida até o último pregão: valorização, desdobramentos e grupamentos,
 * dividendos, JCP (com 15% de IR retido, se marcado) e rendimentos, com ou sem reinvestimento na data de
 * pagamento. Comparação com o CDI e o IPCA do mesmo período.
 * Futuro: projeção de 5 anos da carteira de hoje, em três cenários (pessimista, referência e otimista =
 * percentis 10, 50 e 90). O centro vem dos fundamentos (dividend yield sustentável + crescimento do lucro
 * por ação + reprecificação parcial do P/L); a dispersão, da volatilidade semanal de 3 anos e das
 * correlações entre as ações. Pressupostos à mostra. Teoria e parâmetros: docs/metodologia-simulacao.md.
 *
 * Dados sob demanda: data/historico/<TICKER>.js e data/historico/_indices.js (scripts/historico.py).
 * Não é recomendação de investimento. */
(function () {
  "use strict";

  var IR_JCP = 0.15;          // IR retido na fonte sobre JCP (pessoa física)
  var ANOS = 5;               // horizonte da projeção
  var SEMANAS = 156;          // janela da volatilidade e das correlações (3 anos)
  var SIGMA_PRIOR = 0.35;     // volatilidade anual de referência para quem tem pouco histórico
  var RHO_PRIOR = 0.45;       // correlação de referência entre ações brasileiras
  var CRESC_REAL = 0.02;      // crescimento real de longo prazo do lucro (pressuposto)
  var ENCOLHE = 0.5;          // quanto a referência de cada ação é puxada para a mediana do mercado
  var Z = { p10: -1.2816, p25: -0.6745, p50: 0, p75: 0.6745, p90: 1.2816 };
  var MAX_ACOES = 8;

  // ---------------------------------------------------------------- dados sob demanda

  var promessas = {};
  function versao() { var D = window.DADOS || {}; return String(D.cotacoes_em || D.gerado_em || "").replace(/\D/g, ""); }
  /** carrega data/historico/<nome>.js uma vez (tag script: funciona também abrindo o arquivo local) */
  function carregar(nome) {
    if (nome !== "_indices" && window.HIST && window.HIST[nome]) return Promise.resolve();
    if (nome === "_indices" && window.INDICES) return Promise.resolve();
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
  var decodificadas = {};
  /** histórico compacto do ticker → { datas, precos, ev: [[data ex, fator, tipo, origem]], pv: [[com, R$, tipo, pagamento]] } */
  function decodificar(h) {
    if (decodificadas[h.t] && decodificadas[h.t].h === h) return decodificadas[h.t];
    var datas = datasDe(h.d0, h.dd), precos = new Array(datas.length), p = h.p0;
    precos[0] = p / h.esc;
    for (var i = 0; i < h.dp.length; i++) { p += h.dp[i]; precos[i + 1] = p / h.esc; }
    var s = { h: h, t: h.t, datas: datas, precos: precos, ev: h.ev || [], pv: h.pv || [], cod: h.cod || [], ate: h.ate };
    decodificadas[h.t] = s;
    return s;
  }
  /** última posição com datas[i] <= d (-1 se nenhuma) */
  function ate(datas, d) {
    var lo = 0, hi = datas.length;
    while (lo < hi) { var m = (lo + hi) >> 1; if (datas[m] <= d) lo = m + 1; else hi = m; }
    return lo - 1;
  }
  function desde(datas, d) { var i = ate(datas, d); return i >= 0 && datas[i] === d ? i : i + 1; }

  /** índices do BCB decodificados: CDI (acumulado por dia), PTAX (por dia), IPCA (acumulado no fim de cada mês) */
  var idx = null;
  function indices() {
    var I = window.INDICES;
    if (!I) return null;
    if (idx && idx.I === I) return idx;
    idx = { I: I, cdiAa: I.cdi_aa, ipca12: I.ipca_12m, ipcaAte: I.ipca_ate };
    if (I.cdi) idx.cdi = { datas: datasDe(I.cdi.d0, I.cdi.dd), v: I.cdi.i };
    if (I.ptax) idx.ptax = { datas: datasDe(I.ptax.d0, I.ptax.dd), v: I.ptax.v };
    if (I.ipca) idx.ipca = I.ipca;
    return idx;
  }
  function valorEm(serie, d) { if (!serie) return null; var i = ate(serie.datas, d); return i >= 0 ? serie.v[i] : null; }
  function mesesDesde(m0, d) { return (+d.slice(0, 4) - +m0.slice(0, 4)) * 12 + (+d.slice(5, 7) - +m0.slice(5, 7)); }
  /** nível do IPCA no começo do mês da data d (1 = começo do primeiro mês da série) */
  function ipcaInicio(ipca, d) { var k = mesesDesde(ipca.m0, d); return k <= 0 ? 1 : ipca.i[Math.min(k, ipca.i.length) - 1]; }
  /** nível do IPCA no fim do mês da data d (o último publicado, se d vai além) */
  function ipcaFim(ipca, d) { var k = mesesDesde(ipca.m0, d); return k < 0 ? 1 : ipca.i[Math.min(k, ipca.i.length - 1)]; }

  // ---------------------------------------------------------------- passado

  /** Compra de `valor` (R$) no fechamento do primeiro pregão em ou depois de `data` e segue até o último
   *  pregão. Calcula os dois modos lado a lado: sem reinvestir (proventos viram caixa) e reinvestindo
   *  (cada provento compra ações no fechamento do dia do pagamento). Provento ainda não pago conta como
   *  a receber. op = { irJcp: bool }. */
  function simularTicker(s, data, valor, op) {
    op = op || {};
    var i0 = desde(s.datas, data), fim = s.datas.length - 1;
    if (i0 > fim) return null;
    var dCompra = s.datas[i0], hoje = s.datas[fim];
    var acoes = valor / s.precos[i0], acoesR = acoes;
    var caixa = 0, pendente = 0, pendenteR = 0;
    var recebido = { dividendo: 0, jcp: 0, outros: 0, ir: 0 };
    var porAno = {};
    var atos = [], aplicados = [];
    s.ev.forEach(function (ev) { if (ev[0] > dCompra && ev[0] <= hoje) atos.push({ d: ev[0], o: 0, ev: ev }); });
    s.pv.forEach(function (p) {
      if (p[0] < dCompra || p[0] > hoje) return;
      var x = { com: p[0], v: p[1], tipo: p[2], pag: p[3], liq: 0, liqR: 0 };
      atos.push({ d: x.com, o: 1, x: x });
      if (x.pag && x.pag <= hoje) atos.push({ d: x.pag, o: 2, x: x });
    });
    atos.sort(function (a, b) { return a.d < b.d ? -1 : a.d > b.d ? 1 : a.o - b.o; });
    var k = 0, mensal = [];
    function processar(d, preco) {
      while (k < atos.length && atos[k].d <= d) {
        var a = atos[k++];
        if (a.o === 0) {
          acoes *= a.ev[1]; acoesR *= a.ev[1];
          aplicados.push(a.ev);
        } else if (a.o === 1) {
          var x = a.x, f = x.tipo === "jcp" && op.irJcp ? 1 - IR_JCP : 1;
          x.liq = acoes * x.v * f; x.liqR = acoesR * x.v * f;
          var chave = x.tipo === "dividendo" || x.tipo === "jcp" ? x.tipo : "outros";
          recebido[chave] += x.liq;
          if (f < 1) recebido.ir += acoes * x.v * IR_JCP;
          porAno[x.com.slice(0, 4)] = (porAno[x.com.slice(0, 4)] || 0) + x.liq;
          pendente += x.liq; pendenteR += x.liqR;
        } else {
          caixa += a.x.liq; pendente -= a.x.liq; pendenteR -= a.x.liqR;
          acoesR += a.x.liqR / preco;   // reinveste no fechamento do pagamento
        }
      }
    }
    for (var i = i0; i <= fim; i++) {
      // pagamento em dia sem pregão do papel: reinveste no último fechamento antes dele
      processar(s.datas[i], s.precos[i]);
      if (i === fim || s.datas[i + 1].slice(0, 7) !== s.datas[i].slice(0, 7) || i === i0) {
        mensal.push({ d: s.datas[i], v: acoes * s.precos[i] + caixa + pendente, vR: acoesR * s.precos[i] + pendenteR });
      }
    }
    var pFim = s.precos[fim];
    var proventos = recebido.dividendo + recebido.jcp + recebido.outros;
    return {
      t: s.t, dCompra: dCompra, pCompra: s.precos[i0], hoje: hoje, pHoje: pFim, investido: valor,
      acoes0: valor / s.precos[i0], acoes: acoes, acoesR: acoesR, eventos: aplicados,
      valor: acoes * pFim + caixa + pendente, valorR: acoesR * pFim + pendenteR,
      emAcoes: acoes * pFim, emAcoesR: acoesR * pFim, aReceber: pendente, aReceberR: pendenteR,
      valorizacao: acoes * pFim - valor, proventos: proventos, recebido: recebido, porAno: porAno, mensal: mensal,
    };
  }

  /** Carteira: o valor dividido em partes iguais. Ação que ainda não negociava na data compra no primeiro
   *  pregão dela; até lá, a parte dela fica parada em dinheiro. */
  function simularCarteira(series, data, valor, op) {
    var parte = valor / series.length;
    var itens = series.map(function (s) { return simularTicker(s, data, parte, op); });
    if (itens.some(function (x) { return !x; })) return null;
    var meses = {};
    itens.forEach(function (x) { x.mensal.forEach(function (m) { meses[m.d.slice(0, 7)] = true; }); });
    var chaves = Object.keys(meses).sort();
    var linha = chaves.map(function (mes) {
      var v = 0, vR = 0, d = "";
      itens.forEach(function (x) {
        var ult = null;
        for (var j = 0; j < x.mensal.length && x.mensal[j].d.slice(0, 7) <= mes; j++) ult = x.mensal[j];
        if (ult) { v += ult.v; vR += ult.vR; if (ult.d > d) d = ult.d; } else { v += parte; vR += parte; }
      });
      return { mes: mes, d: d, v: v, vR: vR };
    });
    var soma = function (f) { return itens.reduce(function (a, x) { return a + f(x); }, 0); };
    var dCompra = itens.reduce(function (a, x) { return x.dCompra < a ? x.dCompra : a; }, "9999");
    var hoje = itens.reduce(function (a, x) { return x.hoje > a ? x.hoje : a; }, "");
    return {
      itens: itens, linha: linha, investido: valor, dCompra: dCompra, hoje: hoje,
      valor: soma(function (x) { return x.valor; }), valorR: soma(function (x) { return x.valorR; }),
      valorizacao: soma(function (x) { return x.valorizacao; }), proventos: soma(function (x) { return x.proventos; }),
      dividendos: soma(function (x) { return x.recebido.dividendo; }), jcp: soma(function (x) { return x.recebido.jcp; }),
      outros: soma(function (x) { return x.recebido.outros; }), ir: soma(function (x) { return x.recebido.ir; }),
      aReceber: soma(function (x) { return x.aReceber; }), aReceberR: soma(function (x) { return x.aReceberR; }),
    };
  }

  function anual(total, d0, d1) {
    var anos = (Date.parse(d1) - Date.parse(d0)) / (365.25 * 864e5);
    return anos >= 1 / 12 && total > -1 ? Math.pow(1 + total, 1 / anos) - 1 : null;
  }

  // ---------------------------------------------------------------- futuro: pressupostos

  function clip(v, a, b) { return v == null || !isFinite(v) ? null : Math.max(a, Math.min(b, v)); }
  function ultimoNum(arr) { for (var i = (arr || []).length - 1; i >= 0; i--) if (arr[i] != null) return arr[i]; return null; }
  function mediana(arr) {
    var a = arr.filter(function (v) { return v != null && isFinite(v); }).sort(function (x, y) { return x - y; });
    if (!a.length) return null;
    var m = a.length >> 1;
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  }

  /** Retorno total semanal (log) do ticker: fechamento da última sessão de cada semana, com desdobramentos
   *  e proventos (bruto, reinvestido na data-com) somados. { semana 'AAAA-Www': log do índice } */
  function indiceSemanal(s) {
    var tri = 0, out = {}, ev = {}, pv = {};
    s.ev.forEach(function (e) { ev[e[0]] = (ev[e[0]] || 1) * e[1]; });
    s.pv.forEach(function (p) { pv[p[0]] = (pv[p[0]] || 0) + p[1]; });
    for (var i = 1; i < s.datas.length; i++) {
      var f = ev[s.datas[i]] || 1, dv = pv[s.datas[i - 1]] || 0;
      tri += Math.log((s.precos[i] * f + dv) / s.precos[i - 1]);
      out[semana(s.datas[i])] = tri;
    }
    return out;
  }
  function semana(d) {
    var t = new Date(d + "T12:00:00Z"), dia = (t.getUTCDay() + 6) % 7;   // segunda = 0
    t.setUTCDate(t.getUTCDate() - dia + 3);                                 // quinta da mesma semana (ISO)
    var ano = t.getUTCFullYear(), primeira = new Date(Date.UTC(ano, 0, 4));
    var n = 1 + Math.round(((t - primeira) / 864e5 - 3 + ((primeira.getUTCDay() + 6) % 7)) / 7);
    return ano + "-W" + (n < 10 ? "0" : "") + n;
  }
  /** retornos semanais das últimas SEMANAS semanas: { semana: log-retorno } */
  function retornosSemanais(s) {
    var ind = indiceSemanal(s), chaves = Object.keys(ind).sort(), out = {};
    chaves = chaves.slice(Math.max(0, chaves.length - SEMANAS - 1));
    for (var i = 1; i < chaves.length; i++) out[chaves[i]] = ind[chaves[i]] - ind[chaves[i - 1]];
    return out;
  }
  function volatilidade(ret) {
    var v = Object.keys(ret).map(function (k) { return ret[k]; });
    var n = v.length;
    if (n < 8) return { sigma: SIGMA_PRIOR, hist: null, n: n };
    var m = v.reduce(function (a, x) { return a + x; }, 0) / n;
    var hist = Math.sqrt(v.reduce(function (a, x) { return a + (x - m) * (x - m); }, 0) / (n - 1) * 52);
    // pouco histórico puxa para a referência: meio ano de "observações" dela
    var sigma = (n * hist + 26 * SIGMA_PRIOR) / (n + 26);
    return { sigma: clip(sigma, 0.12, 0.9), hist: hist, n: n };
  }
  function correlacao(a, b) {
    var ks = Object.keys(a).filter(function (k) { return k in b; });
    if (ks.length < 52) return { rho: RHO_PRIOR, hist: null, n: ks.length };
    var ma = 0, mb = 0;
    ks.forEach(function (k) { ma += a[k]; mb += b[k]; });
    ma /= ks.length; mb /= ks.length;
    var sab = 0, saa = 0, sbb = 0;
    ks.forEach(function (k) { var x = a[k] - ma, y = b[k] - mb; sab += x * y; saa += x * x; sbb += y * y; });
    var hist = saa && sbb ? sab / Math.sqrt(saa * sbb) : RHO_PRIOR;
    return { rho: 0.75 * hist + 0.25 * RHO_PRIOR, hist: hist, n: ks.length };
  }

  /** Blocos do retorno de uma ação só com a base anual (frações ao ano, antes do IR do JCP):
   *  dividend yield sustentável, crescimento do lucro por ação e reprecificação do P/L.
   *  - O dividend yield se sustenta se o lucro de 12 meses ou o normalizado (mediana dos 5 últimos
   *    exercícios, Graham e Dodd) o cobrem: lucro deprimido por um ano ruim não zera o provento.
   *  - A reprecificação compara o P/L de hoje com a mediana da própria empresa e pesa pelo índice de
   *    previsibilidade: em empresa cíclica, P/L baixo no pico do lucro (ou alto no vale) não é sinal. */
  function fundamentos(e, t, ctx, dyHist) {
    var X = window.RealTerms, ind = X.indicadores(e), vmHoje = e.valor_mercado;
    if (!(vmHoje > 0)) return null;
    var lc = e.series.lucro_controladora || [], vm = e.series.valor_mercado || [];
    var lucro12 = e.ttm && e.ttm.lucro_controladora != null ? e.ttm.lucro_controladora : ultimoNum(lc);
    var cinco = lc.slice(Math.max(0, lc.length - 5)).filter(function (v) { return v != null; });
    var eyAtual = lucro12 != null ? lucro12 / vmHoje : null;
    var eyNorm = cinco.length >= 3 ? mediana(cinco) / vmHoje : null;
    var ey = Math.max(eyAtual != null ? eyAtual : -1, eyNorm != null ? eyNorm : -1);
    if (ey === -1) ey = null;
    // proventos de 12 meses: do histórico do ticker (inclui os do código antigo), senão da base (o maior
    // entre as classes da empresa: a ficha às vezes não lista a unit), senão os pagos no exercício (DFP)
    var dyBase = e.dy12m ? Math.max.apply(null, [0].concat(Object.keys(e.dy12m).map(function (k) { return e.dy12m[k] || 0; }))) : 0;
    var dy12 = dyHist > 0 ? dyHist : e.dy12m && e.dy12m[t] > 0 ? e.dy12m[t] : dyBase > 0 ? dyBase : (ind.dyExercicio || 0);
    var dy = dy12, dyNota = "12m";
    if (ey == null || ey <= 0) { dy = 0; dyNota = "prejuizo"; }
    else if (dy12 > ey) { dy = ey; dyNota = "lucro"; }
    if (dy > 0.15) { dy = 0.15; dyNota = "teto"; }
    // crescimento do lucro por ação: histórico (5 anos), sustentável (ROE × retenção) e longo prazo (IPCA + real)
    var gLp = (1 + (ctx.ipca != null ? ctx.ipca : 0.04)) * (1 + CRESC_REAL) - 1;
    var gHist = ind.lpaCagr != null ? clip(ind.lpaCagr, -0.1, 0.2) : null;
    var roe = ind.roe12 != null ? ind.roe12 : ind.roe;
    var payout = ey > 0 ? Math.min(1, dy12 / ey) : null;
    var gSust = roe != null && roe > 0 && payout != null ? clip(roe * (1 - payout), 0, 0.2) : null;
    var score = e.score && e.score.brl ? e.score.brl.total : 50;
    var wHist = gHist != null ? 0.4 * score / 100 : 0, wSust = gSust != null ? 0.3 : 0, wLp = 1 - wHist - wSust;
    var g = wHist * (gHist || 0) + wSust * (gSust || 0) + wLp * gLp;
    // reprecificação: metade da distância entre o P/L de hoje e a mediana do P/L da empresa em 10 anos, em 5 anos
    var plHoje = eyAtual > 0 ? 1 / eyAtual : null, pls = [];
    for (var k = Math.max(0, e.anos.length - 10); k < e.anos.length; k++) if (vm[k] > 0 && lc[k] > 0) pls.push(vm[k] / lc[k]);
    var plMed = pls.length >= 5 ? mediana(pls) : null;
    var vCheio = plHoje && plMed ? clip(Math.pow(plMed / plHoje, 0.5 / ANOS) - 1, -0.04, 0.04) : 0;
    var v = vCheio * score / 100;
    return {
      ey: ey, eyAtual: eyAtual, eyNorm: eyNorm, dy12: dy12, dy: dy, dyNota: dyNota,
      gHist: gHist, gSust: gSust, gLp: gLp, pesos: { hist: wHist, sust: wSust, lp: wLp }, g: g, score: score,
      roe: roe, payout: payout, plHoje: plHoje, plMed: plMed, nPl: pls.length, vCheio: vCheio, v: v,
      rBruto: (1 + dy) * (1 + g) * (1 + v) - 1,
    };
  }

  /** retorno de referência do mercado: média dos retornos de referência (antes do encolhimento) de todas
   *  as empresas da base, pesada pelo valor de mercado, como numa carteira do mercado inteiro */
  var ancora = { chave: null, valor: null };
  function ancoraMercado(ctx) {
    var chave = String(ctx.ipca) + "|" + (window.DADOS && window.DADOS.gerado_em);
    if (ancora.chave !== chave) {
      var soma = 0, peso = 0;
      window.RealTerms.EMPRESAS.forEach(function (e) {
        var f = fundamentos(e, e.ticker, ctx);
        if (f && isFinite(f.rBruto)) { soma += e.valor_mercado * f.rBruto; peso += e.valor_mercado; }
      });
      ancora = { chave: chave, valor: peso ? soma / peso : null };
    }
    return ancora.valor;
  }

  /** Pressupostos de uma ação: os blocos do retorno (fundamentos), o IR do JCP pela proporção de JCP nos
   *  proventos de 12 meses, o encolhimento para a mediana do mercado e a volatilidade semanal de 3 anos.
   *  Previsão de retorno de uma ação isolada erra muito: a referência fica a meio caminho entre o que os
   *  fundamentos dela dizem e a mediana do mercado. */
  function pressupostos(e, t, s, ctx) {
    var hoje = s.datas[s.datas.length - 1], umAno = iso(Date.parse(hoje) - 365 * 864e5);
    var prov12 = 0, jcp12 = 0;
    s.pv.forEach(function (p) { if (p[0] > umAno && p[0] <= hoje) { prov12 += p[1]; if (p[2] === "jcp") jcp12 += p[1]; } });
    var f = fundamentos(e, t, ctx, prov12 / s.precos[s.precos.length - 1]) ||
      { dy: 0, dy12: 0, dyNota: "prejuizo", g: 0, v: 0, vCheio: 0, pesos: { hist: 0, sust: 0, lp: 1 }, gLp: 0, rBruto: 0 };
    var fracJcp = prov12 > 0 ? jcp12 / prov12 : 0;
    var dyLiq = f.dy * (1 - (ctx.irJcp ? IR_JCP * fracJcp : 0));
    var rProprio = (1 + dyLiq) * (1 + f.g) * (1 + f.v) - 1;
    var mercado = ancoraMercado(ctx);
    var r = clip(rProprio + (mercado != null ? ENCOLHE * (mercado - f.rBruto) : 0), -0.15, 0.3);
    var ret = retornosSemanais(s), vol = volatilidade(ret);
    return Object.assign({}, f, {
      t: t, e: e, preco: s.precos[s.precos.length - 1], fracJcp: fracJcp, dyLiq: dyLiq,
      rProprio: rProprio, mercado: mercado, r: r,
      sigma: vol.sigma, sigmaHist: vol.hist, nSemanas: vol.n, retornos: ret,
    });
  }

  // ---------------------------------------------------------------- futuro: carteira e cenários

  function phi(x) {   // normal padrão acumulada (Abramowitz e Stegun 7.1.26)
    var t = 1 / (1 + 0.3275911 * Math.abs(x) / Math.SQRT2), y = Math.exp(-x * x / 2);
    var erf = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * y;
    return x >= 0 ? (1 + erf) / 2 : (1 - erf) / 2;
  }

  /** Projeção de `w0` (R$) com pesos w (soma 1) sobre os pressupostos ps. O logaritmo do patrimônio em τ anos
   *  é normal: média τ·ln(1 + r) (a referência é a mediana) e desvio σ·√τ, com σ da carteira pelas
   *  volatilidades e correlações. ctx = { cdi, ipca } ao ano. */
  function projetar(ps, w, w0, ctx) {
    var n = ps.length, r = 0, varp = 0, rhos = [];
    for (var i = 0; i < n; i++) r += w[i] * ps[i].r;
    for (i = 0; i < n; i++) for (var j = 0; j < n; j++) {
      var rho = i === j ? 1 : correlacao(ps[i].retornos, ps[j].retornos).rho;
      if (i < j) rhos.push(rho);
      varp += w[i] * w[j] * ps[i].sigma * ps[j].sigma * rho;
    }
    var sigma = Math.sqrt(Math.max(varp, 1e-6)), mu = Math.log(1 + r);
    var anos = [];
    for (var a = 0; a <= ANOS; a++) {
      var linha = { ano: a };
      Object.keys(Z).forEach(function (q) { linha[q] = w0 * Math.exp(mu * a + Z[q] * sigma * Math.sqrt(a)); });
      if (ctx.cdi != null) linha.cdi = w0 * Math.pow(1 + ctx.cdi, a);
      anos.push(linha);
    }
    var raiz = sigma * Math.sqrt(ANOS);
    var prob = function (taxa) { return 1 - phi((Math.log(1 + taxa) - mu) * ANOS / raiz); };
    return {
      r: r, sigma: sigma, rhoMedio: rhos.length ? rhos.reduce(function (s, x) { return s + x; }, 0) / rhos.length : null,
      anos: anos, w0: w0,
      pPerder: 1 - prob(0), pCdi: ctx.cdi != null ? prob(ctx.cdi) : null, pIpca: ctx.ipca != null ? prob(ctx.ipca) : null,
      cenarios: ["p10", "p50", "p90"].map(function (q) {
        var v = anos[ANOS][q];
        return { q: q, valor: v, total: v / w0 - 1, aa: Math.pow(v / w0, 1 / ANOS) - 1 };
      }),
    };
  }

  // ---------------------------------------------------------------- tela

  var ui = { tickers: [], data: null, valor: 10000, reinvestir: true, irJcp: true, modo: "dia" };

  function lerHash() {
    var p = location.hash.replace(/^#\/simular\/?/, "").split("/");
    if (p[0]) ui.tickers = p[0].split(",").map(function (x) { return x.toUpperCase(); })
      .filter(function (x) { return window.RealTerms.POR_TICKER[x]; }).slice(0, MAX_ACOES);
    if (/^\d{4}-\d{2}-\d{2}$/.test(p[1] || "")) ui.data = p[1];
    if (+p[2] > 0) ui.valor = +p[2];
  }
  function escreverHash() {
    var h = "#/simular" + (ui.tickers.length ? "/" + ui.tickers.join(",") + (ui.data ? "/" + ui.data + (ui.valor !== 10000 ? "/" + ui.valor : "") : "") : "");
    if (location.hash !== h) history.replaceState(null, "", h);
  }

  function render(app) {
    var X = window.RealTerms, L = X.L, esc = X.esc;
    document.title = L("Simular", "Simulate") + " · Real Terms";
    lerHash();
    var ultimo = window.DADOS.cotacoes_em || iso(Date.now());
    if (!ui.data) ui.data = iso(Date.parse(ultimo) - Math.round(5 * 365.25) * 864e5);
    var anoUlt = +ultimo.slice(0, 4), anos = [];
    for (var a = anoUlt; a >= 2010; a--) anos.push(a);

    app.innerHTML =
      '<section class="mapa-cab sim-cab"><span class="olho"><span class="capitulo">R$</span>' + esc(L("Simulador", "Simulator")) + "</span>" +
      "<h1>" + esc(L("Quanto rendeu, quanto pode render", "What it returned, what it might return")) + "</h1>" +
      '<p class="mudo">' + esc(L(
        "Escolha uma ou mais ações e o dia (ou o ano) da compra. A simulação soma valorização, dividendos e JCP até o último pregão e compara com o CDI e a inflação. Depois projeta a carteira de hoje por 5 anos, em três cenários, com os pressupostos à mostra.",
        "Pick one or more stocks and the purchase day (or year). The simulation adds price change, dividends and interest on equity (JCP) up to the last trading day and compares them with Brazil's CDI rate and inflation. It then projects today's portfolio 5 years ahead in three scenarios, with every assumption shown.")) + "</p></section>" +
      '<section class="cartao sim-entrada">' +
      '<div class="sim-campo sim-campo-acoes"><span class="sim-rot">' + esc(L("Ações", "Stocks")) + '</span><div class="sim-chips" id="sim-chips"></div>' +
      '<label class="busca-local sim-busca"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg>' +
      '<input id="sim-busca" type="search" placeholder="' + esc(L("Adicionar ação (ticker ou nome)", "Add a stock (ticker or name)")) + '" autocomplete="off" spellcheck="false" aria-label="' + esc(L("Adicionar ação", "Add a stock")) + '">' +
      '<ul id="sim-sug" class="sugestoes" role="listbox" hidden></ul></label></div>' +
      '<div class="sim-linha">' +
      '<div class="sim-campo"><span class="sim-rot">' + esc(L("Compra", "Purchase")) + '</span>' +
      '<div class="pilulas" role="group" id="sim-modo"><button type="button" data-modo="dia">' + esc(L("Dia", "Day")) + '</button><button type="button" data-modo="ano">' + esc(L("Ano", "Year")) + "</button></div>" +
      '<input type="date" id="sim-data" min="2010-01-04" max="' + ultimo + '" value="' + ui.data + '" aria-label="' + esc(L("Data da compra", "Purchase date")) + '">' +
      '<select id="sim-ano" aria-label="' + esc(L("Ano da compra", "Purchase year")) + '">' + anos.map(function (y) { return '<option value="' + y + '">' + y + "</option>"; }).join("") + "</select></div>" +
      '<label class="sim-campo"><span class="sim-rot">' + esc(L("Valor investido", "Amount invested")) + " (" + (X.estado.moeda === "usd" ? "US$" : "R$") + ')</span>' +
      '<input type="number" id="sim-valor" min="100" step="100" value="' + ui.valor + '"></label>' +
      '<div class="sim-campo sim-opcoes"><label><input type="checkbox" id="sim-reinv"' + (ui.reinvestir ? " checked" : "") + "> " + esc(L("Reinvestir proventos", "Reinvest payouts")) + "</label>" +
      '<label><input type="checkbox" id="sim-ir"' + (ui.irJcp ? " checked" : "") + "> " + esc(L("Descontar 15% de IR do JCP", "Withhold 15% tax on JCP")) + "</label></div>" +
      "</div></section>" +
      '<div id="sim-resultado" aria-live="polite"></div>';

    var chips = document.getElementById("sim-chips"), busca = document.getElementById("sim-busca"), sug = document.getElementById("sim-sug");
    var inData = document.getElementById("sim-data"), inAno = document.getElementById("sim-ano"), inValor = document.getElementById("sim-valor");
    function desenharChips() {
      chips.innerHTML = ui.tickers.map(function (t) {
        return '<span class="chip ativo sim-chip">' + t + ' <button type="button" data-tirar="' + t + '" aria-label="' + esc(L("Tirar ", "Remove ") + t) + '">×</button></span>';
      }).join("") || '<span class="mudo">' + esc(L("Nenhuma ainda. Sugestões:", "None yet. Suggestions:")) + "</span>" + sugestoes();
    }
    function sugestoes() {
      var base = X.visiveis().slice().sort(function (a, b) { return (b.liquidez || 0) - (a.liquidez || 0); }).slice(0, 6);
      return base.map(function (e) { return ' <button type="button" class="chip" data-por="' + e.ticker + '">' + e.ticker + "</button>"; }).join("");
    }
    function modo(m) {
      ui.modo = m;
      document.querySelectorAll("#sim-modo button").forEach(function (b) { b.setAttribute("aria-pressed", String(b.getAttribute("data-modo") === m)); });
      inData.hidden = m !== "dia"; inAno.hidden = m !== "ano";
      if (m === "ano") inAno.value = ui.data.slice(0, 4);
    }
    function mudou() { escreverHash(); calcular(); }
    chips.addEventListener("click", function (ev) {
      var b = ev.target.closest("button");
      if (!b) return;
      if (b.getAttribute("data-tirar")) ui.tickers = ui.tickers.filter(function (t) { return t !== b.getAttribute("data-tirar"); });
      if (b.getAttribute("data-por") && ui.tickers.length < MAX_ACOES) ui.tickers.push(b.getAttribute("data-por"));
      desenharChips(); mudou();
    });
    var achados = [], sel = -1;
    function norm(s) { return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase(); }
    function listar() {
      var q = norm(busca.value.trim());
      if (!q) { sug.hidden = true; return; }
      achados = [];
      X.visiveis().forEach(function (e) {
        e.tickers.forEach(function (t) {
          if (ui.tickers.indexOf(t) < 0 && (norm(t).indexOf(q) === 0 || norm(e.nome).indexOf(q) >= 0)) achados.push({ t: t, e: e });
        });
      });
      achados = achados.slice(0, 8);
      sel = achados.length ? 0 : -1;
      sug.innerHTML = achados.map(function (x, k) {
        return '<li role="option" data-t="' + x.t + '" aria-selected="' + (k === sel) + '"><b>' + x.t + "</b><span>" + esc(X.nomeCurto(x.e.nome)) + "</span></li>";
      }).join("") || '<li class="mudo">' + esc(X.t("nada_encontrado")) + "</li>";
      sug.hidden = false;
    }
    function escolher(t) {
      if (t && ui.tickers.indexOf(t) < 0 && ui.tickers.length < MAX_ACOES) ui.tickers.push(t);
      busca.value = ""; sug.hidden = true; desenharChips(); mudou();
    }
    busca.addEventListener("input", listar);
    busca.addEventListener("keydown", function (ev) {
      if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
        ev.preventDefault();
        if (!achados.length) return;
        sel = (sel + (ev.key === "ArrowDown" ? 1 : achados.length - 1)) % achados.length;
        sug.querySelectorAll("li[data-t]").forEach(function (li, k) { li.setAttribute("aria-selected", String(k === sel)); });
      } else if (ev.key === "Enter") { ev.preventDefault(); if (sel >= 0) escolher(achados[sel].t); }
      else if (ev.key === "Escape") { sug.hidden = true; }
    });
    sug.addEventListener("mousedown", function (ev) { var li = ev.target.closest("li[data-t]"); if (li) { ev.preventDefault(); escolher(li.getAttribute("data-t")); } });
    busca.addEventListener("blur", function () { setTimeout(function () { sug.hidden = true; }, 150); });
    document.getElementById("sim-modo").addEventListener("click", function (ev) {
      var b = ev.target.closest("button[data-modo]");
      if (!b) return;
      modo(b.getAttribute("data-modo"));
      if (ui.modo === "ano") { ui.data = inAno.value + "-01-01"; mudou(); }
    });
    inData.addEventListener("change", function () { if (inData.value) { ui.data = inData.value; mudou(); } });
    inAno.addEventListener("change", function () { ui.data = inAno.value + "-01-01"; inData.value = ui.data; mudou(); });
    inValor.addEventListener("change", function () { var v = +inValor.value; if (v > 0) { ui.valor = Math.round(v); mudou(); } });
    document.getElementById("sim-reinv").addEventListener("change", function (ev) { ui.reinvestir = ev.target.checked; calcular(); });
    document.getElementById("sim-ir").addEventListener("change", function (ev) { ui.irJcp = ev.target.checked; calcular(); });
    desenharChips();
    modo(ui.modo);
    calcular();
  }

  var rodada = 0;
  function calcular() {
    var X = window.RealTerms, L = X.L, esc = X.esc, alvo = document.getElementById("sim-resultado");
    if (!alvo) return;
    if (!ui.tickers.length) {
      alvo.innerHTML = '<section class="cartao sim-vazio"><p class="mudo">' + esc(L(
        "Escolha ao menos uma ação para simular. O valor é dividido em partes iguais entre as escolhidas.",
        "Pick at least one stock to simulate. The amount is split equally among them.")) + "</p></section>";
      return;
    }
    var minha = ++rodada;
    alvo.innerHTML = '<section class="cartao"><p class="mudo">' + esc(L("Carregando o histórico…", "Loading price history…")) + "</p></section>";
    Promise.all([carregar("_indices")].concat(ui.tickers.map(function (t) { return carregar(t).catch(function () { return t; }); })))
      .then(function (res) {
        if (minha !== rodada) return;
        var faltam = res.slice(1).filter(function (x) { return typeof x === "string"; });
        if (faltam.length) {
          alvo.innerHTML = '<section class="cartao"><p>' + esc(L("Sem histórico de cotações para ", "No price history for ") + faltam.join(", ")) + ".</p></section>";
          return;
        }
        desenharResultado(alvo);
      })
      .catch(function () {
        if (minha !== rodada) return;
        alvo.innerHTML = '<section class="cartao"><p>' + esc(L("Não foi possível carregar o histórico. Tente de novo mais tarde.", "Could not load the price history. Please try again later.")) + "</p></section>";
      });
  }

  function desenharResultado(alvo) {
    var X = window.RealTerms, L = X.L, esc = X.esc, nf = X.nf, D = window.DADOS;
    var ix = indices(), usd = X.estado.moeda === "usd";
    var series = ui.tickers.map(function (t) { return decodificar(window.HIST[t]); });
    var ptaxEm = function (d) { var v = valorEm(ix && ix.ptax, d); return v || D.ptax_atual.valor; };
    // valor digitado na moeda da tela; a conta é em reais (US$ → R$ pela PTAX do dia da compra)
    var valorBrl = usd ? ui.valor * ptaxEm(ui.data) : ui.valor;
    var op = { irJcp: ui.irJcp };
    var c = simularCarteira(series, ui.data, valorBrl, op);
    if (!c) {
      alvo.innerHTML = '<section class="cartao"><p>' + esc(L("Não há pregão dessas ações depois dessa data.", "These stocks have not traded since that date.")) + "</p></section>";
      return;
    }
    var R = ui.reinvestir;
    var conv = function (v, d) { return v == null ? null : usd ? v / ptaxEm(d) : v; };
    var moeda = function (v) { return v == null || !isFinite(v) ? "–" : (usd ? "US$ " : "R$ ") + nf(Math.abs(v) >= 100 ? 0 : 2).format(v); };
    var preco = function (v) { return v == null || !isFinite(v) ? "–" : (usd ? "US$ " : "R$ ") + nf(v < 1 ? 3 : 2).format(v); };
    var sinal = function (v, txt) { return (v > 0 ? "+" : "") + txt; };
    var pctS = function (v) { return v == null ? "–" : sinal(v, X.pct(v, 1)); };
    var investido = conv(valorBrl, ui.data), final = conv(R ? c.valorR : c.valor, c.hoje);
    var total = final / investido - 1, aa = anual(total, c.dCompra, c.hoje);
    var cdi = ix && ix.cdi ? valorEm(ix.cdi, c.hoje) / valorEm(ix.cdi, c.dCompra) - 1 : null;
    var cdiFinal = cdi != null ? conv(valorBrl * (1 + cdi), c.hoje) : null;
    var inflacao = !usd && ix && ix.ipca ? ipcaFim(ix.ipca, c.hoje) / ipcaInicio(ix.ipca, c.dCompra) - 1 : null;
    var real = inflacao != null ? (1 + total) / (1 + inflacao) - 1 : null;
    // mais de uma semana depois da data pedida: a ação ainda não negociava (abertura de capital depois)
    var umaSemana = iso(Date.parse(ui.data) + 7 * 864e5);
    var tardios = c.itens.filter(function (x) { return x.dCompra > umaSemana; });
    var adiados = c.itens.filter(function (x) { return x.dCompra !== ui.data && x.dCompra <= umaSemana; });
    var noPrazo = c.itens.filter(function (x) { return x.dCompra <= umaSemana; });
    var dataTxt = X.data(noPrazo.length ? noPrazo[0].dCompra : c.dCompra);

    // ------------------------------------------------------------ passado
    var kpi = function (rot, val, sub, cls) {
      return '<div class="sim-kpi"><span class="sim-kpi-rot">' + esc(rot) + '</span><b class="' + (cls || "") + '">' + val + "</b>" + (sub ? '<small>' + sub + "</small>" : "") + "</div>";
    };
    var html = '<section class="cartao sim-bloco"><h2>' + esc(L("Do dia da compra até hoje", "From purchase day to today")) + "</h2>" +
      '<p class="mudo sim-sub">' + esc(L("Compra em ", "Bought on ")) + dataTxt + esc(L(", no fechamento; último pregão em ", " at the close; last trading day ")) + X.data(c.hoje) + "." +
      (adiados.length ? " " + esc(ui.data.slice(5) === "01-01" ? L("Compra no primeiro pregão do ano.", "Bought on the year's first trading day.") :
        L("Sem pregão em " + X.data(ui.data) + ": vale o primeiro depois.", "No trading on " + X.data(ui.data) + ": the next session is used.")) : "") +
      (tardios.length ? " " + esc(L("Ainda não negociavam na data: ", "Not yet trading on that date: ")) + tardios.map(function (x) { return x.t + " (" + X.data(x.dCompra) + ")"; }).join(", ") + esc(L("; a parte delas fica em dinheiro até lá.", "; their share stays in cash until then.")) : "") + "</p>" +
      '<div class="sim-kpis">' +
      kpi(L("Investido", "Invested"), moeda(investido)) +
      kpi(L("Hoje", "Today"), moeda(final), esc(R ? L("com proventos reinvestidos", "with payouts reinvested") : L("ações + proventos em dinheiro", "shares + payouts in cash"))) +
      kpi(L("Retorno total", "Total return"), pctS(total), aa != null ? esc(sinal(aa, X.pct(aa, 1)) + L(" ao ano", " a year")) : "", total < 0 ? "neg" : "pos") +
      kpi(L("Proventos recebidos", "Payouts received"), moeda(conv(c.proventos, c.hoje)), esc(L("dividendos ", "dividends ") + moeda(conv(c.dividendos, c.hoje)) + " · JCP " + moeda(conv(c.jcp, c.hoje)))) +
      (cdi != null ? kpi(L("No CDI", "In CDI"), moeda(cdiFinal), esc(pctS(cdi) + " · " + (total >= cdi ? L("a carteira ganhou", "the portfolio won") : L("o CDI ganhou", "CDI won")))) : "") +
      (real != null ? kpi(L("Acima da inflação", "Above inflation"), pctS(real), esc(L("IPCA no período ", "Inflation (IPCA) ") + pctS(inflacao)), real < 0 ? "neg" : "pos") : "") +
      "</div>" +
      '<div class="grafico sim-graf" id="sim-graf-passado"></div>' +
      '<div class="tabela-wrap"><table class="tabela-dem sim-tabela"><thead><tr><th>' + esc(L("Ação", "Stock")) + "</th><th>" + esc(L("Compra", "Purchase")) + "</th><th>" + esc(L("Hoje", "Today")) +
      "</th><th>" + esc(L("Valorização", "Price change")) + "</th><th>" + esc(L("Proventos", "Payouts")) + "</th><th>" + esc(L("Retorno total", "Total return")) + "</th><th>" + esc(L("ao ano", "a year")) + "</th></tr></thead><tbody>" +
      c.itens.map(function (x) {
        var fim = conv(R ? x.valorR : x.valor, x.hoje), ini = conv(x.investido, x.dCompra), tot = fim / ini - 1, a = anual(tot, x.dCompra, x.hoje);
        var val = conv(x.emAcoes, x.hoje) / ini - 1, prov = conv(x.proventos, x.hoje) / ini;
        var evs = x.eventos.map(function (ev) { return (ev[1] >= 1 ? "1:" + nf(ev[1] % 1 ? 2 : 0).format(ev[1]) : nf(1 / ev[1] % 1 ? 2 : 0).format(1 / ev[1]) + ":1") + " " + X.data(ev[0]); });
        return "<tr><td><a href=\"#/" + x.t + "\"><b>" + x.t + "</b></a></td>" +
          '<td class="num">' + X.data(x.dCompra) + "<br><small class=\"mudo\">" + preco(conv(x.pCompra, x.dCompra)) + "</small></td>" +
          '<td class="num">' + preco(conv(x.pHoje, x.hoje)) + (evs.length ? '<br><small class="mudo" title="' + esc(evs.join(" · ")) + '">' + esc(evs.length === 1 ? evs[0] : evs.length + L(" eventos de ações", " share events")) + "</small>" : "") + "</td>" +
          '<td class="num ' + (val < 0 ? "neg" : "") + '">' + pctS(val) + "</td>" +
          '<td class="num">' + pctS(prov) + "</td>" +
          '<td class="num ' + (tot < 0 ? "neg" : "") + '"><b>' + pctS(tot) + "</b></td>" +
          '<td class="num">' + (a == null ? "–" : pctS(a)) + "</td></tr>";
      }).join("") + "</tbody></table></div>" +
      '<p class="aviso">' + esc(L(
        "Valorização: preço de hoje × ações compradas, já com desdobramentos, grupamentos e bonificações. Proventos: dividendos, JCP" + (ui.irJcp ? " (menos 15% de IR)" : " (brutos)") + " e rendimentos com data-com depois da compra; os ainda não pagos contam como a receber. Com reinvestimento, cada provento compra ações no fechamento do dia do pagamento. Sem custos de corretagem nem impostos sobre o ganho de capital. Cotações e proventos da B3; CDI e IPCA do Banco Central.",
        "Price change: today's price × shares bought, adjusted for splits, reverse splits and bonus shares. Payouts: dividends, interest on equity (JCP" + (ui.irJcp ? ", net of the 15% withholding tax" : ", gross") + ") and other cash distributions with a record date after the purchase; unpaid ones count as receivable. With reinvestment, each payout buys shares at the close of its payment date. No brokerage fees or capital gains tax. Prices and payouts from B3; CDI and inflation (IPCA) from Brazil's central bank.")) + "</p>" +
      "</section>";

    // ------------------------------------------------------------ futuro
    var ctx = { cdi: ix ? ix.cdiAa : null, ipca: ix ? ix.ipca12 : null, irJcp: ui.irJcp };
    var ps = series.map(function (s, k) { return pressupostos(X.POR_TICKER[ui.tickers[k]], ui.tickers[k], s, ctx); });
    var valoresHoje = c.itens.map(function (x) { return R ? x.valorR : x.valor; });
    var somaHoje = valoresHoje.reduce(function (a, b) { return a + b; }, 0);
    var pesos = valoresHoje.map(function (v) { return v / somaHoje; });
    var pr = projetar(ps, pesos, somaHoje, ctx);
    var hojeTxt = X.data(c.hoje);
    var nomeCen = { p10: L("Pessimista", "Pessimistic"), p50: L("Referência", "Reference"), p90: L("Otimista", "Optimistic") };
    var descCen = { p10: L("1 chance em 10 de ficar abaixo", "1 in 10 chance of ending below"), p50: L("metade das chances acima, metade abaixo", "even odds above or below"), p90: L("1 chance em 10 de ficar acima", "1 in 10 chance of ending above") };
    var pctF = function (v) { return v == null ? "–" : X.pct(v, 1); };
    html += '<section class="cartao sim-bloco"><h2>' + esc(L("De hoje a 5 anos: projeção", "From today, 5 years ahead: projection")) + "</h2>" +
      '<p class="mudo sim-sub">' + esc(L("A carteira de hoje (", "Today's portfolio (")) + moeda(conv(somaHoje, c.hoje)) + esc(L(", com os pesos de hoje e proventos reinvestidos) daqui a 5 anos. Os cenários são faixas de probabilidade, não promessas.",
        ", with today's weights and payouts reinvested) 5 years from now. The scenarios are probability ranges, not promises.")) + "</p>" +
      '<div class="sim-cenarios">' + pr.cenarios.map(function (cn) {
        return '<div class="sim-cenario sim-' + cn.q + '"><span class="sim-kpi-rot">' + esc(nomeCen[cn.q]) + "</span><b>" + moeda(conv(cn.valor, c.hoje)) + "</b>" +
          "<small>" + esc(pctS(cn.total) + L(" em 5 anos · ", " over 5 years · ") + pctS(cn.aa) + L(" ao ano", " a year")) + "</small><small class=\"mudo\">" + esc(descCen[cn.q]) + "</small></div>";
      }).join("") + "</div>" +
      '<div class="sim-probs">' +
      '<span><b>' + pctF(pr.pPerder) + "</b> " + esc(L("de chance de ter menos que hoje em 5 anos", "chance of having less than today in 5 years")) + "</span>" +
      (pr.pCdi != null ? "<span><b>" + pctF(pr.pCdi) + "</b> " + esc(L("de bater o CDI de hoje (" + X.pct(ctx.cdi, 1) + " ao ano) mantido por 5 anos", "of beating today's CDI rate (" + X.pct(ctx.cdi, 1) + " a year) held for 5 years")) + "</span>" : "") +
      (pr.pIpca != null ? "<span><b>" + pctF(pr.pIpca) + "</b> " + esc(L("de ganhar da inflação (IPCA de 12 meses, " + X.pct(ctx.ipca, 1) + " ao ano)", "of beating inflation (12-month IPCA, " + X.pct(ctx.ipca, 1) + " a year)")) + "</span>" : "") +
      "</div>" +
      '<div class="grafico sim-graf" id="sim-graf-futuro"></div>' +
      "<h3>" + esc(L("Pressupostos por ação", "Assumptions by stock")) + "</h3>" +
      '<div class="tabela-wrap"><table class="tabela-dem sim-tabela sim-pres"><thead><tr><th>' + esc(L("Ação", "Stock")) + "</th><th>" + esc(L("Peso", "Weight")) + "</th><th>" + esc(L("Dividend yield", "Dividend yield")) +
      "</th><th>" + esc(L("Crescimento do lucro por ação", "Earnings-per-share growth")) + "</th><th>" + esc(L("Reprecificação", "Re-rating")) + "</th><th>" + esc(L("Retorno de referência", "Reference return")) + "</th><th>" + esc(L("Volatilidade", "Volatility")) + "</th></tr></thead><tbody>" +
      ps.map(function (p, k) {
        var notaDy = p.dyNota === "prejuizo" ? L("prejuízo em 12 meses e em 5 anos: zero", "losses over 12 months and 5 years: zero") : p.dyNota === "lucro" ? L("limitado ao lucro (yield 12m " + X.pct(p.dy12, 1) + ")", "capped at earnings (12m yield " + X.pct(p.dy12, 1) + ")") :
          p.dyNota === "teto" ? L("teto de 15% (yield 12m " + X.pct(p.dy12, 1) + ")", "15% cap (12m yield " + X.pct(p.dy12, 1) + ")") : L("proventos de 12 meses", "12-month payouts");
        var partes = [];
        if (p.pesos.hist) partes.push(L("histórico ", "history ") + pctF(p.gHist) + " × " + nf(0).format(p.pesos.hist * 100) + "%");
        if (p.pesos.sust) partes.push(L("ROE × retenção ", "ROE × retention ") + pctF(p.gSust) + " × " + nf(0).format(p.pesos.sust * 100) + "%");
        partes.push(L("longo prazo ", "long run ") + pctF(p.gLp) + " × " + nf(0).format(p.pesos.lp * 100) + "%");
        var notaV = p.plMed && p.plHoje ? L("P/L ", "P/E ") + nf(1).format(p.plHoje) + L(" → mediana de 10 anos ", " → 10-year median ") + nf(1).format(p.plMed) +
          L(": " + pctS(p.vCheio) + " × previsibilidade " + nf(0).format(p.score), ": " + pctS(p.vCheio) + " × predictability " + nf(0).format(p.score)) : L("sem histórico de P/L comparável", "no comparable P/E history");
        return "<tr><td><b>" + p.t + "</b></td>" +
          '<td class="num">' + nf(0).format(pesos[k] * 100) + "%</td>" +
          '<td class="num">' + pctF(p.dyLiq) + '<br><small class="mudo">' + esc(notaDy + (p.fracJcp && ui.irJcp ? L("; JCP líquido de IR", "; JCP net of tax") : "")) + "</small></td>" +
          '<td class="num">' + pctF(p.g) + '<br><small class="mudo">' + esc(partes.join(" + ")) + "</small></td>" +
          '<td class="num">' + pctS(p.v) + '<br><small class="mudo">' + esc(notaV) + "</small></td>" +
          '<td class="num"><b>' + pctS(p.r) + "</b>" + '<br><small class="mudo">' + esc(p.mercado != null ?
            L("próprio " + pctS(p.rProprio) + ", metade do caminho até o do mercado (" + pctS(p.mercado) + ")", "own " + pctS(p.rProprio) + ", halfway to the market's (" + pctS(p.mercado) + ")") : L("ao ano", "a year")) + "</small></td>" +
          '<td class="num">' + pctF(p.sigma) + '<br><small class="mudo">' + esc(p.sigmaHist != null ? L(p.nSemanas + " semanas: " + X.pct(p.sigmaHist, 1), p.nSemanas + " weeks: " + X.pct(p.sigmaHist, 1)) : L("pouco histórico: referência", "short history: reference")) + "</small></td></tr>";
      }).join("") + "</tbody></table></div>" +
      "<h3>" + esc(L("Pressupostos da carteira", "Portfolio assumptions")) + "</h3>" +
      '<ul class="sim-lista">' +
      "<li>" + esc(L("Retorno de referência da carteira: ", "Portfolio reference return: ") + pctS(pr.r) + L(" ao ano (média dos retornos de referência pelos pesos de hoje). É a mediana: metade dos cenários fica acima.", " a year (reference returns averaged by today's weights). It is the median: half the scenarios end above it.")) + "</li>" +
      "<li>" + esc(L("Retorno de referência de cada ação = (1 + dividend yield) × (1 + crescimento do lucro por ação) × (1 + reprecificação) − 1, puxado metade do caminho para o do mercado (" + pctS(ps[0].mercado) + " ao ano: a mesma conta para todas as ações da base, pesada pelo valor de mercado). Previsão de retorno de uma ação isolada erra muito; a do mercado inteiro, menos.",
        "Each stock's reference return = (1 + dividend yield) × (1 + earnings-per-share growth) × (1 + re-rating) − 1, pulled halfway to the market's (" + pctS(ps[0].mercado) + " a year: the same calculation for every stock in the database, weighted by market value). Single-stock return forecasts are very noisy; the whole market's much less so.")) + "</li>" +
      "<li>" + esc(L("Volatilidade da carteira: ", "Portfolio volatility: ") + pctF(pr.sigma) + L(" ao ano", " a year") + (pr.rhoMedio != null ? L(", com correlação média de ", ", with an average correlation of ") + nf(2).format(pr.rhoMedio) + L(" entre as ações (semanais de 3 anos, puxadas um quarto para 0,45)", " between the stocks (3 years of weekly returns, pulled a quarter of the way to 0.45)") : "") + ".") + "</li>" +
      "<li>" + esc(L("Cenários: percentis 10, 50 e 90 de uma distribuição lognormal do patrimônio em 5 anos. Na prática, crises e saltos deixam as pontas mais largas do que a curva normal sugere.",
        "Scenarios: 10th, 50th and 90th percentiles of a lognormal distribution of wealth in 5 years. In practice, crises and jumps make the tails fatter than the normal curve suggests.")) + "</li>" +
      "<li>" + esc(L("Crescimento de longo prazo: IPCA de 12 meses (" + pctF(ctx.ipca) + ") mais " + X.pct(CRESC_REAL, 0) + " reais ao ano. O peso do histórico do lucro por ação cresce com o índice de previsibilidade da empresa (até 40%).",
        "Long-run growth: 12-month inflation (" + pctF(ctx.ipca) + ") plus " + X.pct(CRESC_REAL, 0) + " real a year. The weight on each company's own earnings-per-share history grows with its predictability score (up to 40%).")) + "</li>" +
      "<li>" + esc(L("CDI de hoje (" + pctF(ctx.cdi) + " ao ano) mantido por 5 anos, só como régua; a taxa vai mudar.", "Today's CDI rate (" + pctF(ctx.cdi) + " a year) held for 5 years, only as a yardstick; the rate will change.")) + "</li>" +
      (usd ? "<li>" + esc(L("Em US$: a projeção é feita em reais e convertida pela PTAX de hoje; a variação do câmbio nos próximos 5 anos fica de fora.",
        "In US$: the projection is made in reais and converted at today's PTAX rate; exchange-rate moves over the next 5 years are left out.")) + "</li>" : "") +
      "</ul>" +
      '<p class="aviso">' + esc(L("Projeção estatística a partir de dados públicos, não recomendação de investimento. O retorno de referência vem dos fundamentos de hoje (lucro, proventos, preço) e não do retorno passado da ação. Metodologia completa em docs/metodologia-simulacao.md.",
        "Statistical projection from public data, not investment advice. The reference return comes from today's fundamentals (earnings, payouts, price), not from the stock's past return. Full methodology in docs/metodologia-simulacao.md.")) + "</p></section>";

    alvo.innerHTML = html;

    // ------------------------------------------------------------ gráficos
    var rotMes = function (mes) { return mes.slice(5) + "/" + mes.slice(0, 4); };
    var passoAno = c.linha.length > 120 ? 2 : 1;
    var rotEixo = c.linha.length <= 24 ? null : function (r, k) {
      var ano = +r.slice(3), primeiro = k === 0 || c.linha[k - 1].mes.slice(0, 4) !== r.slice(3);
      return primeiro && k > 0 && ano % passoAno === 0 ? String(ano) : "";
    };
    var linha = c.linha.map(function (m) { return conv(R ? m.vR : m.v, m.d || m.mes + "-28"); });
    var serieCdi = ix && ix.cdi ? c.linha.map(function (m) { var d = m.d || m.mes + "-28"; return conv(valorBrl * valorEm(ix.cdi, d) / valorEm(ix.cdi, c.dCompra), d); }) : null;
    var serieIpca = !usd && ix && ix.ipca ? c.linha.map(function (m) { return valorBrl * ipcaFim(ix.ipca, m.mes + "-01") / ipcaInicio(ix.ipca, c.dCompra); }) : null;
    var sP = [{ nome: L("Carteira", "Portfolio"), cor: "var(--c1)", v: linha }];
    if (serieCdi) sP.push({ nome: "CDI", cor: "var(--c3)", v: serieCdi });
    if (serieIpca) sP.push({ nome: L("Inflação (IPCA)", "Inflation (IPCA)"), cor: "var(--muted)", v: serieIpca });
    X.linhas(document.getElementById("sim-graf-passado"), c.linha.map(function (m) { return rotMes(m.mes); }), sP, moeda,
      { eixo: function (v) { return nf(0).format(v); }, limites: null, pontos: false, rotX: rotEixo });
    var rotAno = pr.anos.map(function (a) { return a.ano === 0 ? L("hoje", "today") : "+" + a.ano + L(a.ano === 1 ? " ano" : " anos", a.ano === 1 ? " yr" : " yrs"); });
    var cv = function (q) { return pr.anos.map(function (a) { return conv(a[q], c.hoje); }); };
    var sF = [
      { nome: nomeCen.p90, cor: "var(--pos)", v: cv("p90") },
      { nome: nomeCen.p50, cor: "var(--c1)", v: cv("p50") },
      { nome: nomeCen.p10, cor: "var(--neg)", v: cv("p10") },
    ];
    if (ctx.cdi != null) sF.push({ nome: L("CDI de hoje mantido", "Today's CDI held"), cor: "var(--c3)", v: cv("cdi") });
    X.linhas(document.getElementById("sim-graf-futuro"), rotAno, sF, moeda, {
      eixo: function (v) { return nf(0).format(v); }, limites: null,
      faixas: [{ de: cv("p10"), ate: cv("p90"), cor: "var(--c1)" }, { de: cv("p25"), ate: cv("p75"), cor: "var(--c1)" }],
    });
  }

  window.RealTermsSimular = {
    render: render, decodificar: decodificar, simularTicker: simularTicker, simularCarteira: simularCarteira,
    pressupostos: pressupostos, fundamentos: fundamentos, ancoraMercado: ancoraMercado, projetar: projetar, retornosSemanais: retornosSemanais, volatilidade: volatilidade,
    correlacao: correlacao, anual: anual, semana: semana, ipcaInicio: ipcaInicio, ipcaFim: ipcaFim, phi: phi,
  };
  // app.js roteia antes deste arquivo carregar: se a página já é a do simulador, desenha agora
  if (typeof document !== "undefined" && document.body && document.body.getAttribute("data-pagina") === "simular") render(document.getElementById("app"));
})();
