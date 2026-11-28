"""Contas da aba Gráficos (graficos.js): roda tests/graficos_contas.js no Node, com histórico sintético
(ajuste por desdobramento e grupamento, retorno total com provento reinvestido, série semanal, eixo comum
entre empresas, base 100, conversão pela PTAX do dia e anos dos indicadores anuais).

    python3 -m unittest tests.test_graficos     # pulado se o Node não estiver instalado
"""

import shutil
import subprocess
import unittest
from pathlib import Path

ARQUIVO = Path(__file__).resolve().parent / "graficos_contas.js"


@unittest.skipUnless(shutil.which("node"), "Node não instalado")
class ContasDosGraficos(unittest.TestCase):
    def test_contas(self):
        r = subprocess.run(["node", str(ARQUIVO)], capture_output=True, text=True, timeout=60)
        self.assertEqual(r.returncode, 0, r.stderr or r.stdout)
        self.assertIn("ok", r.stdout)


if __name__ == "__main__":
    unittest.main()
