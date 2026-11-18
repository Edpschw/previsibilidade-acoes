"""Invariantes sobre a base gerada (data/empresas.js).

Cada teste fixa um caso real que já esteve errado. Rodam depois de scripts/processar.py;
sem a base gerada, são pulados.

    python3 -m unittest discover -s tests
"""

import json
import unittest
from pathlib import Path

ARQ = Path(__file__).resolve().parent.parent / "data" / "empresas.js"


def carregar():
    texto = ARQ.read_text(encoding="utf-8")
    return json.loads(texto.split("=", 1)[1].rstrip().rstrip(";"))


@unittest.skipUnless(ARQ.exists(), "rode scripts/processar.py antes")
class Base(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.d = carregar()
        cls.por_ticker = {t: e for e in cls.d["empresas"] for t in e["tickers"]}

    def e(self, ticker):
        self.assertIn(ticker, self.por_ticker, f"{ticker} saiu da base")
        return self.por_ticker[ticker]

    def no_ano(self, e, chave, ano):
        return e["series"][chave][e["anos"].index(ano)]

    # ---- cobertura
    def test_tamanho_da_base(self):
        self.assertGreaterEqual(len(self.d["empresas"]), 320)

    def test_casos_que_ja_faltaram(self):
        for t in ("SAPR11", "B3SA3", "BPAC11", "CSNA3", "MBRF3", "CEAB3", "TUPY3", "TIMS3", "PETR4", "VALE3", "ITUB4"):
            self.e(t)

    def test_ticker_em_uma_empresa_so(self):
        vistos = {}
        for e in self.d["empresas"]:
            for t in e["tickers"]:
                self.assertNotIn(t, vistos, f"{t} em {vistos.get(t)} e {e['nome']}")
                vistos[t] = e["nome"]

    # ---- valores que já estiveram errados
    def test_b3_tem_valor_de_mercado(self):
        self.assertGreater(self.e("B3SA3")["valor_mercado"], 30_000_000)  # R$ mil

    def test_b3_dividendos_no_fluxo_de_caixa(self):
        self.assertGreater(self.e("B3SA3")["series"]["dividendos_pagos"][-1], 0)

    def test_csn_mineracao_escala(self):
        e = self.e("CMIN3")
        self.assertLess(self.no_ano(e, "acoes", 2025), 6e9)
        self.assertGreater(self.no_ano(e, "lucro_controladora", 2024), 0)

    def test_vivo_escala(self):
        e = self.e("VIVT3")
        self.assertGreater(self.no_ano(e, "acoes", 2021), 1e9)

    def test_magalu_intacta(self):
        e = self.e("MGLU3")
        self.assertGreater(self.no_ano(e, "acoes", 2023), 6e9)
        self.assertLess(self.no_ano(e, "acoes", 2024), 1e9)

    def test_riosulense_intacta(self):
        e = self.e("RSUL4")
        self.assertEqual(self.no_ano(e, "acoes", 2021), 5_830_000)

    def test_tim_ativo(self):
        self.assertGreater(self.e("TIMS3")["series"]["ativo_total"][-1], 0)

    def test_sanepar_individual(self):
        e = self.e("SAPR11")
        self.assertTrue(e["individual"])
        self.assertGreater(e["series"]["receita"][-1], 0)

    def test_petrobras_valor_de_mercado(self):
        e = self.e("PETR4")
        p = e["cotacao"]["PETR4"]["preco"]
        self.assertAlmostEqual(e["valor_mercado"] * 1000 / (p * 12_888_732_761), 1, delta=0.1)

    def test_sem_brasil_como_exterior(self):
        self.assertFalse(any("Brasil" in e["exterior"] for e in self.d["empresas"]))

    def test_doze_meses_petrobras(self):
        t = self.e("PETR4")["ttm"]
        self.assertIsNotNone(t)
        self.assertAlmostEqual(t["lucro_controladora"] / 140_421_000, 1, delta=0.05)

    def test_maioria_tem_doze_meses(self):
        com = sum(1 for e in self.d["empresas"] if e.get("ttm"))
        self.assertGreater(com / len(self.d["empresas"]), 0.85)

    def test_sanepar_caixa_operacional_explicado_pelo_giro(self):
        s = self.e("SAPR11")["series"]
        i = self.e("SAPR11")["anos"].index(2025)
        self.assertGreater(s["fco_giro"][i], 3_000_000)  # R$ 3,3 bi de capital de giro em 2025

    def test_fluxo_de_caixa_fecha_no_ultimo_ano(self):
        quebras = []
        for e in self.d["empresas"]:
            s = e["series"]
            fco, fci, fcf, vc = s["fco"][-1], s["fci"][-1], s["fcf"][-1], s["var_caixa"][-1]
            if None in (fco, fci, fcf, vc):
                continue
            soma = fco + fci + fcf + (s["fx_caixa"][-1] or 0)
            if abs(soma - vc) > max(0.02 * max(abs(fco), abs(fci), abs(fcf), 1), 1000):
                quebras.append(e["ticker"])
        self.assertLessEqual(len(quebras), 3, quebras)

    # ---- sanidade geral
    def test_ativo_positivo_no_ultimo_ano(self):
        ruins = [e["ticker"] for e in self.d["empresas"]
                 if e["series"]["ativo_total"][-1] is not None and e["series"]["ativo_total"][-1] <= 0]
        self.assertEqual(ruins, [])

    def test_ptax_e_datas(self):
        self.assertTrue(self.d["ptax_atual"]["valor"] > 1)
        self.assertTrue(self.d["cotacoes_em"])


if __name__ == "__main__":
    unittest.main()
