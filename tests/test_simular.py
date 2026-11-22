"""Contas do simulador (simular.js): roda tests/simular_contas.js no Node, com histórico sintético
(desdobramento, JCP com IR, reinvestimento, provento a receber, carteira, IPCA, cenários).

    python3 -m unittest tests.test_simular      # pulado se o Node não estiver instalado
"""

import shutil
import subprocess
import unittest
from pathlib import Path

ARQUIVO = Path(__file__).resolve().parent / "simular_contas.js"


@unittest.skipUnless(shutil.which("node"), "Node não instalado")
class ContasDoSimulador(unittest.TestCase):
    def test_contas(self):
        r = subprocess.run(["node", str(ARQUIVO)], capture_output=True, text=True, timeout=60)
        self.assertEqual(r.returncode, 0, r.stderr or r.stdout)
        self.assertIn("ok", r.stdout)


if __name__ == "__main__":
    unittest.main()
