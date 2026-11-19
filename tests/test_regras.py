"""Testes das regras de processamento com dados sintéticos (não baixam nada).

Cada caso reproduz um problema real encontrado na auditoria, para que uma mudança futura
não desfaça a correção sem ninguém perceber.

    python3 -m unittest discover -s tests
"""

import io
import sys
import unittest
import zipfile
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
import processar as P  # noqa: E402

CAB_DRE = ("CNPJ_CIA;DT_REFER;VERSAO;DENOM_CIA;CD_CVM;GRUPO_DFP;MOEDA;ESCALA_MOEDA;ORDEM_EXERC;"
           "DT_INI_EXERC;DT_FIM_EXERC;CD_CONTA;DS_CONTA;VL_CONTA;ST_CONTA_FIXA")


def linha_dre(cnpj, conta, nome, valor, versao=1):
    return (f"{cnpj};2025-12-31;{versao};EMPRESA;000001;DF;REAL;MIL;ÚLTIMO;2025-01-01;2025-12-31;"
            f"{conta};{nome};{valor};S")


def zip_dfp(arquivos):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        for nome, linhas in arquivos.items():
            zf.writestr(f"dfp_cia_aberta_{nome}_2025.csv", "\r\n".join([CAB_DRE] + linhas).encode("latin-1"))
    buf.seek(0)
    return zipfile.ZipFile(buf)


def serie(acoes, lpa=None, lucro=None):
    n = len(acoes)
    return {
        "acoes": list(acoes),
        "acoes_on": list(acoes),
        "acoes_pn": [0] * n,
        "acoes_estimadas": [False] * n,
        "lpa_declarado": list(lpa or [None] * n),
        "lucro_controladora": list(lucro or [None] * n),
    }


class ConsolidadoOuIndividual(unittest.TestCase):
    """Sanepar só publica o individual; TIM entregou o consolidado zerado em 2025."""

    def setUp(self):
        zf = zip_dfp({
            "DRE_con": [
                # TIM: consolidado todo zerado
                linha_dre("TIM", "3.01", "Receita de Venda de Bens e/ou Serviços", 0),
                linha_dre("TIM", "3.11", "Lucro/Prejuízo Consolidado do Período", 0),
                # empresa normal: consolidado vale
                linha_dre("NORMAL", "3.01", "Receita de Venda de Bens e/ou Serviços", 1000),
                linha_dre("NORMAL", "3.11", "Lucro/Prejuízo Consolidado do Período", 100),
            ],
            "DRE_ind": [
                linha_dre("TIM", "3.01", "Receita de Venda de Bens e/ou Serviços", 26624721),
                linha_dre("TIM", "3.11", "Lucro/Prejuízo do Período", 3000000),
                linha_dre("SANEPAR", "3.01", "Receita de Venda de Bens e/ou Serviços", 7205727),
                linha_dre("SANEPAR", "3.11", "Lucro/Prejuízo do Período", 2079568),
                linha_dre("NORMAL", "3.01", "Receita de Venda de Bens e/ou Serviços", 999999),
            ],
        })
        self.base = {}
        P.extrair_ano(zf, 2025, {"TIM", "SANEPAR", "NORMAL"}, self.base)

    def test_so_individual_entra(self):
        self.assertEqual(self.base["SANEPAR"][2025]["receita"], 7205727)
        self.assertEqual(self.base["SANEPAR"][2025]["lucro_liquido"], 2079568)
        self.assertTrue(self.base["SANEPAR"][2025].get("_individual"))

    def test_consolidado_zerado_cai_no_individual(self):
        self.assertEqual(self.base["TIM"][2025]["receita"], 26624721)

    def test_consolidado_tem_prioridade(self):
        self.assertEqual(self.base["NORMAL"][2025]["receita"], 1000)
        self.assertFalse(self.base["NORMAL"][2025].get("_individual"))


class EscalaDasAcoes(unittest.TestCase):
    def test_csn_mineracao_10x(self):
        s = serie([5_485_338_838, 5_432_044_538, 54_267_151_083],
                  lpa=[0.65, 0.83, 0.0], lucro=[3_568_737, 4_527_718, 1_649_647])
        P.corrigir_escala_por_preco([2023, 2024, 2025], s, {"CMIN3": [7.83, 5.15, 5.45]})
        self.assertAlmostEqual(s["acoes"][2] / 5_426_715_108, 1, places=3)
        self.assertEqual(s["acoes_corrigidas"], [2025])

    def test_vivo_anos_em_milhares(self):
        s = serie([1_688_174, 1_676_938, 1_663_556_731, 1_652_584_004])
        P.corrigir_escala_por_preco([2020, 2021, 2022, 2023], s, {"VIVT3": [45.0, 48.19, 38.35, 53.44]})
        self.assertGreater(s["acoes"][0], 1e9)
        self.assertGreater(s["acoes"][1], 1e9)
        self.assertEqual(sorted(s["acoes_corrigidas"]), [2020, 2021])

    def test_imc_salto_qualquer_confirmado_pelo_lpa(self):
        s = serie([285_443_030, 5_708_860_600], lpa=[None, -0.52029], lucro=[None, -148_968])
        P.corrigir_escala_por_preco([2024, 2025], s, {"MEAL3": [1.10, 0.95]})
        self.assertEqual(s["acoes"][1], 285_443_030)

    def test_magalu_grupamento_real_nao_mexe(self):
        s = serie([6_691_911_214, 736_060_221], lpa=[-0.15, 0.30], lucro=[-1_000_000, 220_000])
        P.corrigir_escala_por_preco([2023, 2024], s, {"MGLU3": [2.16, 6.50]})
        self.assertEqual(s["acoes"], [6_691_911_214, 736_060_221])
        self.assertEqual(s["acoes_corrigidas"], [])

    def test_riosulense_desdobramento_real_com_lpa_antigo_nao_mexe(self):
        s = serie([583_000, 5_830_000], lpa=[-9.4, 146.28], lucro=[-5_709, 88_794])
        P.corrigir_escala_por_preco([2020, 2021], s, {"RSUL4": [188.0, 76.99]})
        self.assertEqual(s["acoes"], [583_000, 5_830_000])


class ClassesEValorDeMercado(unittest.TestCase):
    def test_raiz_com_digito(self):
        self.assertEqual(P.preco_por_classe({"B3SA3": 14.65}, ["B3SA3"], {}), {"on": 14.65, "pn": 14.65})

    def test_sufixo_de_balcao(self):
        self.assertEqual(P.preco_por_classe({"EQMA3B": 30.92}, ["EQMA3B"], {})["on"], 30.92)

    def test_valor_mercado_on_pn(self):
        vm = P.valor_mercado({"PETR3": 46.0, "PETR4": 43.98}, ["PETR3", "PETR4"], {},
                             7_442_231_382, 5_446_501_379, 12_888_732_761)
        self.assertAlmostEqual(vm / 1e6, (7_442_231_382 * 46.0 + 5_446_501_379 * 43.98) / 1e9, places=0)

    def test_unit_sem_classes_negociadas(self):
        p = P.preco_por_classe({"XPTO11": 30.0}, ["XPTO11"], {"XPTO11": [1, 2]})
        self.assertEqual(p, {"on": 10.0, "pn": 10.0})

    def test_ticker_principal_por_volume(self):
        self.assertEqual(P.ticker_principal(["SAPR3", "SAPR4", "SAPR11"], {"SAPR11": 9e7, "SAPR4": 1e7}), "SAPR11")
        self.assertEqual(P.ticker_principal(["PETR3", "PETR4"]), "PETR4")


class Cadastro(unittest.TestCase):
    def test_composicao_de_units(self):
        self.assertEqual(P.composicao_unit("1 ON + 2 PN"), [1, 2])
        self.assertEqual(P.composicao_unit("1 KLBN3 + 4 KLBN4"), [1, 4])
        self.assertEqual(P.composicao_unit("2 ações preferenciais e 1 ação ordinária"), [1, 2])
        self.assertEqual(P.composicao_unit("1 ação ordinária e 4 ações preferenciais"), [1, 4])
        self.assertIsNone(P.composicao_unit(""))


class UltimosDozeMeses(unittest.TestCase):
    def test_soma_exercicio_mais_acumulado_menos_acumulado_anterior(self):
        # Petrobras: lucro 2025 = 110,6 bi; 9M/2026 = 125,0 bi; 9M/2025 = 95,0 bi
        s = {k: [None] for k in P.FLUXOS_12M}
        s["lucro_controladora"] = [110_129_000]
        s["lucro_liquido"] = [110_605_000]
        s["receita"] = [497_549_000]
        per = {
            "2026-09-30": {"receita": 462_569_000, "lucro_liquido": 125_039_000, "lucro_controladora": 124_500_000,
                           "pl": 505_631_000},
            "2025-09-30": {"receita": 370_178_000, "lucro_liquido": 94_952_000, "lucro_controladora": 94_000_000},
        }
        t = P.ultimos_12m([2025], s, per)
        self.assertEqual(t["ate"], "2026-09-30")
        self.assertEqual(t["lucro_liquido"], 110_605_000 + 125_039_000 - 94_952_000)
        self.assertEqual(t["receita"], 497_549_000 + 462_569_000 - 370_178_000)
        self.assertEqual(t["pl"], 505_631_000)

    def test_sem_periodo_comparavel(self):
        s = {k: [1] for k in P.FLUXOS_12M}
        self.assertIsNone(P.ultimos_12m([2025], s, {"2026-09-30": {"receita": 1, "lucro_liquido": 1}}))


class AcoesDaCvm(unittest.TestCase):
    """Ações do formulário mais recente da CVM (composição do capital da DFP ou do ITR)."""

    def test_petrobras_itr_mais_recente(self):
        comp = {"2025-12-31": (7_442_231_382, 5_446_501_379, 0, 0, "DFP"),
                "2026-09-30": (7_442_231_382, 5_446_501_379, 0, 0, "ITR")}
        c = P.acoes_cvm(comp, {"acoes": [12_888_732_761]}, 1, 12_888_732_761)
        self.assertEqual((c["data"], c["fonte"], c["on"], c["pn"]), ("2026-09-30", "ITR", 7_442_231_382, 5_446_501_379))

    def test_bgip4_itr_10x_com_dfp_e_b3_de_acordo(self):
        # ITR de 2026 declarou 10× as ações; DFP e B3 concordam entre si
        c = P.acoes_cvm({"2026-09-30": (0, 230_817_400, 0, 0, "ITR")}, {"acoes": [21_548_228]}, 1, 23_081_740)
        self.assertEqual(c["pn"], 23_081_740)

    def test_grupamento_depois_da_dfp_fica(self):
        # PDGR3: a B3 já reflete o grupamento, a DFP não; o ITR fica como declarado
        c = P.acoes_cvm({"2026-09-30": (3_287_000_000, 0, 0, 0, "ITR")}, {"acoes": [3_287_000_000]}, 1, 27_194_915)
        self.assertEqual(c["on"], 3_287_000_000)

    def test_itr_em_milhares_segue_a_escala_da_serie(self):
        c = P.acoes_cvm({"2026-06-30": (1_688_174, 0, 0, 0, "ITR")}, {"acoes": [1_652_584_004]}, 1)
        self.assertEqual(c["on"], 1_688_174_000)


class EventosDeAcoes(unittest.TestCase):
    """Desdobramento, grupamento e bonificação da ficha da B3, confirmados pela contagem anual da CVM."""

    def test_le_a_ficha_da_b3(self):
        sup = {"stockDividends": [
            {"label": "DESDOBRAMENTO", "factor": "100,00000000000", "lastDatePrior": "15/04/2024"},
            {"label": "DESDOBRAMENTO", "factor": "100,00000000000", "lastDatePrior": "15/04/2024"},  # outra classe
            {"label": "GRUPAMENTO", "factor": "0,10000000000", "lastDatePrior": "24/05/2024"},
            {"label": "BONIFICACAO", "factor": "10,00000000000", "lastDatePrior": "18/04/2022"},
            {"label": "CIS RED CAP", "factor": "100,00000000000", "lastDatePrior": "01/10/2021"},
        ]}
        ev = P.eventos_acoes(sup)
        self.assertEqual([(x["tipo"], x["fator"]) for x in ev],
                         [("bonificacao", 1.1), ("desdobramento", 2.0), ("grupamento", 0.1)])

    def test_bb_desdobramento_confirmado(self):
        anos = [2022, 2023, 2024, 2025]
        s = {"acoes": [2_854e6, 2_854e6, 5_708e6, 5_708e6], "acoes_estimadas": [False] * 4}
        ev = P.eventos_confirmados(anos, s, [{"data": "2024-04-15", "tipo": "desdobramento", "fator": 2.0}])
        self.assertEqual(ev[0]["ano"], 2024)

    def test_evento_que_a_contagem_nao_mostra_fica_de_fora(self):
        # ficha do Itaú lista um grupamento 100:1 em 2011 que a contagem da CVM não reflete
        anos = [2010, 2011, 2012]
        s = {"acoes": [4.5e9, 4.5e9, 4.5e9], "acoes_estimadas": [True] * 3}
        self.assertEqual(P.eventos_confirmados(anos, s, [{"data": "2011-10-31", "tipo": "grupamento", "fator": 0.01}]), [])

    def test_ano_estimado_pelo_lpa_atrasa_um_ano(self):
        # LPA é média do ano: desdobramento em novembro aparece na contagem estimada só no ano seguinte
        anos = [2017, 2018, 2019]
        s = {"acoes": [6.5e9, 6.6e9, 9.8e9], "acoes_estimadas": [True, True, True]}
        ev = P.eventos_confirmados(anos, s, [{"data": "2018-11-19", "tipo": "desdobramento", "fator": 1.5}])
        self.assertEqual(ev[0]["ano"], 2019)


class CorteDeLiquidez(unittest.TestCase):
    def test_entra_com_um_milhao(self):
        self.assertTrue(P.no_corte(1_000_000, False))
        self.assertFalse(P.no_corte(999_999, False))

    def test_folga_para_quem_ja_estava(self):
        self.assertTrue(P.no_corte(600_000, True))
        self.assertFalse(P.no_corte(400_000, True))

    def test_soma_as_classes(self):
        cad = {"a": {"tickers": ["XPTO3", "XPTO4"]}, "b": {"tickers": ["YYYY3"]}}
        fica = P.aplicar_corte(cad, {"XPTO3": 600_000, "XPTO4": 500_000, "YYYY3": 900_000}, set())
        self.assertEqual(set(fica), {"a"})


class Trava(unittest.TestCase):
    def setUp(self):
        sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
        import auditar
        self.trava = auditar.trava
        self.base = {"emissores_negociados": 303, "cobertura": 0.99, "empresas": 345, "graves": [],
                     "cotacoes_em": "2026-11-17"}

    def test_aprova_base_igual_ou_melhor(self):
        self.assertEqual(self.trava(dict(self.base, cotacoes_em="2026-11-18"), self.base), [])

    def test_barra_cotacoes_que_recuam(self):
        self.assertTrue(self.trava(dict(self.base, cotacoes_em="2026-11-16"), self.base))

    def test_barra_cobertura_baixa_e_base_menor(self):
        self.assertTrue(self.trava(dict(self.base, cobertura=0.90), self.base))
        self.assertTrue(self.trava(dict(self.base, empresas=300), self.base))


class Proventos(unittest.TestCase):
    def test_janela_de_12_meses_por_especie(self):
        sup = {"cashDividends": [
            {"isinCode": "BRSAPRACNOR9", "rate": "0,10", "lastDatePrior": "30/12/2025"},
            {"isinCode": "BRSAPRACNPR6", "rate": "0,11", "lastDatePrior": "30/12/2025"},
            {"isinCode": "BRSAPRCDAM13", "rate": "0,55", "lastDatePrior": "30/12/2025"},
            {"isinCode": "BRSAPRACNOR9", "rate": "9,99", "lastDatePrior": "01/01/2025"},  # fora da janela
        ]}
        r = P.proventos_12m(sup, ["SAPR3", "SAPR4", "SAPR11"], hoje=date(2026, 11, 17))
        self.assertAlmostEqual(r["SAPR3"], 0.10)
        self.assertAlmostEqual(r["SAPR4"], 0.11)
        self.assertAlmostEqual(r["SAPR11"], 0.55)

    def test_agenda_so_eventos_por_vir(self):
        sup = {"cashDividends": [
            {"isinCode": "BRPETRACNPR6", "label": "DIVIDENDO", "rate": "0,47", "lastDatePrior": "21/08/2026", "paymentDate": "21/12/2026"},
            {"isinCode": "BRPETRACNOR9", "label": "JRS CAP PROPRIO", "rate": "0,67", "lastDatePrior": "01/12/2026", "paymentDate": "20/01/2027"},
            {"isinCode": "BRPETRACNOR9", "label": "DIVIDENDO", "rate": "1,00", "lastDatePrior": "01/03/2026", "paymentDate": "01/05/2026"},
        ]}
        ag = P.proventos_agenda(sup, ["PETR3", "PETR4"], hoje=date(2026, 11, 18))
        self.assertEqual([(x["t"], x["tipo"]) for x in ag], [("PETR4", "dividendo"), ("PETR3", "jcp")])
        self.assertEqual(ag[0]["pag"], "2026-12-21")

    def test_numeros_brasileiros(self):
        self.assertEqual(P.num_br("12.888.732.761"), 12888732761)
        self.assertEqual(P.data_br("17/11/2026"), date(2026, 11, 17))


if __name__ == "__main__":
    unittest.main()
