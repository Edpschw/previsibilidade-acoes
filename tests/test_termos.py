"""Glossário (termos.js): roda tests/termos_ranking.js no Node. Confere a estrutura das entradas e que
todo nome de indicador, trava e indicador futuro do Ranking tem dica, em português e em inglês.

    python3 -m unittest tests.test_termos      # pulado se o Node não estiver instalado
"""

import shutil
import subprocess
import unittest
from pathlib import Path

ARQUIVO = Path(__file__).resolve().parent / "termos_ranking.js"


@unittest.skipUnless(shutil.which("node"), "Node não instalado")
class GlossarioDoRanking(unittest.TestCase):
    def test_glossario(self):
        r = subprocess.run(["node", str(ARQUIVO)], capture_output=True, text=True, timeout=60)
        self.assertEqual(r.returncode, 0, r.stderr or r.stdout)
        self.assertIn("ok", r.stdout)


if __name__ == "__main__":
    unittest.main()
