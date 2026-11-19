"""Gera páginas estáticas indexáveis (SEO) a partir de data/empresas.js.

O site interativo usa rotas com "#" (#/PETR4), que os buscadores não indexam. Este script escreve:

- acao/<TICKER>/index.html  uma página por empresa (ticker principal), em inglês, com título,
                            descrição, Open Graph, dados estruturados (schema.org) e os números
                            principais em HTML puro; o botão leva à página interativa.
- acao/index.html           índice de todas as empresas por setor (porta de entrada para o robô)
- sitemap.xml, robots.txt

Roda depois de scripts/processar.py (o GitHub Actions faz isso todo dia). Endereço público em SITE_URL.

    python3 scripts/gerar_paginas.py
"""

import html
import json
import os
import re
from datetime import date
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
BASE = RAIZ / "data" / "empresas.js"
AGENDA = RAIZ / "data" / "agenda.js"
SAIDA = RAIZ / "acao"
SITE_URL = os.environ.get("SITE_URL", "https://edpschw.github.io/previsibilidade-acoes").rstrip("/")
MARCA = "<!-- gerado por scripts/gerar_paginas.py -->"


def carregar():
    ler = lambda p: json.loads(p.read_text(encoding="utf-8").split("=", 1)[1].rstrip().rstrip(";"))
    d = ler(BASE)
    ag = ler(AGENDA)["empresas"] if AGENDA.exists() else {}
    for e in d["empresas"]:
        e["agenda"] = ag.get(e["cnpj"], [])
    return d


def esc(s):
    return html.escape(str(s if s is not None else ""), quote=True)


# ---------------------------------------------------------------- formatos (inglês)

def num(v, casas=1):
    return f"{v:,.{casas}f}"


def dinheiro(v_mil):
    if v_mil is None:
        return "–"
    v = v_mil * 1000
    for lim, suf in ((1e12, " tn"), (1e9, " bn"), (1e6, " M"), (1e3, " k")):
        if abs(v) >= lim:
            s = v / lim
            return f"R$ {s:,.{0 if abs(s) >= 100 else 1 if abs(s) >= 10 else 2}f}{suf}"
    return f"R$ {v:,.0f}"


def pct(v, casas=1):
    return "–" if v is None else f"{v * 100:.{casas}f}%"


def vezes(v):
    return "–" if v is None else f"{v:.1f}x"


def nome_curto(n):
    n = re.sub(r"\s+(S\.?/?A\.?|S/A|SA)\b.*$", "", n, flags=re.I)
    n = re.sub(r"\s+-\s+em Recupera.*$", "", n, flags=re.I)
    t = re.sub(r"(^|[\s.(/-])([a-zà-ú])", lambda m: m.group(1) + m.group(2).upper(), n.lower())
    return re.sub(r"\b(De|Da|Do|Das|Dos|E)\b", lambda m: m.group(0).lower(), t)


# ---------------------------------------------------------------- indicadores (mesmas regras do app.js)

def ultimo(lst):
    return lst[-1] if lst else None


def indicadores(e):
    s, vm, t = e["series"], e.get("valor_mercado"), e.get("ttm") or {}
    lc = t.get("lucro_controladora", ultimo(s["lucro_controladora"]))
    plc = t.get("pl_controladora", ultimo(s["pl_controladora"]))
    eb = t.get("ebitda", ultimo(s["ebitda"]))
    dl = t.get("divida_liquida", ultimo(s["divida_liquida"]))
    rec = t.get("receita", ultimo(s["receita"]))
    ll = t.get("lucro_liquido", ultimo(s["lucro_liquido"]))
    dvd_fy = ultimo(s["dividendos_pagos"])
    return {
        "pl": vm / lc if vm and lc and lc > 0 else None,
        "pvp": vm / plc if vm and plc and plc > 0 else None,
        "dy": (e["proventos_12m"] / vm if e.get("proventos_12m") is not None and vm
               else (dvd_fy / vm if vm and dvd_fy is not None else None)),
        "roe": lc / plc if lc is not None and plc and plc > 0 else None,
        "mliq": ll / rec if ll is not None and rec and rec > 0 else None,
        "dl_ebitda": dl / eb if not e["financeiro"] and dl is not None and eb and eb > 0 else None,
        "ttm": bool(e.get("ttm")),
    }


def resumo(e):
    """Mesma frase da página interativa (versão em inglês)."""
    s, partes = e["series"], []
    idx = [k for k in range(len(e["anos"])) if s["receita"][k] is not None and s["lucro_liquido"][k] is not None][-10:]
    n = len(idx)
    if n >= 3:
        pos = sum(1 for k in idx if s["lucro_liquido"][k] > 0)
        partes.append(f"profitable in each of the last {n} years" if pos == n else
                      f"loss-making in each of the last {n} years" if pos == 0 else f"profitable in {pos} of the last {n} years")
    if not e["financeiro"]:
        t = e.get("ttm") or {}
        dl = t.get("divida_liquida", ultimo(s["divida_liquida"]))
        eb = t.get("ebitda", ultimo(s["ebitda"]))
        if dl is not None:
            if dl < 0:
                partes.append("net cash (more cash than debt)")
            elif eb is not None and eb <= 0:
                partes.append("net debt with negative EBITDA")
            elif eb:
                x = dl / eb
                partes.append(f"{'low' if x < 1 else 'moderate' if x < 3 else 'high'} debt ({x:.2f}x EBITDA)")
    com = [k for k in idx if s["dividendos_pagos"][k] is not None]
    if len(com) >= 3:
        pagou = sum(1 for k in com if s["dividendos_pagos"][k] > 0)
        partes.append("paid dividends every year" if pagou == len(com) else
                      "paid no dividends in the period" if pagou == 0 else f"paid dividends in {pagou} of {len(com)} years")
    if not partes:
        return ""
    frase = ", ".join(partes[:-1]) + ("; " if len(partes) > 1 else "") + partes[-1]
    return frase[0].upper() + frase[1:] + "."


def nivel(total):
    if total is None:
        return "not enough history", "var(--muted)"
    if total >= 75:
        return "high", "var(--pos)"
    if total >= 50:
        return "medium", "var(--warn)"
    return "low", "var(--neg)"


PAISES = {"Estados Unidos": "United States", "Espanha": "Spain", "Luxemburgo": "Luxembourg"}


def setor(e):
    return (e.get("setor_b3") or {}).get("en") or e["setor"]


# ---------------------------------------------------------------- HTML

def versao(asset):
    m = re.search(re.escape(asset) + r"\?v=([0-9a-f]+)", (RAIZ / "index.html").read_text(encoding="utf-8"))
    return f"{asset}?v={m.group(1)}" if m else asset


def cabeca(titulo, descricao, url, extra=""):
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
{MARCA}
<title>{esc(titulo)}</title>
<meta name="description" content="{esc(descricao)}">
<link rel="canonical" href="{url}">
<meta property="og:site_name" content="Real Terms">
<meta property="og:type" content="website">
<meta property="og:title" content="{esc(titulo)}">
<meta property="og:description" content="{esc(descricao)}">
<meta property="og:url" content="{url}">
<meta property="og:image" content="{SITE_URL}/og.png">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="{{raiz}}favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="{{raiz}}icon-180.png">
<link rel="stylesheet" href="{{raiz}}{versao('style.css')}">
<script>try{{var t=localStorage.getItem("realterms-tema");if(t)document.documentElement.setAttribute("data-theme",t)}}catch(e){{}}</script>
{extra}
</head>
<body>
<header class="topo"><div class="topo-in">
  <a class="marca" href="{{raiz}}" aria-label="Real Terms"><svg viewBox="0 0 32 32" aria-hidden="true"><rect x="4" y="18" width="6" height="10" rx="1.5"/><rect x="13" y="11" width="6" height="17" rx="1.5"/><rect x="22" y="4" width="6" height="24" rx="1.5"/></svg><span class="marca-nome"><b>Real</b> Terms</span></a>
  <nav class="nav-principal" aria-label="Main navigation"><a href="{{raiz}}">Home</a><a href="{{raiz}}acao/">Companies</a><a href="{{raiz}}#/comparar">Compare</a></nav>
</div></header>
<main class="conteudo">
"""


RODAPE = """</main>
<footer class="rodape"><div class="rodape-in">
<p><strong>Sources:</strong> standardized annual (DFP) and quarterly (ITR) statements from the CVM open-data portal, prices and issuer records from B3, and the Central Bank's PTAX exchange rate.</p>
<p>A data tool, not investment advice. Figures are as companies filed them with the CVM and may include restatements or filing errors.</p>
<p class="mudo">Updated {data}.</p>
</div></footer>
</body>
</html>
"""


def pagina_empresa(e, d):
    tk = e["ticker"]
    url = f"{SITE_URL}/acao/{tk}/"
    i, s = indicadores(e), e["series"]
    sc = (e["score"].get("brl") or {}).get("total")
    niv, cor = nivel(sc)
    nome = nome_curto(e["nome"])
    cot = (e["cotacao"].get(tk) or next(iter(e["cotacao"].values()), None)) if e["cotacao"] else None
    frase = resumo(e)
    rot12 = "TTM" if i["ttm"] else str(e["anos"][-1])
    titulo = f"{tk} {nome}: P/E {vezes(i['pl'])}, yield {pct(i['dy'])}, predictability {sc if sc is not None else '–'}/100 · Real Terms"
    descricao = (f"{nome} ({tk}), {setor(e)}. " + (frase + " " if frase else "") +
                 f"Market cap {dinheiro(e.get('valor_mercado'))}, P/E {vezes(i['pl'])}, P/B {vezes(i['pvp'])}, "
                 f"dividend yield {pct(i['dy'])}. Official CVM filings since {e['anos'][0]}, in reais or US dollars.")
    ld = {"@context": "https://schema.org", "@type": "Corporation", "name": e["nome"], "tickerSymbol": tk,
          "url": e["site"] if e.get("site", "").startswith("http") else (f"https://{e['site']}" if e.get("site") else None),
          "description": descricao}
    extra = '<script type="application/ld+json">' + json.dumps({k: v for k, v in ld.items() if v}, ensure_ascii=False) + "</script>"

    linhas_anos = []
    for k in range(max(0, len(e["anos"]) - 6), len(e["anos"])):
        linhas_anos.append(f"<tr><td>{e['anos'][k]}</td><td class='num'>{dinheiro(s['receita'][k])}</td>"
                           f"<td class='num'>{dinheiro(s['lucro_liquido'][k])}</td><td class='num'>{dinheiro(s['dividendos_pagos'][k])}</td></tr>")
    pagamentos = [x for x in e.get("agenda") or [] if x.get("pag")][:6]
    precos = {t: c["preco"] for t, c in e["cotacao"].items()}
    agenda = "".join(
        f"<tr><td>{esc(x['t'])}</td><td>{'Dividend' if x['tipo'] == 'dividendo' else 'Interest on equity' if x['tipo'] == 'jcp' else esc(x['tipo'])}</td>"
        f"<td class='num'>R$ {x['valor']:.4f}</td><td class='num'>{pct(x['valor'] / precos[x['t']], 2) if precos.get(x['t']) else '–'}</td>"
        f"<td>{x['com']}</td><td>{x['pag']}</td></tr>" for x in pagamentos)
    stat = lambda r, v: f'<div class="stat"><span>{r}</span><b class="num">{v}</b></div>'

    corpo = f"""<a class="voltar" href="../">← All companies</a>
<section class="cartao hero">
<div class="hero-principal">
<h1>{esc(nome)}</h1>
<div class="tickers">{"".join(f'<span class="chip{" ativo" if t == tk else ""}">{t}</span>' for t in e["tickers"])}</div>
{f'<div class="hero-preco"><span class="preco num">R$ {cot["preco"]:,.2f}</span><span class="mudo">{tk} · close of {cot["data"]}</span></div>' if cot else ''}
{f'<p class="resumo">{esc(frase)}</p>' if frase else ''}
<div class="selos"><span class="selo-h forte">{esc(setor(e))}</span>{''.join(f'<span class="selo-h">ADR · {esc(", ".join(PAISES.get(x, x) for x in e["exterior"]))}</span>' for _ in e["exterior"][:1])}{'<span class="selo-h aviso">State-owned</span>' if e["controle"].startswith("Estatal") else ''}</div>
<div class="stats">{stat("Market cap", dinheiro(e.get("valor_mercado")))}{stat("P/E " + rot12, vezes(i["pl"]))}{stat("Dividend yield", pct(i["dy"]))}{stat("ROE " + rot12, pct(i["roe"]))}</div>
<p style="margin-top:18px"><a class="botao" href="../../#/{tk}">Open the interactive page →</a></p>
</div>
<div class="score-box"><div><div class="rot">Predictability</div><div class="nivel" style="color:{cor};font-size:34px">{sc if sc is not None else "–"}<span class="mudo" style="font-size:15px">/100</span></div><div class="mudo janela">{niv}</div></div></div>
</section>
<section class="cartao" style="margin-top:16px"><h2>Key figures</h2>
<div class="grade-ind">
<div class="ind"><div class="r">P/B</div><div class="v">{vezes(i["pvp"])}</div></div>
<div class="ind"><div class="r">Net margin {rot12}</div><div class="v">{pct(i["mliq"])}</div></div>
<div class="ind"><div class="r">Net debt/EBITDA</div><div class="v">{vezes(i["dl_ebitda"])}</div></div>
<div class="ind"><div class="r">Listing segment</div><div class="v" style="font-size:15px">{esc(e["segmento"])}</div></div>
</div></section>
<section class="cartao" style="margin-top:16px"><h2>Last years (R$)</h2>
<div class="tabela-wrap"><table><thead><tr><th>Year</th><th>Revenue</th><th>Net income</th><th>Dividends paid</th></tr></thead><tbody>{"".join(linhas_anos)}</tbody></table></div></section>
{f'<section class="cartao" style="margin-top:16px"><h2>Upcoming payments</h2><div class="tabela-wrap"><table><thead><tr><th>Ticker</th><th>Type</th><th>Per share</th><th>Yield</th><th>Record date</th><th>Payment</th></tr></thead><tbody>{agenda}</tbody></table></div></section>' if agenda else ''}
"""
    return (cabeca(titulo, descricao, url, extra) + corpo + RODAPE).replace("{raiz}", "../../").replace("{data}", esc(d["gerado_em"][:10]))


def pagina_indice(empresas, d):
    url = f"{SITE_URL}/acao/"
    por_setor = {}
    for e in empresas:
        por_setor.setdefault(setor(e), []).append(e)
    blocos = []
    for st in sorted(por_setor):
        itens = "".join(
            f'<li><a href="{e["ticker"]}/"><b>{e["ticker"]}</b> {esc(nome_curto(e["nome"]))}</a></li>'
            for e in sorted(por_setor[st], key=lambda x: x["ticker"]))
        blocos.append(f'<section class="cartao" style="margin-top:12px"><h2>{esc(st)} <span class="mudo">({len(por_setor[st])})</span></h2><ul class="lista-acoes">{itens}</ul></section>')
    titulo = "All Brazilian listed companies by sector · Real Terms"
    descricao = f"{len(empresas)} companies listed on B3 with fundamentals, valuation and a predictability score from official CVM filings."
    corpo = (f'<section class="intro"><h1>Brazilian listed companies</h1><p>{esc(descricao)} '
             f'<a href="../#/acoes">Open the interactive ranking →</a></p></section>' + "".join(blocos))
    estilo = "<style>.lista-acoes{list-style:none;padding:0;margin:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:6px 16px}.lista-acoes b{font-family:var(--mono);margin-right:6px}</style>"
    return (cabeca(titulo, descricao, url, estilo) + corpo + RODAPE).replace("{raiz}", "../").replace("{data}", esc(d["gerado_em"][:10]))


def main():
    d = carregar()
    empresas = [e for e in d["empresas"] if e["cotacao"]]  # só quem negocia: páginas úteis para quem busca
    SAIDA.mkdir(exist_ok=True)
    vivos = set()
    for e in empresas:
        pasta = SAIDA / e["ticker"]
        pasta.mkdir(exist_ok=True)
        (pasta / "index.html").write_text(pagina_empresa(e, d), encoding="utf-8")
        vivos.add(e["ticker"])
    # remove páginas de empresas que saíram (só as geradas por este script)
    for pasta in SAIDA.iterdir():
        alvo = pasta / "index.html"
        if pasta.is_dir() and pasta.name not in vivos and alvo.exists() and MARCA in alvo.read_text(encoding="utf-8"):
            alvo.unlink()
            pasta.rmdir()
    (SAIDA / "index.html").write_text(pagina_indice(empresas, d), encoding="utf-8")

    hoje = date.today().isoformat()
    urls = [f"{SITE_URL}/", f"{SITE_URL}/acao/"] + [f"{SITE_URL}/acao/{t}/" for t in sorted(vivos)]
    (RAIZ / "sitemap.xml").write_text(
        '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
        "".join(f"  <url><loc>{u}</loc><lastmod>{hoje}</lastmod></url>\n" for u in urls) + "</urlset>\n", encoding="utf-8")
    (RAIZ / "robots.txt").write_text(f"User-agent: *\nAllow: /\nSitemap: {SITE_URL}/sitemap.xml\n", encoding="utf-8")
    print(f"{len(vivos)} páginas de empresa + índice → acao/ · sitemap com {len(urls)} endereços")


if __name__ == "__main__":
    main()
