"""Base em PostgreSQL (scripts/carregar_base.py): a base remontada do Postgres tem de ser igual ao
JSON, campo a campo, e o histórico tem de guardar cada carga.

Precisam de um Postgres descartável em DATABASE_URL_TESTE; sem ele, são pulados. Cada teste usa
um schema próprio, apagado no fim.

    DATABASE_URL_TESTE=postgresql://usuario:senha@localhost/banco python3 -m unittest tests.test_base
"""

import copy
import os
import sys
import unittest
import uuid
from pathlib import Path
from unittest import mock

RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ / "scripts"))

URL = os.environ.get("DATABASE_URL_TESTE")
try:
    import psycopg
    import carregar_base as cb
except ImportError:  # psycopg não instalado: pip install -r requirements.txt
    psycopg = None


@unittest.skipUnless(psycopg and URL and (RAIZ / "data" / "empresas.js").exists(),
                     "defina DATABASE_URL_TESTE (Postgres descartável) e instale requirements.txt")
class BasePostgres(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.dados = cb.ler_json()

    def setUp(self):
        self.conn = psycopg.connect(URL)
        self.schema = "teste_" + uuid.uuid4().hex[:10]
        with self.conn.cursor() as cur:
            cur.execute(f"create schema {self.schema}")
            cur.execute(f"set search_path to {self.schema}")
        self.conn.commit()

    def tearDown(self):
        self.conn.rollback()
        with self.conn.cursor() as cur:
            cur.execute(f"drop schema {self.schema} cascade")
        self.conn.commit()
        self.conn.close()

    def amostra(self, n=40):
        """Recorte da base real (as n primeiras empresas), para os testes de histórico rodarem rápido."""
        d = copy.deepcopy(self.dados)
        d["empresas"] = d["empresas"][:n]
        return d

    def exportar(self, carga):
        with self.conn.cursor() as cur:
            return cb.exportar(cur, carga)

    def contar(self, sql):
        with self.conn.cursor() as cur:
            cur.execute(sql)
            return cur.fetchone()[0]

    # ------------------------------------------------------------------

    def test_base_inteira_volta_igual_ao_json(self):
        carga, resumo = cb.publicar(self.conn, self.dados)
        self.assertEqual(resumo["empresas"], len(self.dados["empresas"]))
        self.assertEqual(cb.comparar(self.dados, self.exportar(carga)), [])

    def test_empresa_que_sai_do_json_e_apagada_com_o_historico(self):
        d = self.amostra(10)
        cb.publicar(self.conn, d)
        saiu = d["empresas"][-1]
        menor = copy.deepcopy(d)
        menor["empresas"] = d["empresas"][:-1]
        carga, resumo = cb.publicar(self.conn, menor)
        self.assertEqual(resumo["expurgadas"], 1)
        self.assertEqual(self.contar(f"select count(*) from empresa where cd_cvm = '{saiu['cd_cvm']}'"), 0)
        self.assertEqual(self.contar("select count(*) from empresa"), 9)
        for t in cb.POR_EMPRESA:
            self.assertEqual(self.contar(f"select count(*) from {t} where empresa_id not in (select id from empresa)"), 0, t)
        self.assertEqual(cb.comparar(menor, self.exportar(carga)), [])

    def test_mesma_base_de_novo_nao_duplica_linhas(self):
        d = self.amostra()
        cb.publicar(self.conn, d)
        linhas = self.contar("select count(*) from fundamento_anual")
        carga, resumo = cb.publicar(self.conn, d)
        self.assertEqual(self.contar("select count(*) from fundamento_anual"), linhas)
        for tabela in ("cadastro", "listagem", "fundamento_anual", "fundamento_12m", "ajuste", "preco_fim_exercicio", "ptax_anual"):
            self.assertEqual(resumo[tabela], {"novas": 0, "encerradas": 0}, tabela)
        self.assertEqual(cb.comparar(d, self.exportar(carga)), [])

    def test_reapresentacao_guarda_o_valor_anterior(self):
        """Receita reapresentada, empresa que sai, ticker novo e 12 meses que andam: cada carga
        continua remontável do jeito que foi publicada."""
        d1 = self.amostra()
        c1, _ = cb.publicar(self.conn, d1)

        d2 = copy.deepcopy(d1)
        e = d2["empresas"][0]
        e["series"]["receita"][-1] += 1000          # reapresentou a receita do último exercício
        saiu = d2["empresas"].pop()                  # deslistada
        e["tickers"] = e["tickers"] + ["ZZZZ3"]      # ticker novo
        if e["ttm"]:
            e["ttm"]["ate"] = "2026-12-31"
        d2["gerado_em"] = "2026-11-19 00:05"
        c2, resumo = cb.publicar(self.conn, d2)

        self.assertEqual(cb.comparar(d1, self.exportar(c1)), [])
        self.assertEqual(cb.comparar(d2, self.exportar(c2)), [])
        # a receita tem duas versões: a de c1 (encerrada em c2) e a de c2 (vigente)
        cd = e["cd_cvm"]
        versoes = self.contar(f"""select count(*) from fundamento_anual f join empresa x on x.id = f.empresa_id
                                  where x.cd_cvm = '{cd}' and f.metrica = 'receita' and f.exercicio = {e['anos'][-1]}""")
        self.assertEqual(versoes, 2)
        # a empresa que saiu continua na base, com o cadastro encerrado
        self.assertEqual(self.contar(f"""select count(*) from cadastro c join empresa x on x.id = c.empresa_id
                                         where x.cd_cvm = '{saiu['cd_cvm']}' and c.carga_ate = {c2}"""), 1)
        self.assertGreater(resumo["fundamento_anual"]["encerradas"], 0)

    def test_divergencia_desfaz_a_carga_inteira(self):
        d = self.amostra(5)
        original = cb.exportar

        def exportar_errado(cur, carga):
            x = original(cur, carga)
            x["empresas"][0]["series"]["receita"][0] += 1
            return x

        with mock.patch.object(cb, "exportar", exportar_errado):
            with self.assertRaises(cb.Divergencia):
                cb.publicar(self.conn, d)
        with self.conn.cursor() as cur:
            cur.execute("select to_regclass('carga')")
            self.assertIsNone(cur.fetchone()[0], "nem o esquema deveria ter ficado")

    def test_campo_novo_no_json_falha_antes_de_gravar(self):
        d = self.amostra(3)
        for e in d["empresas"]:
            e["series"]["margem_nova"] = [None] * len(e["anos"])
        with self.assertRaises(ValueError):
            cb.publicar(self.conn, d)

    def test_valores_monetarios_em_reais(self):
        d = self.amostra(1)
        cb.publicar(self.conn, d)
        e = d["empresas"][0]
        v = self.contar(f"""select valor from fundamento_anual f join empresa x on x.id = f.empresa_id
                            where x.cd_cvm = '{e['cd_cvm']}' and metrica = 'receita' and exercicio = {e['anos'][-1]}""")
        self.assertEqual(v, e["series"]["receita"][-1] * 1000)


if __name__ == "__main__":
    unittest.main()
