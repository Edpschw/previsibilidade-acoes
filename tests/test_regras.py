"""Testes das regras de processamento com dados sintéticos (não baixam nada).

Cada caso reproduz um problema real encontrado na auditoria, para que uma mudança futura
não desfaça a correção sem ninguém perceber.

    python3 -m unittest discover -s tests
"""

import io
import sys
import tempfile
import unittest
import zipfile
from datetime import date
from pathlib import Path
from unittest import mock

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
        self.assertEqual(ev[0]["ano_preco"], 2018)  # a cotação de fim de 2018 já é da base nova

    def test_desdobramento_com_emissao_no_mesmo_ano(self):
        # Cosan, 2021: desdobramento 1:4 e incorporação da controladora (contagem ×4,9)
        anos = [2020, 2021, 2022]
        s = {"acoes": [382.5e6, 1868.6e6, 1866.6e6], "acoes_estimadas": [False] * 3}
        ev = P.eventos_confirmados(anos, s, [{"data": "2021-03-01", "tipo": "desdobramento", "fator": 4.0}])
        self.assertEqual([(x["ano"], x["fator"]) for x in ev], [(2021, 4.0)])

    def test_grupamento_com_a_contagem_parada_fica_de_fora(self):
        # não é "grupamento 2:1 mais emissão de 100%": a contagem não mostra o evento
        anos = [2022, 2023, 2024]
        s = {"acoes": [500e6, 500e6, 501e6], "acoes_estimadas": [False] * 3}
        self.assertEqual(P.eventos_confirmados(anos, s, [{"data": "2023-06-01", "tipo": "grupamento", "fator": 0.5}]), [])

    def test_grupamento_com_aumento_de_capital_grande(self):
        # Americanas, 2024: grupamento 100:1 e aumento de capital de 22×; a contagem caiu 4,5×
        anos = [2023, 2024, 2025]
        s = {"acoes": [902.5e6, 200.2e6, 200.2e6], "acoes_estimadas": [False] * 3}
        ev = P.eventos_confirmados(anos, s, [{"data": "2024-06-20", "tipo": "grupamento", "fator": 0.01}])
        self.assertEqual([(x["ano"], x["fator"]) for x in ev], [(2024, 0.01)])

    def test_evento_do_comeco_do_ano_ja_na_dfp_anterior(self):
        # IRB: grupamento 30:1 em fevereiro de 2023, já na composição do capital da DFP de 2022
        anos = [2021, 2022, 2023]
        s = {"acoes": [1255.3e6, 81.8e6, 81.8e6], "acoes_estimadas": [False] * 3}
        ev = P.eventos_confirmados(anos, s, [{"data": "2023-02-10", "tipo": "grupamento", "fator": 1 / 30}])
        self.assertEqual((ev[0]["ano"], ev[0]["ano_preco"]), (2022, 2023))

    def test_dois_eventos_no_mesmo_ano(self):
        anos = [2023, 2024]
        s = {"acoes": [100e6, 220e6], "acoes_estimadas": [False] * 2}
        ev = P.eventos_confirmados(anos, s, [{"data": "2024-03-01", "tipo": "desdobramento", "fator": 2.0},
                                             {"data": "2024-09-01", "tipo": "bonificacao", "fator": 1.1}])
        self.assertEqual(len(ev), 2)


def serie_ev(acoes, estimadas=None, lpa=None, lucro=None, seguinte=None):
    s = serie(acoes, lpa, lucro)
    if estimadas:
        s["acoes_estimadas"] = list(estimadas)
    if seguinte:
        s["_lpa_seguinte"] = list(seguinte)
    return s


def tipos(ev):
    return [(x["tipo"], x.get("fator"), x["ano"], x.get("ano_preco")) for x in ev]


class EventosInferidos(unittest.TestCase):
    """Desdobramento, grupamento e troca de base que a ficha da B3 não lista (eventos_da_empresa)."""

    def test_vivo_desdobramento_que_a_b3_nao_lista(self):
        anos = [2023, 2024, 2025]
        s = serie_ev([1652.6e6, 1626.7e6, 3195.6e6])
        ev = P.eventos_da_empresa(anos, s, {"VIVT3": [53.44, 47.16, 33.10]}, [])
        self.assertEqual(tipos(ev), [("ajuste", 2.0, 2025, 2025)])
        self.assertEqual(ev[0]["origem"], "contagem")

    def test_csn_mineracao_troca_de_base_antes_da_abertura(self):
        anos = [2020, 2021, 2022]
        s = serie_ev([181.0e6, 5380.4e6, 5485.3e6])
        ev = P.eventos_da_empresa(anos, s, {"CMIN3": [None, 6.74, 4.08]}, [])
        self.assertEqual(tipos(ev), [("ajuste", 30.0, 2021, 2021)])

    def test_gps_quebra_de_base_na_abertura(self):
        anos = [2020, 2021, 2022]
        s = serie_ev([6.33e6, 739.2e6, 741.6e6])
        ev = P.eventos_da_empresa(anos, s, {"GGPS3": [None, 14.33, 10.76]}, [])
        self.assertEqual(tipos(ev), [("base", None, 2021, None)])

    def test_casas_bahia_emissao_com_cotacao_fica(self):
        # conversão de dívida em 2025: 6,9× mais ações, cotação de pé; diluição de verdade
        anos = [2024, 2025]
        s = serie_ev([95.1e6, 653.9e6])
        self.assertEqual(P.eventos_da_empresa(anos, s, {"BHIA3": [2.83, 3.15]}, []), [])

    def test_tegma_contagem_atrasada_e_cotacao_em_outro_ano(self):
        # grupamento 4:1 que a cotação mostra em 2023 e a composição do capital só em 2025
        anos = [2022, 2023, 2024, 2025]
        s = serie_ev([173.5e6, 173.5e6, 173.5e6, 43.4e6])
        ev = P.eventos_da_empresa(anos, s, {"TPIS3": [0.90, 4.20, 5.15, 5.37]}, [])
        self.assertEqual(tipos(ev), [("ajuste", 0.25, 2025, 2023)])

    def test_copel_desdobramento_na_emenda_com_ano_estimado(self):
        # estimativa pelo LPA 4,5% fora (ON e PN com direitos diferentes); desdobramento de
        # 2021 já na DFP de 2020, cotação na base nova só no fim de 2021
        anos = [2019, 2020, 2021]
        s = serie_ev([286.6e6, 2736.6e6, 2736.6e6], estimadas=[True, False, False])
        ev = P.eventos_da_empresa(anos, s, {"CPLE3": [69.10, 68.74, 6.12]}, [])
        self.assertEqual(tipos(ev), [("ajuste", 10.0, 2020, 2021)])

    def test_vale_erro_de_estimativa_nao_mexe_na_cotacao(self):
        anos = [2009, 2010, 2011]
        s = serie_ev([10656.6e6, 5312.7e6, 5273.9e6], estimadas=[True, True, True])
        ev = P.eventos_da_empresa(anos, s, {"VALE3": [49.50, 55.33, 39.45]}, [])
        self.assertEqual(tipos(ev), [("ajuste", 0.5, 2010, None)])

    def test_magalu_desdobramento_e_emissao_confirmados_pela_cotacao(self):
        anos = [2018, 2019]
        s = serie_ev([188.9e6, 1620.1e6], estimadas=[True, True])
        ev = P.eventos_da_empresa(anos, s, {"MGLU3": [181.07, 47.70]}, [])
        self.assertEqual(tipos(ev), [("ajuste", 8.0, 2019, 2019)])

    def test_salto_sem_fator_e_sem_cotacao_que_confirme_fica(self):
        # Gafisa, 2022: 6,6× menos ações (grupamento e emissão); fator nenhum a 8%
        anos = [2021, 2022]
        s = serie_ev([337.1e6, 51.1e6])
        self.assertEqual(P.eventos_da_empresa(anos, s, {"GFSA3": [2.01, 9.90]}, []), [])

    def test_ano_com_evento_da_b3_nao_e_inferido(self):
        # o que sobra do grupamento da Americanas (22×) é emissão, não desdobramento
        anos = [2023, 2024]
        s = serie_ev([902.5e6, 200.2e6])
        ev = P.eventos_da_empresa(anos, s, {"AMER3": [0.91, 5.15]},
                                  [{"data": "2024-06-20", "tipo": "grupamento", "fator": 0.01}])
        self.assertEqual([x["tipo"] for x in ev], ["grupamento"])

    def test_lpa_reapresentado_igual_veta(self):
        # emissão que dobra a quantidade; a DFP seguinte repete o LPA igual
        anos = [2022, 2023]
        s = serie_ev([1000e6, 2000e6], lpa=[1.50, 0.80], seguinte=[1.50, None])
        self.assertEqual(P.eventos_da_empresa(anos, s, {"XPTO3": [10.0, 5.0]}, []), [])

    def test_lpa_reapresentado_da_o_fator_exato(self):
        # contagem ×4,886 (1:4 com emissão): sem o LPA, a inferência diria 1:5
        anos = [2020, 2021]
        s = serie_ev([382.5e6, 1868.6e6], lpa=[2.20, 3.30], seguinte=[0.55, None])
        ev = P.eventos_da_empresa(anos, s, {"CSAN3": [77.00, 21.69]}, [])
        self.assertEqual(tipos(ev), [("desdobramento", 4.0, 2021, 2021)])
        self.assertEqual(ev[0]["origem"], "lpa")

    def test_quebras_anteriores_e_ajustes_sem_cotacao_saem(self):
        # antes de abrir capital: quebra em 2011 (37×), 2:1 em 2012 e quebra em 2013 (35×); só a
        # última quebra conta, e o 2:1 sem cotação não muda mais nada
        anos = [2010, 2011, 2012, 2013]
        s = serie_ev([1e6, 37e6, 18.5e6, 650e6], estimadas=[True, True, True, False])
        ev = P.eventos_da_empresa(anos, s, {}, [])
        self.assertEqual(tipos(ev), [("base", None, 2013, None)])

    def test_valor_de_mercado_com_contagem_e_cotacao_na_mesma_base(self):
        # IRB 2022: ações já grupadas (DFP entregue depois do grupamento), cotação ainda não
        anos = [2021, 2022, 2023]
        s = {"valor_mercado": [5_046_000, 70_348, 3_623_740]}
        P.ajustar_valor_mercado(anos, s, [{"tipo": "grupamento", "fator": 1 / 30, "ano": 2022, "ano_preco": 2023}])
        self.assertEqual(s["valor_mercado"], [5_046_000, 2_110_440, 3_623_740])


class EstimativasPeloLpa(unittest.TestCase):
    def test_escala_do_ano_seguinte(self):
        # LPA por lote de mil num ano: a estimativa sai mil vezes menor que a do ano seguinte
        s = {"acoes": [159_700, 158_500_000, 141_000_000], "acoes_estimadas": [True, True, False]}
        P.ancorar_estimativas(s)
        self.assertEqual(s["acoes"][0], 159_700_000)

    def test_magalu_desdobramentos_seguidos_nao_sao_escala(self):
        # 1:8, 1:8 e 1:4 em poucos anos: 300× entre 2016 e 2020, mas nenhum salto de 300× num ano
        s = {"acoes": [21_800_000, 176_600_000, 1_620_100_000, 6_463_400_000],
             "acoes_estimadas": [True, True, True, False]}
        P.ancorar_estimativas(s)
        self.assertEqual(s["acoes"][0], 21_800_000)

    def test_portobello_ano_isolado_sai(self):
        anos = [2018, 2019, 2020]
        s = {"acoes": [158.5e6, 16.0e6, 154.5e6], "acoes_estimadas": [True, True, False]}
        P.descartar_estimativas_isoladas(anos, s)
        self.assertEqual(s["acoes"], [158.5e6, None, 154.5e6])
        self.assertEqual(s["acoes_estimadas"], [True, False, False])

    def test_petrorio_ano_isolado_corrigido_pelo_lpa(self):
        anos = [2021, 2022, 2023]
        s = serie([839e6, 491e6, 835e6], lpa=[None, 4.0, None], lucro=[None, 3_375_000, None])
        s["acoes_corrigidas"] = []
        P.corrigir_ano_pelo_lpa(anos, s)
        self.assertEqual(s["acoes"][1], 843_750_000)
        self.assertEqual(s["acoes_corrigidas"], [2022])


def zip_dfp_ano(ano, linhas):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr(f"dfp_cia_aberta_DRE_con_{ano}.csv", "\r\n".join([CAB_DRE] + linhas).encode("latin-1"))
    buf.seek(0)
    return zipfile.ZipFile(buf)


def linha_lpa(ano_doc, ordem, ano, valor):
    return (f"X;{ano_doc}-12-31;1;EMPRESA;000001;DF;REAL;MIL;{ordem};{ano}-01-01;{ano}-12-31;"
            f"3.99.01.01;ON;{valor};S")


class LpaReapresentado(unittest.TestCase):
    def test_guarda_o_lpa_do_ano_anterior_na_dfp_seguinte(self):
        base = {}
        P.extrair_ano(zip_dfp_ano(2023, [linha_lpa(2023, "ÚLTIMO", 2023, "1.00000000")]), 2023, {"X"}, base)
        P.extrair_ano(zip_dfp_ano(2024, [linha_lpa(2024, "ÚLTIMO", 2024, "0.30000000"),
                                         linha_lpa(2024, "PENÚLTIMO", 2023, "0.25000000")]), 2024, {"X"}, base)
        self.assertEqual(base["X"][2023]["lpa_on"], 1.0)              # o do próprio ano prevalece
        self.assertEqual(base["X"][2023]["_lpa_on_seguinte"], 0.25)   # o reapresentado fica à parte
        self.assertNotIn("_lpa_on_seguinte", base["X"][2024])


class UltimoPregaoDoAno(unittest.TestCase):
    """Caso real: a B3 respondeu 404 a COTAHIST_D30122024 no CI, a marca .404 ficou e a base guardou o
    fechamento de 27/12/2024 como o do ano (ABCB4 R$ 20,75 em vez de R$ 19,31; o mesmo em 2020).
    Achado pelo cruzamento preço de fim de exercício × histórico diário (scripts/qualidade.py)."""

    def test_marca_de_404_nao_barra_o_ultimo_pregao(self):
        with tempfile.TemporaryDirectory() as tmp, mock.patch.object(P, "FONTES", Path(tmp)):
            marca = Path(tmp) / "cotahist" / "COTAHIST_D30122024.404"
            marca.parent.mkdir(parents=True)
            marca.touch()
            pedidos = []

            def baixar(url, destino):
                pedidos.append(url)
                destino.write_bytes(b"zip")
                return destino

            with mock.patch.object(P, "baixar", baixar):
                self.assertIsNone(P.baixar_dia(date(2024, 12, 30)))               # uso comum: a marca vale
                self.assertEqual(pedidos, [])
                self.assertTrue(P.baixar_dia(date(2024, 12, 30), insistir=True))  # fim de ano: pede de novo
                self.assertEqual(len(pedidos), 1)


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
