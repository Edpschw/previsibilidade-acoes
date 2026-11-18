"""Compara a base nova (data/empresas.js) com a anterior e escreve mudancas.md.

A anterior é, por padrão, a versão commitada no git (HEAD); sem git, a cópia que
scripts/processar.py guarda em scripts/sources/empresas_anterior.js.

    python3 scripts/mudancas.py                 # escreve mudancas.md e imprime o resumo
    python3 scripts/mudancas.py --anterior X.js

Sai com código 0 sempre. A primeira linha de mudancas.md diz se há algo relevante
("Nada relevante" ou "N mudanças relevantes"), o que o GitHub Actions usa para abrir um aviso.
"""

import json
import subprocess
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
ATUAL = RAIZ / "data" / "empresas.js"
COPIA = RAIZ / "scripts" / "sources" / "empresas_anterior.js"
SAIDA = RAIZ / "mudancas.md"

LIMIAR_PRECO = 0.15      # variação de cotação entre execuções
LIMIAR_INDICE = 5        # pontos no índice de previsibilidade


def ler(texto):
    return json.loads(texto.split("=", 1)[1].rstrip().rstrip(";"))


def anterior():
    if "--anterior" in sys.argv:
        return ler(Path(sys.argv[sys.argv.index("--anterior") + 1]).read_text(encoding="utf-8"))
    try:
        texto = subprocess.run(["git", "show", "HEAD:data/empresas.js"], cwd=RAIZ, capture_output=True,
                               text=True, check=True).stdout
        return ler(texto)
    except (subprocess.CalledProcessError, FileNotFoundError, ValueError):
        return ler(COPIA.read_text(encoding="utf-8")) if COPIA.exists() else None


def comparar(a, b):
    """a = anterior, b = nova. Devolve {seção: [linhas]}."""
    A = {e["cnpj"]: e for e in a["empresas"]}
    B = {e["cnpj"]: e for e in b["empresas"]}
    s = {k: [] for k in ("Entraram na base", "Saíram da base", "Tickers novos ou removidos",
                         "Balanço novo", "Últimos 12 meses atualizados", "Cotação mudou mais de 15%",
                         "Índice de previsibilidade mudou")}
    for c in sorted(set(B) - set(A), key=lambda c: B[c]["ticker"]):
        s["Entraram na base"].append(f"{B[c]['ticker']} — {B[c]['nome']}")
    for c in sorted(set(A) - set(B), key=lambda c: A[c]["ticker"]):
        s["Saíram da base"].append(f"{A[c]['ticker']} — {A[c]['nome']}")
    for c in sorted(set(A) & set(B), key=lambda c: B[c]["ticker"]):
        ea, eb = A[c], B[c]
        novos, fora = set(eb["tickers"]) - set(ea["tickers"]), set(ea["tickers"]) - set(eb["tickers"])
        if novos or fora:
            s["Tickers novos ou removidos"].append(
                f"{eb['ticker']}: " + ", ".join([f"+{t}" for t in sorted(novos)] + [f"−{t}" for t in sorted(fora)]))
        if eb["anos"][-1] > ea["anos"][-1]:
            s["Balanço novo"].append(f"{eb['ticker']}: DFP de {eb['anos'][-1]}")
        ta, tb = (ea.get("ttm") or {}).get("ate"), (eb.get("ttm") or {}).get("ate")
        if tb and tb != ta:
            s["Últimos 12 meses atualizados"].append(f"{eb['ticker']}: ITR até {tb}")
        pa = (ea["cotacao"].get(ea["ticker"]) or {}).get("preco")
        pb = (eb["cotacao"].get(ea["ticker"]) or {}).get("preco")
        avancou = (b.get("cotacoes_em") or "") > (a.get("cotacoes_em") or "")
        if avancou and pa and pb and abs(pb / pa - 1) > LIMIAR_PRECO:
            s["Cotação mudou mais de 15%"].append(f"{ea['ticker']}: R$ {pa:.2f} → R$ {pb:.2f} ({pb / pa - 1:+.0%})")
        ia, ib = (ea["score"]["brl"] or {}).get("total"), (eb["score"]["brl"] or {}).get("total")
        if ia is not None and ib is not None and abs(ib - ia) >= LIMIAR_INDICE:
            s["Índice de previsibilidade mudou"].append(f"{eb['ticker']}: {ia} → {ib}")
    return s


def main():
    b = ler(ATUAL.read_text(encoding="utf-8"))
    a = anterior()
    if a is None:
        SAIDA.write_text("Nada relevante: sem base anterior para comparar.\n", encoding="utf-8")
        print("sem base anterior")
        return
    s = comparar(a, b)
    total = sum(len(v) for v in s.values())
    linhas = [f"{total} mudanças relevantes" if total else "Nada relevante", "",
              f"Base de {a['gerado_em']} → {b['gerado_em']} · cotações {a.get('cotacoes_em')} → {b.get('cotacoes_em')}", ""]
    for titulo, itens in s.items():
        if itens:
            linhas += [f"## {titulo} ({len(itens)})", ""] + [f"- {i}" for i in itens[:60]]
            if len(itens) > 60:
                linhas.append(f"- … e mais {len(itens) - 60}")
            linhas.append("")
    SAIDA.write_text("\n".join(linhas), encoding="utf-8")
    print(linhas[0] + " → mudancas.md")


if __name__ == "__main__":
    main()
