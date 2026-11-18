"""Atualiza o ?v= de cada asset referenciado no index.html com um hash do conteúdo do arquivo.

Assim quem já visitou o site recebe a versão nova sem ninguém lembrar de subir o número.
Roda sozinho no fim de scripts/processar.py; à mão, depois de editar app.js ou style.css:

    python3 scripts/versionar.py
"""

import hashlib
import re
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
PAGINAS = ["index.html"]
REF = re.compile(r'((?:src|href)=")([^"?#]+\.(?:js|css))(?:\?v=[^"]*)?(")')


def hash_arquivo(caminho: Path) -> str:
    return hashlib.sha1(caminho.read_bytes()).hexdigest()[:10]


def versionar() -> list:
    mudancas = []
    for nome in PAGINAS:
        pagina = RAIZ / nome
        texto = pagina.read_text(encoding="utf-8")

        def trocar(m):
            asset = RAIZ / m.group(2)
            if not asset.exists():
                return m.group(0)
            novo = f"{m.group(1)}{m.group(2)}?v={hash_arquivo(asset)}{m.group(3)}"
            if novo != m.group(0):
                mudancas.append(m.group(2))
            return novo

        novo_texto = REF.sub(trocar, texto)
        if novo_texto != texto:
            pagina.write_text(novo_texto, encoding="utf-8")
    return mudancas


if __name__ == "__main__":
    m = versionar()
    print("versões atualizadas: " + (", ".join(m) if m else "nenhuma"))
