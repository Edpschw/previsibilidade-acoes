"""Testes do histórico diário da aba Simular (scripts/historico.py), com dados sintéticos.

    python3 -m unittest tests.test_historico
"""

import io
import sys
import unittest
from datetime import date
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
import historico as H  # noqa: E402


def cotahist(data, ticker, preco, especie="ON      NM", bdi="02", mercado="010", fator=1, isin="BRXXXXACNOR0"):
    """Uma linha do COTAHIST no layout fixo da B3 (245 posições)."""
    campos = [
        "01", data.replace("-", ""), bdi, ticker.ljust(12), mercado, "EMPRESA".ljust(12), especie.ljust(10),
        " " * 3, "R$  ", *(["0" * 13] * 4), f"{round(preco * 100):013d}", "0" * 13, "0" * 13, "0" * 5,
        "0" * 18, "0" * 18, "0" * 13, "0", "99991231", f"{fator:07d}", "0" * 13, isin.ljust(12), "000",
    ]
    linha = "".join(campos)
    assert len(linha) == 245, len(linha)
    return linha.encode("latin-1") + b"\r\n"


class Cotahist(unittest.TestCase):
    def test_le_todos_os_pregoes_so_de_acoes(self):
        f = io.BytesIO(b"".join([
            cotahist("2024-01-02", "PETR4", 37.21, "PN      N2"),
            cotahist("2024-01-03", "PETR4", 37.50, "PN      N2"),
            cotahist("2024-01-02", "XPTO11", 100.0, "CI"),                 # fundo
            cotahist("2024-01-02", "PETRA400", 1.5, "PN", mercado="070"),  # opção
            cotahist("2024-01-02", "PETR4F", 37.2, "PN", bdi="96"),        # fracionário
        ]))
        self.assertEqual(H.ler_cotahist_diario(f), {"PETR4": [("2024-01-02", 37.21), ("2024-01-03", 37.5)]})

    def test_fator_de_cotacao(self):
        f = io.BytesIO(cotahist("2010-01-04", "XYZW3", 1500.0, fator=1000))
        self.assertEqual(H.ler_cotahist_diario(f)["XYZW3"], [("2010-01-04", 1.5)])


class CodigosAntigos(unittest.TestCase):
    def test_costura_quando_o_preco_continua(self):
        # Kroton → Cogna (2019): mesmo papel, código novo
        antigo = {"2019-10-15": 9.8, "2019-10-16": 10.0}
        atual = {"2019-10-17": 10.1, "2019-10-18": 10.2}
        serie, origem = H.costurar(atual, {"KROT3": antigo})
        self.assertEqual(sorted(serie), ["2019-10-15", "2019-10-16", "2019-10-17", "2019-10-18"])
        self.assertEqual(origem, [("KROT3", "2019-10-15")])

    def test_nao_costura_papel_diferente(self):
        # salto de 60% na troca: não é o mesmo papel (incorporação com relação de troca)
        serie, origem = H.costurar({"2021-03-01": 16.0}, {"VELH3": {"2021-02-26": 10.0}})
        self.assertEqual(serie, {"2021-03-01": 16.0})
        self.assertEqual(origem, [])

    def test_classe_pelo_sufixo(self):
        self.assertEqual([H.classe(t) for t in ("PETR4", "B3SA3", "TAEE11", "BPAC5")], ["4", "3", "11", "5"])


DATAS = ["2024-04-10", "2024-04-11", "2024-04-12", "2024-04-15", "2024-04-16"]


class Eventos(unittest.TestCase):
    def test_desdobramento_da_ficha_conferido_pelo_preco(self):
        # Banco do Brasil, 2024: último dia "com" 15/04; o preço cai pela metade no dia seguinte
        precos = [55.0, 56.0, 56.5, 57.0, 28.7]
        sup = {"stockDividends": [
            {"label": "DESDOBRAMENTO", "factor": "100,00", "lastDatePrior": "15/04/2024", "isinCode": "BRBBASACNOR3"},
            {"label": "DESDOBRAMENTO", "factor": "100,00", "lastDatePrior": "15/04/2024", "isinCode": "BRBBASACNOR3"},
        ]}
        ev = H.eventos_com_data(DATAS, precos, sup, {"BBAS"}, ("ACNOR",), [])
        self.assertEqual(ev, [("2024-04-16", 2.0, "desdobramento", "b3")])

    def test_evento_da_ficha_que_o_preco_desmente_fica_de_fora(self):
        precos = [30.0, 30.2, 30.1, 30.3, 30.4]   # grupamento 100:1 que não aconteceu
        sup = {"stockDividends": [{"label": "GRUPAMENTO", "factor": "0,01", "lastDatePrior": "15/04/2024",
                                   "isinCode": "BRITUBACNPR1"}]}
        self.assertEqual(H.eventos_com_data(DATAS, precos, sup, {"ITUB"}, ("ACNPR",), []), [])

    def test_evento_de_outra_classe_nao_vale(self):
        precos = [55.0, 56.0, 56.5, 57.0, 28.7]
        sup = {"stockDividends": [{"label": "DESDOBRAMENTO", "factor": "100,00", "lastDatePrior": "15/04/2024",
                                   "isinCode": "BRXPTOACNPR0"}]}
        self.assertEqual(H.eventos_com_data(DATAS, precos, sup, {"XPTO"}, ("ACNOR",), []), [])

    def test_evento_anual_ganha_a_data_do_salto_do_preco(self):
        # Vivo, 2025: desdobramento que a ficha não lista, achado pela contagem
        datas = ["2025-04-28", "2025-04-29", "2025-04-30", "2025-05-02"]
        precos = [62.0, 62.5, 31.4, 31.6]
        anuais = [{"tipo": "ajuste", "fator": 2.0, "ano": 2025, "ano_preco": 2025, "origem": "contagem"}]
        self.assertEqual(H.eventos_com_data(datas, precos, {}, {"VIVT"}, ("ACNOR",), anuais),
                         [("2025-04-30", 2.0, "ajuste", "contagem")])

    def test_ajuste_so_da_contagem_nao_mexe_no_preco(self):
        anuais = [{"tipo": "ajuste", "fator": 0.5, "ano": 2010, "ano_preco": None, "origem": "contagem"}]
        self.assertEqual(H.eventos_com_data(DATAS, [1, 1, 1, 1, 1], {}, {"VALE"}, ("ACNOR",), anuais), [])


class Proventos(unittest.TestCase):
    SUP = {"cashDividends": [
        {"label": "JRS CAP PROPRIO", "rate": "0,25", "lastDatePrior": "10/03/2023", "paymentDate": "30/04/2023",
         "isinCode": "BRPETRACNPR6"},
        {"label": "JRS CAP PROPRIO", "rate": "0,25", "lastDatePrior": "10/03/2023", "paymentDate": "30/04/2023",
         "isinCode": "BRPETRACNPR6"},                                                         # repetido
        {"label": "DIVIDENDO", "rate": "1,10", "lastDatePrior": "01/08/2024", "paymentDate": "31/12/9999",
         "isinCode": "BRPETRACNPR6"},                                                         # sem data de pagamento
        {"label": "DIVIDENDO", "rate": "0,90", "lastDatePrior": "01/08/2024", "paymentDate": "20/09/2024",
         "isinCode": "BRPETRACNOR9"},                                                         # outra classe
        {"label": "DIVIDENDO", "rate": "0,50", "lastDatePrior": "01/08/2008", "isinCode": "BRPETRACNPR6"},  # antes de 2010
    ]}

    def test_da_classe_sem_repetidos(self):
        self.assertEqual(H.proventos(self.SUP, {"PETR"}, "ACNPR"), [
            ("2023-03-10", 0.25, "jcp", "2023-04-30"),
            ("2024-08-01", 1.1, "dividendo", None),
        ])

    def test_unit_sem_provento_proprio_soma_as_acoes(self):
        # BPAC11 = 1 ON + 2 PNA
        sup = {"cashDividends": [
            {"label": "JRS CAP PROPRIO", "rate": "0,10", "lastDatePrior": "05/06/2025", "paymentDate": "20/06/2025",
             "isinCode": "BRBPACACNOR1"},
            {"label": "JRS CAP PROPRIO", "rate": "0,10", "lastDatePrior": "05/06/2025", "paymentDate": "20/06/2025",
             "isinCode": "BRBPACACNPA4"},
        ]}
        self.assertEqual(H.proventos(sup, {"BPAC"}, "CDAM", {"ACNOR": 1, "ACNPA": 2}),
                         [("2025-06-05", 0.3, "jcp", "2025-06-20")])

    def test_composicao_da_unit(self):
        e = {"units": {"000000": [1, 2]}, "tickers": ["BPAC3", "BPAC5", "BPAC11"]}
        self.assertEqual(H.composicao_unit(e, "BPAC11"), {"ACNOR": 1, "ACNPA": 2})


class ProventosDaPagina(unittest.TestCase):
    """Página de eventos corporativos da B3: o histórico inteiro, por classe, sem data de pagamento."""
    ITENS = [
        {"typeStock": "PN", "corporateAction": "JRS CAP PROPRIO", "valueCash": "0,30", "lastDatePriorEx": "15/03/2012",
         "quotedPerShares": "1"},
        {"typeStock": "PN", "corporateAction": "DIVIDENDO", "valueCash": "450,00", "lastDatePriorEx": "20/04/2010",
         "quotedPerShares": "1000", "closingPricePriorExDate": "30,00"},  # cotado por lote de mil ações
        {"typeStock": "PN", "corporateAction": "DIVIDENDO", "valueCash": "25,00", "lastDatePriorEx": "20/05/2011",
         "closingPricePriorExDate": "30,00"},                           # 83% do preço: escala errada
        {"typeStock": "ON", "corporateAction": "DIVIDENDO", "valueCash": "0,25", "lastDatePriorEx": "15/03/2012"},
        {"typeStock": "PN", "corporateAction": "SUBSCRICAO", "valueCash": "1,00", "lastDatePriorEx": "15/03/2013"},
    ]

    def test_da_classe_com_pagamento_estimado(self):
        self.assertEqual(H.proventos_da_pagina(self.ITENS, "PN", date(2026, 11, 21)), [
            ("2010-04-20", 0.45, "dividendo", "2010-05-20"),
            ("2012-03-15", 0.3, "jcp", "2012-04-14"),
        ])

    def test_ficha_por_cima_da_pagina(self):
        ficha = [("2026-03-10", 0.25, "jcp", "2026-04-30")]
        pagina = [("2026-03-10", 0.25, "jcp", "2026-04-09"), ("2012-03-15", 0.3, "jcp", "2012-04-14")]
        self.assertEqual(H.juntar_proventos(ficha, pagina), [
            ("2012-03-15", 0.3, "jcp", "2012-04-14"),
            ("2026-03-10", 0.25, "jcp", "2026-04-30"),
        ])


class Saida(unittest.TestCase):
    def test_datas_e_precos_compactos_voltam_iguais(self):
        datas = ["2024-12-27", "2024-12-30", "2024-12-31", "2025-01-02"]
        precos = [10.0, 10.25, 9.99, 0.45]
        d, p = H.compactar_datas(datas), H.compactar_precos(precos)
        self.assertEqual(d, {"d0": "2024-12-27", "dd": [3, 1, 2]})
        self.assertEqual(p["esc"], 10000)   # abaixo de R$ 0,50: décimos de milésimo
        ints = [p["p0"]]
        for x in p["dp"]:
            ints.append(ints[-1] + x)
        self.assertEqual([i / p["esc"] for i in ints], precos)

    def test_indices_cdi_e_ipca(self):
        def sgs(serie, ano, hoje, refazer):
            if ano != 2025:
                return []
            if serie == 12:
                return [(date(2025, 1, 2), 0.05), (date(2025, 1, 3), 0.05), (date(2025, 1, 6), 0.05)]
            return [(date(2025, m, 1), 0.5) for m in range(1, 13)]

        with mock.patch.object(H, "serie_sgs", sgs), mock.patch.object(H.P, "baixar", side_effect=OSError), \
                mock.patch("builtins.print"):
            ind = H.indices(date(2025, 12, 31))
        self.assertEqual(ind["cdi"]["d0"], "2025-01-02")
        self.assertEqual(ind["cdi"]["dd"], [1, 3])
        self.assertEqual(ind["cdi"]["i"], [1.0, 1.0005, round(1.0005 ** 2, 8)])
        self.assertAlmostEqual(ind["cdi_aa"], round(1.0005 ** 252 - 1, 4))
        self.assertAlmostEqual(ind["ipca_12m"], round(1.005 ** 12 - 1, 4))
        self.assertEqual(ind["ipca"]["m0"], "2025-01")
        self.assertNotIn("ptax", ind)


if __name__ == "__main__":
    unittest.main()
