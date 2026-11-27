"""Cruzamentos da aba Qualidade (scripts/qualidade.py): regras com dados sintéticos e invariantes do que foi gerado.

    python3 -m unittest tests.test_qualidade -v
"""

import json
import re
import sys
import unittest
from datetime import date
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ / "scripts"))
import qualidade as Q  # noqa: E402


def hist(pontos, ev=(), pv=()):
    """série compacta no formato do scripts/historico.py a partir de [(AAAA-MM-DD, preço)]"""
    ds = [date.fromisoformat(d) for d, _ in pontos]
    ints = [round(p * 100) for _, p in pontos]
    return {"d0": ds[0].isoformat(), "dd": [(b - a).days for a, b in zip(ds, ds[1:])], "esc": 100, "p0": ints[0],
            "dp": [b - a for a, b in zip(ints, ints[1:])], "ev": [list(e) for e in ev], "pv": [list(p) for p in pv]}


def empresa(tk, anos=(2024, 2025), financeiro=False, **series):
    n = len(anos)
    s = {k: [None] * n for k in ("fco", "fci", "fcf", "var_caixa", "fx_caixa", "ativo_total", "pl", "lucro_bruto", "receita",
                                  "ebitda", "ebit", "lpa_declarado", "acoes", "lucro_controladora", "dividendos_pagos",
                                  "lucro_liquido")}
    s["acoes_estimadas"] = [False] * n
    s.update(series)
    return {"ticker": tk, "tickers": [tk], "nome": f"{tk} S.A.", "anos": list(anos), "financeiro": financeiro, "series": s,
            "cotacao": {}, "precos_ano": {}, "valor_mercado": None, "liquidez": 2_000_000}


class Identidades(unittest.TestCase):
    def test_fluxo_de_caixa_e_balanco(self):
        e = empresa("AAA3", fco=[100_000, 100_000], fci=[-40_000, -40_000], fcf=[-50_000, -50_000], fx_caixa=[0, 0],
                    var_caixa=[10_000, -10_000],                      # 2025: sinal trocado (caso real da TIMS3 em 2024)
                    ativo_total=[500, 0], pl=[200, 0],                # 2025: balanço zerado
                    lucro_bruto=[90, 120], receita=[100, 100],        # 2025: lucro bruto acima da receita
                    ebitda=[50_000, 40_000], ebit=[30_000, 45_000])   # 2025: EBITDA R$ 5 mi abaixo do EBIT
        dfc, bruto, pla, ebt, _ = Q.identidades({"empresas": [e]})
        for c in (dfc, bruto, pla, ebt):
            self.assertEqual((c.testados, c.ok), (2, 1), c.id)
            self.assertEqual(c.falhas[0]["ano"], 2025, c.id)

    def test_financeiras_fora_do_lucro_bruto(self):
        e = empresa("BBB4", financeiro=True, lucro_bruto=[120, 120], receita=[100, 100])
        self.assertEqual(Q.identidades({"empresas": [e]})[1].testados, 0)


class Lpa(unittest.TestCase):
    def test_calculado_contra_declarado(self):
        # lucro em R$ mil: 1.000 × 1000 / 1 mi de ações = R$ 1,00 por ação
        e = empresa("CCC3", lucro_controladora=[1_000, 1_000], acoes=[1_000_000, 1_000_000], lpa_declarado=[1.0, 10.0])
        c, pontos = Q.lpa({"empresas": [e]})
        self.assertEqual((c.testados, c.ok), (2, 1))
        self.assertEqual(c.falhas[0]["ano"], 2025)
        self.assertEqual([p[2] for p in pontos], [1, 0])

    def test_acoes_estimadas_pelo_lpa_ficam_de_fora(self):
        e = empresa("DDD3", lucro_controladora=[1_000, 1_000], acoes=[1_000_000, 1_000_000], lpa_declarado=[1.0, 10.0],
                    acoes_estimadas=[True, True])
        self.assertEqual(Q.lpa({"empresas": [e]})[0].testados, 0)


class DuasLeiturasDaB3(unittest.TestCase):
    def test_cotacao_preco_de_fim_de_ano_agenda_e_eventos(self):
        h = hist([("2024-12-27", 20.75), ("2024-12-30", 19.31), ("2025-12-29", 23.0), ("2025-12-30", 23.7),
                  ("2026-03-02", 24.0), ("2026-03-03", 12.1)],
                 ev=[("2026-03-03", 2.0, "desdobramento", "b3")],
                 pv=[("2026-08-21", 0.5, "dividendo", "2026-12-21")])
        e = empresa("ABCB4")
        e["cotacao"] = {"ABCB4": {"preco": 12.1, "data": "2026-03-03"}}
        # 2024 com o fechamento de 27/12 (o erro real que o cruzamento achou); 2025 certo
        e["precos_ano"] = {"ABCB4": [20.75, 23.7]}
        agenda = {"x": [{"t": "ABCB4", "tipo": "dividendo", "valor": 0.5, "com": "2026-08-21", "pag": "2026-12-21"},
                        {"t": "ABCB4", "tipo": "jcp", "valor": 0.2, "com": "2026-08-21", "pag": "2026-08-01"}]}
        cot, fim, ag, datas_ag, ev, escopo = Q.b3_b3({"empresas": [e]}, agenda, hist={"ABCB4": h}.get)
        self.assertEqual((cot.testados, cot.ok), (1, 1))
        self.assertEqual((fim.testados, fim.ok), (2, 1))
        self.assertEqual((fim.falhas[0]["ano"], fim.falhas[0]["a"], fim.falhas[0]["b"]), (2024, 20.75, 19.31))
        self.assertEqual((ag.testados, ag.ok), (2, 1))             # o JCP não está nos eventos corporativos
        self.assertEqual((datas_ag.testados, datas_ag.ok), (2, 1))  # pagamento antes da data-com
        self.assertEqual((ev.testados, ev.ok), (1, 1))             # 24,00 → 12,10 no dia do 1:2
        self.assertEqual((escopo.testados, escopo.ok), (1, 1))


class Ptax(unittest.TestCase):
    def test_media_e_fim_do_ano(self):
        ind = {"ptax": {"d0": "2025-12-29", "dd": [1, 2], "v": [5.0, 6.0, 7.0]}}   # 29 e 30/12/2025, 1º/1/2026
        d = {"ptax": {"2025": {"media": 5.5, "fim": 6.0}, "2026": {"media": 7.5, "fim": None}}}
        media, fim = Q.ptax(d, hist={"_indices": ind}.get)
        self.assertEqual((media.testados, media.ok), (2, 1))       # 2026: 7,5 × 7,0 da série
        self.assertEqual((fim.testados, fim.ok), (1, 1))


class PorEmpresa(unittest.TestCase):
    """cada caso conta para a empresa (ticker principal), para a aba filtrar por setor e montar a matriz"""

    def test_casos_e_falhas_pela_empresa_principal(self):
        e = empresa("PETR4", fco=[100_000, 100_000], fci=[-40_000, -40_000], fcf=[-50_000, -50_000], fx_caixa=[0, 0],
                    var_caixa=[10_000, -10_000])
        e["tickers"] = ["PETR3", "PETR4"]
        dfc = Q.identidades({"empresas": [e]})[0].saida()
        self.assertEqual(dfc["por_empresa"], {"PETR4": [2, 1]})
        self.assertEqual(dfc["falhas"][0]["e"], "PETR4")
        # classe que não é a principal (PETR3) conta para a empresa (PETR4)
        h = hist([("2026-03-02", 30.0), ("2026-03-03", 15.2)], ev=[("2026-03-03", 2.0, "desdobramento", "b3")])
        e["precos_ano"] = {}
        e["cotacao"] = {"PETR3": {"preco": 15.2, "data": "2026-03-03"}}
        cot = Q.b3_b3({"empresas": [e]}, {}, hist={"PETR3": h}.get)[0].saida()
        self.assertEqual(cot["por_empresa"], {"PETR4": [1, 1]})

    def test_ptax_fica_sem_empresa(self):
        ind = {"ptax": {"d0": "2025-12-30", "dd": [], "v": [5.0]}}
        media = Q.ptax({"ptax": {"2025": {"media": 5.0, "fim": 5.0}}}, hist={"_indices": ind}.get)[0].saida()
        self.assertNotIn("por_empresa", media)


class Notas(unittest.TestCase):
    def test_nota_desconta_ocorrencias_e_ordena_da_melhor_para_a_pior(self):
        d = {"empresas": [empresa("AAA3"), empresa("BBB3")]}
        achados = [{"ticker": "BBB3", "sev": "alta"}, {"ticker": "BBB3", "sev": "baixa"}, {"ticker": "AAA3", "sev": "info"}]
        checagens = [{"id": "cotacao_hist", "falhas": [{"t": "AAA3"}]}]   # cruzamento novo de peso alto
        notas = Q.notas(d, achados, checagens)
        self.assertEqual([(n["t"], n["nota"]) for n in notas], [("AAA3", 75), ("BBB3", 72)])


@unittest.skipUnless((RAIZ / "data" / "qualidade.js").exists(), "sem data/qualidade.js")
class DadosGerados(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        texto = (RAIZ / "data" / "qualidade.js").read_text(encoding="utf-8")
        cls.q = json.loads(texto.split("=", 1)[1].rstrip().rstrip(";"))
        cls.js = (RAIZ / "qualidade.js").read_text(encoding="utf-8")

    def test_cada_cruzamento_tem_texto_na_aba(self):
        for c in self.q["checagens"]:
            self.assertRegex(self.js, r"\b" + re.escape(c["id"]) + r": \{", c["id"])
            self.assertIn(c["grupo"], ("cvm", "cvm_b3", "b3", "bcb"))
            self.assertLessEqual(c["ok"], c["testados"])
            self.assertEqual(c["testados"] - c["ok"], c["n_falhas"])

    def test_por_empresa_soma_o_total_e_guarda_todas_as_falhas(self):
        for c in self.q["checagens"]:
            self.assertEqual(len(c["falhas"]), c["n_falhas"], c["id"])
            if "por_empresa" in c:
                self.assertEqual(sum(v[0] for v in c["por_empresa"].values()), c["testados"], c["id"])
                self.assertEqual(sum(v[1] for v in c["por_empresa"].values()), c["ok"], c["id"])
                self.assertTrue(all(f.get("e") for f in c["falhas"]), c["id"])

    def test_notas_da_melhor_para_a_pior(self):
        notas = [x["nota"] for x in self.q["empresas"]]
        self.assertEqual(notas, sorted(notas, reverse=True))

    def test_historico_um_ponto_por_pregao(self):
        datas = [h["data"] for h in self.q["historico"]]
        self.assertEqual(datas, sorted(set(datas)))
        self.assertEqual(self.q["historico"][-1]["data"], self.q["cotacoes_em"])


if __name__ == "__main__":
    unittest.main()
