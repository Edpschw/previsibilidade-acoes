// Contas da aba Gráficos (graficos.js) com histórico sintético, sem navegador: node tests/graficos_contas.js
global.window = { DADOS: {}, HIST: {} }; global.document = undefined;
require(require("path").join(__dirname, "..", "graficos.js"));
const G = window.RealTermsGraficos, assert = require("assert");
const quase = (a, b, tol = 1e-9) => assert(Math.abs(a - b) < tol, `${a} != ${b}`);

// 5 pregões; desdobramento 1:2 no 3º (o preço cai à metade); JCP de R$ 1 com data-com no 2º
window.HIST.TEST3 = { t: "TEST3", d0: "2024-01-02", dd: [1, 1, 1, 1], esc: 100, p0: 10000, dp: [0, -5000, 0, 1000],
  ev: [["2024-01-04", 2, "desdobramento", "b3"]], pv: [["2024-01-03", 1.0, "jcp", "2024-01-05"]] };
const d = G.diario("TEST3");
assert.deepStrictEqual(d.datas, ["2024-01-02", "2024-01-03", "2024-01-04", "2024-01-05", "2024-01-06"]);
// na base de ações de hoje: antes do desdobramento, o preço vai à metade
assert.deepStrictEqual(d.aj, [50, 50, 50, 50, 60]);
// retorno total: 1 ação a R$ 100 recebe R$ 1 na data-com, vira 2 ações + 0,02 reinvestidas a R$ 50 = 2,02 ações;
// a R$ 60 no fim, R$ 121,20 sobre R$ 100
quase(d.tr[2], 1.01);
quase(d.tr[4], 1.212);
assert.strictEqual(G.diario("NADA3"), null);

// grupamento 10:1 (fator 0,1): antes dele o preço é multiplicado por 10
window.HIST.TEST5 = { t: "TEST5", d0: "2024-01-02", dd: [1], esc: 100, p0: 100, dp: [900], ev: [["2024-01-03", 0.1, "grupamento", "b3"]], pv: [] };
assert.deepStrictEqual(G.diario("TEST5").aj, [10, 10]);

// semana de segunda a domingo: fica o último pregão de cada uma
assert.deepStrictEqual(G.semanal(["2024-01-01", "2024-01-03", "2024-01-05", "2024-01-08", "2024-01-09"]), ["2024-01-05", "2024-01-09"]);

// eixo comum: união dos pregões; cada empresa leva o último fechamento até a data e fica vazia antes de começar
window.HIST.TEST4 = { t: "TEST4", d0: "2024-01-03", dd: [2, 1], esc: 1, p0: 20, dp: [2, -1], ev: [], pv: [] };   // 3, 5 e 6/1
const sel = [{ tk: "TEST3" }, { tk: "TEST4" }];
let r = G.diaria({ id: "cotacao" }, sel, 0, false, false);
assert.deepStrictEqual(r.eixo, ["2024-01-02", "2024-01-03", "2024-01-04", "2024-01-05", "2024-01-06"]);
assert.deepStrictEqual(r.series[1].v, [null, 20, 20, 22, 21]);
// base 100 no primeiro valor do período de cada empresa
r = G.diaria({ id: "cotacao" }, sel, 0, true, false);
assert.deepStrictEqual(r.series[0].v, [100, 100, 100, 100, 120]);
quase(r.series[1].v[3], 110);
// retorno total sempre em base 100
r = G.diaria({ id: "retorno" }, sel, 0, false, false);
quase(r.series[0].v[4], 121.2);

// em US$: cada dia pela PTAX do dia (a última publicada até ali)
window.INDICES = { ptax: { d0: "2024-01-02", dd: [1, 1], v: [5, 4, 5] } };   // 2, 3 e 4/1; depois repete a de 4/1
r = G.diaria({ id: "cotacao" }, [{ tk: "TEST4" }], 0, false, true);
assert.deepStrictEqual(r.eixo, ["2024-01-03", "2024-01-05", "2024-01-06"]);
assert.deepStrictEqual(r.series[0].v, [20 / 4, 22 / 5, 21 / 5]);

// anual: anos em que alguma empresa tem valor; o período corta os mais antigos
const ind = { v: (e) => e.vals };
const a = { e: { anos: [2021, 2022, 2023], vals: [1, null, 3] } }, b = { e: { anos: [2022, 2023, 2024], vals: [2, NaN, 4] } };
r = G.anual(ind, [a, b], 0);
assert.deepStrictEqual(r.rotulos, ["2021", "2022", "2023", "2024"]);
assert.deepStrictEqual(r.series[0].v, [1, null, 3, null]);
assert.deepStrictEqual(r.series[1].v, [null, 2, null, 4]);
assert.deepStrictEqual(G.anual(ind, [a, b], 2).rotulos, ["2023", "2024"]);

console.log("graficos_contas: ok");
