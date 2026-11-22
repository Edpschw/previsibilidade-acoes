/* Glossário (termos.js): estrutura das entradas e cobertura do Ranking. Cada nome de indicador (curto e
 * completo), trava, selo e indicador futuro do ranking.js precisa ter dica, em português e em inglês.
 *
 *     node tests/termos_ranking.js      (também roda dentro de tests/test_termos.py)
 */
"use strict";
const fs = require("fs"), path = require("path"), assert = require("assert");
const raiz = path.join(__dirname, "..");

// ambiente mínimo para carregar termos.js fora do navegador
global.window = { addEventListener() {}, matchMedia: () => ({ matches: false }) };
global.document = { getElementById: () => null, addEventListener() {} };
global.matchMedia = window.matchMedia;
require(path.join(raiz, "termos.js"));
const { lista, achar } = window.RealTermsTermos;

// 1. estrutura: id único, cinco textos em cada língua e nomes exatos curtos o bastante para serem achados
const ids = new Set();
lista.forEach(function (t) {
  assert(!ids.has(t[0]), "id repetido: " + t[0]);
  ids.add(t[0]);
  [t[2], t[3]].forEach(function (d) {
    assert(d.length === 5 && d.every(function (x) { return typeof x === "string" && x.length; }), "textos incompletos: " + t[0]);
  });
  t[1].forEach(function (n) { if (typeof n === "string") assert(n.length <= 64, "nome longo demais para ser achado: " + n); });
});

// 2. Ranking: os nomes saem do próprio ranking.js, para que um indicador novo sem dica quebre o teste
const fonte = fs.readFileSync(path.join(raiz, "ranking.js"), "utf8");
const nomes = [];
const juntar = function (re, de) { for (const m of fonte.matchAll(re)) nomes.push.apply(nomes, m.slice(1, 1 + de)); };
juntar(/pilar: "[qpsf]".*?nome: \["([^"]+)", "([^"]+)"\], curto: \["([^"]+)", "([^"]+)"\]/g, 4);  // indicadores
juntar(/(?:rj|plNeg|prejuizo|divida|estatal): \[\["([^"]+)", "([^"]+)"\]/g, 2);                    // travas e selos
juntar(/itens\.push\(\[L\("([^"]+)", "([^"]+)"\)/g, 2);                                           // indicadores futuros
juntar(/\[L\("([^"]+ \(informativo\))", "([^"]+)"\)/g, 2);                                         // informativos
assert(nomes.length >= 120, "poucos nomes lidos do ranking.js: " + nomes.length);

const dentroDoRanking = { closest: function (sel) { return sel === ".rk" ? {} : null; } };
const sem = nomes.filter(function (n) { return !achar(n, dentroDoRanking); });
assert.deepStrictEqual(sem, [], "nomes do Ranking sem dica: " + sem.join(", "));

console.log("glossário: ok (" + lista.length + " termos; " + nomes.length + " nomes do Ranking com dica)");
