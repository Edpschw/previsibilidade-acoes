// Contas do simulador (simular.js) com histórico sintético, sem navegador: node tests/simular_contas.js
global.window = { DADOS: {} }; global.document = undefined;
require(require("path").join(__dirname, "..", "simular.js"));
const S = window.RealTermsSimular, assert = require("assert");
const quase = (a, b, tol = 1e-6) => assert(Math.abs(a - b) < tol, `${a} != ${b}`);

// 5 pregões; desdobramento 1:2 no 3º (o preço cai à metade); JCP de R$ 1 com data-com no 2º, pago no 4º
const h = { t: "TEST3", d0: "2024-01-02", dd: [1, 1, 1, 1], esc: 100, p0: 10000, dp: [0, -5000, 0, 1000],
  ev: [["2024-01-04", 2, "desdobramento", "b3"]], pv: [["2024-01-03", 1.0, "jcp", "2024-01-05"]] };
const s = S.decodificar(h);
assert.deepStrictEqual(s.datas, ["2024-01-02", "2024-01-03", "2024-01-04", "2024-01-05", "2024-01-06"]);
assert.deepStrictEqual(s.precos, [100, 100, 50, 50, 60]);

// compra de R$ 1.000 em 02/01: 10 ações; vira 20 em 04/01; JCP de 10 × R$ 1 (− 15% IR) = R$ 8,50
let r = S.simularTicker(s, "2024-01-02", 1000, { irJcp: true });
quase(r.acoes, 20);
quase(r.recebido.jcp, 8.5);
quase(r.recebido.ir, 1.5);
quase(r.valor, 20 * 60 + 8.5);                // sem reinvestir: ações + caixa
quase(r.acoesR, 20 + 8.5 / 50);               // reinveste no fechamento do pagamento (R$ 50)
quase(r.valorR, (20 + 8.5 / 50) * 60);
quase(r.valorizacao, 20 * 60 - 1000);
assert.deepStrictEqual(r.eventos.map(e => e[0]), ["2024-01-04"]);

// sem IR: JCP bruto
r = S.simularTicker(s, "2024-01-02", 1000, { irJcp: false });
quase(r.recebido.jcp, 10);

// compra depois da data-com: não recebe o JCP; depois do desdobramento: não multiplica
r = S.simularTicker(s, "2024-01-04", 1000, { irJcp: true });
quase(r.proventos, 0); quase(r.acoes, 20); assert.strictEqual(r.eventos.length, 0);

// compra num dia sem pregão: vale o seguinte
r = S.simularTicker(s, "2024-01-01", 1000, {});
assert.strictEqual(r.dCompra, "2024-01-02");

// provento ainda não pago conta como a receber (e não é reinvestido)
const h2 = { ...h, t: "TEST4", pv: [["2024-01-03", 1.0, "dividendo", null]] };
r = S.simularTicker(S.decodificar(h2), "2024-01-02", 1000, { irJcp: true });
quase(r.aReceber, 20 * 0 + 10);               // 10 ações na data-com × R$ 1
quase(r.valorR, 20 * 60 + 10);

// carteira: duas ações em partes iguais
const c = S.simularCarteira([s, S.decodificar(h2)], "2024-01-02", 2000, { irJcp: true });
quase(c.investido, 2000);
quase(c.valor, (20 * 60 + 8.5) + (20 * 60 + 10));
assert(c.linha.length >= 1);

// ao ano
quase(S.anual(0.21, "2020-01-01", "2022-01-01"), 0.1, 1e-3);

// IPCA: começo e fim de mês
const ipca = { m0: "2024-01", i: [1.01, 1.0201, 1.030301] };
quase(S.ipcaInicio(ipca, "2024-01-15"), 1);
quase(S.ipcaInicio(ipca, "2024-02-10"), 1.01);
quase(S.ipcaFim(ipca, "2024-03-31"), 1.030301);
quase(S.ipcaFim(ipca, "2025-06-30"), 1.030301);   // além do último publicado

// semana ISO
assert.strictEqual(S.semana("2024-01-01"), "2024-W01");
assert.strictEqual(S.semana("2021-01-03"), "2020-W53");

// projeção: uma ação, r = 10%, σ = 20%: mediana em 5 anos = 1,1^5; P(perder) = Φ(−5·ln1,1/(0,2·√5))
const p = [{ r: 0.10, sigma: 0.2, retornos: {} }];
const pr = S.projetar(p, [1], 1000, { cdi: 0.10, ipca: 0.04 });
quase(pr.cenarios[1].valor, 1000 * Math.pow(1.1, 5), 1e-6);
quase(pr.pPerder, S.phi(-5 * Math.log(1.1) / (0.2 * Math.sqrt(5))), 1e-9);
quase(pr.pCdi, 0.5, 1e-9);                     // referência igual ao CDI: meio a meio
assert(pr.cenarios[0].valor < pr.cenarios[1].valor && pr.cenarios[1].valor < pr.cenarios[2].valor);
quase(S.phi(1.2816), 0.9, 1e-3);

// duas ações descorrelacionadas (sem histórico comum: correlação de referência 0,45)
const pr2 = S.projetar([{ r: 0.1, sigma: 0.3, retornos: {} }, { r: 0.1, sigma: 0.3, retornos: {} }], [0.5, 0.5], 1000, {});
quase(pr2.sigma, 0.3 * Math.sqrt((1 + 0.45) / 2), 1e-9);
console.log("contas do simulador: ok");
