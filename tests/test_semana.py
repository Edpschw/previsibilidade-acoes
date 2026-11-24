"""Resumo semanal (scripts/resumo_semanal.py): regras com dados sintéticos e invariantes das edições publicadas.

    python3 -m unittest tests.test_semana -v
"""

import json
import re
import sys
import unittest
import xml.etree.ElementTree as ET
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
import resumo_semanal as S  # noqa: E402

CONTEUDO = "{http://purl.org/rss/1.0/modules/content/}encoded"
AGORA = datetime(2026, 11, 20, 20, 30, tzinfo=timezone(timedelta(hours=-3)))
SEXTA = date(2026, 11, 20)


def hist(pontos, ev=()):
    """série compacta no formato do scripts/historico.py a partir de [(AAAA-MM-DD, preço)]"""
    ds = [date.fromisoformat(d) for d, _ in pontos]
    ints = [round(p * 100) for _, p in pontos]
    return {"d0": ds[0].isoformat(), "dd": [(b - a).days for a, b in zip(ds, ds[1:])], "esc": 100, "p0": ints[0],
            "dp": [b - a for a, b in zip(ints, ints[1:])], "ev": [list(e) for e in ev], "pv": []}


def empresa(cnpj, tk, preco, nome="Empresa Teste S.A.", ttm=None, ano=2025, rec=100.0, ll=10.0, indice=60, outros=()):
    cot = {tk: {"preco": preco, "data": "2026-11-19"}}
    cot.update({t: {"preco": preco * 1.02, "data": "2026-11-19"} for t in outros})
    return {"cnpj": cnpj, "ticker": tk, "tickers": [tk, *outros], "nome": nome, "cotacao": cot,
            "anos": [ano - 1, ano], "series": {"receita": [rec * 0.9, rec], "lucro_liquido": [ll * 0.9, ll]},
            "ttm": ttm, "score": {"brl": {"total": indice}}}


def base(empresas):
    return {"gerado_em": "2026-11-20 23:30", "cotacoes_em": "2026-11-19", "ptax_atual": {"data": "2026-11-19", "valor": 5.0},
            "empresas": empresas}


# PTAX: 5,50 na sexta anterior, 5,00 na quinta desta semana → o real subiu 10%
INDICES = {"ptax": {"d0": "2026-11-13", "dd": [3, 1, 1, 1], "v": [5.5, 5.4, 5.3, 5.2, 5.0]}}
HIST = {"AAA3": hist([("2026-11-13", 10.0), ("2026-11-19", 11.0)]),     # +10% em reais
        "BBB3": hist([("2026-11-13", 20.0), ("2026-11-19", 18.0)])}     # −10% em reais
AULAS = [("LEARN", "From the basics"), ("COMPANY", "What is a company?"), ("SHARE", "What is a share?")]


class Datas(unittest.TestCase):
    def test_sexta_da_semana(self):
        self.assertEqual(S.sexta(date(2026, 11, 20)), SEXTA)               # a própria sexta
        self.assertEqual(S.sexta(date(2026, 11, 23)), SEXTA)               # segunda: a sexta anterior
        self.assertEqual(S.sexta(date(2026, 11, 19)), date(2026, 11, 13))  # quinta: a da semana passada

    def test_sai_uma_vez_com_o_pregao_de_sexta(self):
        sexta, quinta = date(2026, 11, 20), "2026-11-19"
        # a execução das 20h17 de quinta roda na madrugada de sexta (atraso do GitHub): sem o pregão de sexta, espera
        self.assertFalse(S.deve_gerar(sexta, existe=False, cotacoes_em=quinta))
        self.assertTrue(S.deve_gerar(sexta, existe=False, cotacoes_em="2026-11-20"))
        self.assertTrue(S.deve_gerar(date(2026, 11, 21), existe=False, cotacoes_em=quinta))   # sábado: feriado na sexta
        self.assertTrue(S.deve_gerar(date(2026, 11, 24), existe=False, cotacoes_em=quinta))   # terça: última chance
        self.assertFalse(S.deve_gerar(date(2026, 11, 25), existe=False, cotacoes_em=quinta))  # quarta: não sai atrasada
        self.assertFalse(S.deve_gerar(date(2026, 11, 21), existe=True, cotacoes_em=quinta))

    def test_intervalo_da_semana(self):
        self.assertEqual(S.intervalo(date(2026, 11, 16), SEXTA), "November 16–20, 2026")
        self.assertEqual(S.intervalo(date(2026, 11, 30), date(2026, 12, 4)), "November 30 – December 4, 2026")
        self.assertEqual(S.intervalo(date(2026, 12, 28), date(2027, 1, 1)), "December 28, 2026 – January 1, 2027")


class Variacao(unittest.TestCase):
    def test_desdobramento_no_meio_da_semana(self):
        # 2 por 1 a partir de 18/11: o preço cai à metade, mas quem tinha uma ação passa a ter duas
        h = hist([("2026-11-13", 40.0), ("2026-11-16", 41.0), ("2026-11-18", 20.6), ("2026-11-19", 21.0)],
                 ev=[("2026-11-18", 2.0, "desdobramento", "b3")])
        v = S.variacao(h, date(2026, 11, 13), SEXTA, date(2026, 11, 16))
        self.assertAlmostEqual(v["var"], 21.0 * 2 / 40.0 - 1)

    def test_evento_fora_da_semana_nao_conta(self):
        h = hist([("2026-11-06", 80.0), ("2026-11-13", 40.0), ("2026-11-19", 42.0)], ev=[("2026-11-10", 2.0, "desdobramento", "b3")])
        self.assertAlmostEqual(S.variacao(h, date(2026, 11, 13), SEXTA, date(2026, 11, 16))["var"], 0.05)

    def test_papel_sem_pregao_na_semana_fica_de_fora(self):
        h = hist([("2026-11-10", 10.0), ("2026-11-13", 11.0)])
        self.assertIsNone(S.variacao(h, date(2026, 11, 13), SEXTA, date(2026, 11, 16)))


class Extremos(unittest.TestCase):
    def test_melhores_e_piores_do_melhor_para_o_pior(self):
        itens = [{"v": v} for v in [3, -8, 12, 0, 5, -1, 7, -4, 9, 2, -6, 1]]
        topo, fim = S.extremos(itens, lambda x: x["v"], 3)
        self.assertEqual([x["v"] for x in topo], [12, 9, 7])
        self.assertEqual([x["v"] for x in fim], [-4, -6, -8])

    def test_poucos_itens_viram_uma_lista_so(self):
        topo, fim = S.extremos([{"v": 1}, {"v": 3}], lambda x: x["v"], 3)
        self.assertEqual([x["v"] for x in topo], [3, 1])
        self.assertEqual(fim, [])


class Edicao(unittest.TestCase):
    """uma semana inteira com dados sintéticos: câmbio, movimentos, proventos, mudanças e aula"""

    @classmethod
    def setUpClass(cls):
        antes = base([empresa("c1", "AAA3", 10.0, ttm={"ate": "2026-06-30", "receita": 100.0, "lucro_liquido": 10.0}),
                      empresa("c2", "BBB3", 20.0, indice=60),
                      empresa("c3", "CCC3", 5.0, nome="Saiu da Base S.A.", indice=40)])
        agenda_antes = {"c2": [{"t": "BBB3", "tipo": "jcp", "valor": 0.4, "com": "2026-10-01", "pag": "2026-11-25"},
                               {"t": "BBB4", "tipo": "jcp", "valor": 0.44, "com": "2026-10-01", "pag": "2026-11-25"}]}
        cls.anterior = S.retrato(antes, agenda_antes, date(2026, 11, 13))
        cls.d = base([empresa("c1", "AAA3", 11.0, ttm={"ate": "2026-09-30", "receita": 110.0, "lucro_liquido": 12.0}),
                      empresa("c2", "BBB3", 18.0, indice=50, outros=("BBB4",)),
                      empresa("c4", "DDD3", 7.0, nome="Entrou na Base S.A.", indice=70)])
        cls.agenda = {
            "c1": [{"t": "AAA3", "tipo": "dividendo", "valor": 0.5, "com": "2026-11-24", "pag": "2026-12-10"}],
            "c2": [{"t": "BBB3", "tipo": "jcp", "valor": 0.4, "com": "2026-10-01", "pag": "2026-11-25"},
                   {"t": "BBB4", "tipo": "jcp", "valor": 0.44, "com": "2026-10-01", "pag": "2026-11-25"},
                   {"t": "BBB3", "tipo": "dividendo", "valor": 2.0, "com": "2026-10-01", "pag": "2026-11-26"}]}
        cls.r, cls.estado = S.montar(cls.d, cls.agenda, INDICES, SEXTA, cls.anterior, numero=3, hist=HIST.get,
                                     lista_aulas=AULAS, agora=AGORA)

    def test_cambio_e_movimentos_em_dolar(self):
        self.assertAlmostEqual(self.r["cambio"]["real"], 0.10)
        mov = {x["t"]: x for x in self.r["movimentos"]["topo"]}
        self.assertAlmostEqual(mov["AAA3"]["brl"], 0.10)
        self.assertAlmostEqual(mov["AAA3"]["usd"], 1.1 * 5.5 / 5.0 - 1)
        self.assertEqual([x["t"] for x in self.r["movimentos"]["topo"]], ["AAA3", "BBB3"])  # do melhor para o pior
        self.assertEqual(self.r["universo"]["sobe"], 1)
        self.assertEqual(self.r["universo"]["desce"], 1)
        self.assertEqual(self.r["pregao"], "2026-11-19")

    def test_proventos_da_semana_seguinte_por_yield(self):
        pv = self.r["proventos"]
        self.assertEqual(pv["semana"], ["2026-11-23", "2026-11-27"])
        self.assertEqual([x["t"] for x in pv["direito"]["itens"]], ["AAA3"])
        # uma linha por empresa, tipo e datas: BBB3 (principal) leva BBB4 ao lado
        pag = pv["pagamentos"]["itens"]
        self.assertEqual([(x["t"], x["tipo"]) for x in pag], [("BBB3", "dividendo"), ("BBB3", "jcp")])
        self.assertEqual(pag[1]["outros"], ["BBB4"])
        self.assertAlmostEqual(pag[0]["yield"], 2.0 / 18.0, places=6)
        self.assertAlmostEqual(pag[0]["usd"], 2.0 / 5.0)

    def test_mudancas_desde_a_edicao_anterior(self):
        m = self.r["mudancas"]
        self.assertEqual(m["desde"], "2026-11-13")
        b = m["balancos"]["topo"]
        self.assertEqual([(x["t"], x["periodo"]) for x in b], [("AAA3", "Q3 2026")])
        self.assertAlmostEqual(b[0]["rec_var"], 0.10)
        self.assertAlmostEqual(b[0]["ll_var"], 0.20)
        self.assertEqual([(x["t"], x["de"], x["para"]) for x in m["indice"]["topo"]], [("BBB3", 60, 50)])
        self.assertEqual([x["t"] for x in m["entraram"]], ["DDD3"])
        self.assertEqual([x["t"] for x in m["sairam"]], ["CCC3"])
        # o JCP da BBB3 e da BBB4 já estava na edição anterior; o dividendo dela e o da AAA3 são novos
        self.assertEqual([(x["t"], x["tipo"]) for x in m["anunciados"]["itens"]], [("BBB3", "dividendo"), ("AAA3", "dividendo")])

    def test_aula_em_ordem_pulando_a_capa(self):
        self.assertEqual(self.r["aula"]["n"], 1)        # edição 3 com 2 aulas: volta para a primeira
        self.assertEqual(self.r["aula"]["palavra"], "COMPANY")

    def test_frase_resume_a_semana(self):
        self.assertTrue(self.r["frase"].startswith("The real rose 10.0% against the dollar"))
        self.assertIn("1 company filed results", self.r["frase"])

    def test_virada_de_sinal_no_lucro(self):
        b = S.balanco({"t": "X", "nome": "X"}, "Q3 2026", (100.0, 90.0), (-5.0, 3.0))
        self.assertIsNone(b["ll_var"])
        self.assertEqual(b["ll_txt"], "back to profit")
        self.assertEqual(S.balanco({"t": "X", "nome": "X"}, "Q3 2026", (1.0, 1.0), (4.0, -2.0))["ll_txt"], "to a loss")

    def test_paginas_e_feed(self):
        r = dict(self.r)
        r["movimentos"] = {"topo": [dict(self.r["movimentos"]["topo"][0], nome="Nome <com> ]]> & sinais")], "fim": []}
        pagina = S.pagina_edicao(r)
        self.assertIn("<h1>Week of November 16–20, 2026</h1>", pagina)
        self.assertIn('href="../../acao/AAA3/"', pagina)
        self.assertNotIn("{raiz}", pagina)
        email = S.html_email(r)
        self.assertNotIn("class=", email)                        # e-mail: só estilo na própria tag
        for href in re.findall(r'href="([^"]+)"', email):         # e-mail: só links absolutos
            self.assertTrue(href.startswith("http"), href)
        canal = ET.fromstring(S.feed([r])).find("channel")
        item = canal.find("item")
        self.assertEqual(item.find("guid").text, item.find("link").text)
        self.assertIn("Nome &lt;com&gt; ]]&gt; &amp; sinais", item.find(CONTEUDO).text)  # escapado: não quebra o XML
        datetime.strptime(item.find("pubDate").text, "%a, %d %b %Y %H:%M:%S %z")


class CursoDaPaginaInicial(unittest.TestCase):
    def test_aulas_lidas_do_inicio_js(self):
        a = S.aulas()
        self.assertGreaterEqual(len(a), 19)                     # capa + 18 aulas
        self.assertEqual(a[1], ("COMPANY", "What is a company?"))
        self.assertTrue(all(p and q for p, q in a))


@unittest.skipUnless((S.SAIDA / "feed.xml").exists(), "sem edições publicadas")
class EdicoesPublicadas(unittest.TestCase):
    def test_edicoes_em_sextas_numeradas_em_ordem(self):
        eds = sorted(S.edicoes(), key=lambda r: r["data"])
        self.assertTrue(eds)
        for k, r in enumerate(eds, 1):
            self.assertEqual(date.fromisoformat(r["data"]).weekday(), 4, r["data"])
            self.assertEqual(r["numero"], k)
            self.assertTrue((S.SAIDA / r["data"] / "index.html").exists())
            self.assertTrue((S.SAIDA / r["data"] / "estado.json").exists())

    def test_listas_do_melhor_para_o_pior(self):
        for r in S.edicoes():
            m = r["movimentos"]["topo"] + r["movimentos"]["fim"]
            chave = [x["usd"] if x["usd"] is not None else x["brl"] for x in m]
            self.assertEqual(chave, sorted(chave, reverse=True), r["data"])
            for lista in (r["proventos"]["direito"], r["proventos"]["pagamentos"]):
                ys = [x["yield"] for x in lista["itens"] if x["yield"] is not None]
                self.assertEqual(ys, sorted(ys, reverse=True), r["data"])

    def test_feed_valido(self):
        canal = ET.parse(S.SAIDA / "feed.xml").getroot().find("channel")
        itens = canal.findall("item")
        self.assertTrue(0 < len(itens) <= S.ITENS_FEED)
        for item in itens:
            self.assertTrue(item.find(CONTEUDO).text.startswith("<div"))


if __name__ == "__main__":
    unittest.main()
