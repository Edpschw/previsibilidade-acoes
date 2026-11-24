"""Resumo semanal em inglês (Real Terms Weekly): uma edição por semana, no site e num feed RSS que um
serviço de e-mail pode ler para mandar a newsletter.

    python3 scripts/resumo_semanal.py                     # no CI, todo dia útil
    python3 scripts/resumo_semanal.py --data 2026-11-20   # gera a edição dessa sexta (--refazer se já existe)

Roda depois de scripts/processar.py e scripts/historico.py e antes de scripts/gerar_paginas.py, que põe
as edições no sitemap. Escreve:

    semana/<sexta>/resumo.json   conteúdo da edição; fica como foi publicado
    semana/<sexta>/estado.json   retrato da base no dia, que a edição seguinte usa para achar o que mudou
    semana/<sexta>/index.html    a edição, no visual das páginas de empresa
    semana/index.html            a edição mais recente e o arquivo
    semana/feed.xml              RSS 2.0 com as últimas edições completas, em HTML de e-mail

Quando sai: a edição leva a data da sexta da semana e sai uma vez, na primeira execução que já tem o
fechamento de sexta na base ou, se ele não vier (feriado, arquivo da B3 atrasado), de sábado até a terça
seguinte. A data do relógio sozinha não basta: o agendamento do GitHub atrasa umas cinco horas, e a
execução das 20h17 de quinta roda na madrugada de sexta, ainda sem o pregão de sexta. Fora dessa janela,
ou com a edição já feita, o script só redesenha as páginas e o feed a partir dos resumo.json guardados.

O que entra, tudo com dados que o site já tem:
  - câmbio da semana (PTAX) e quantas ações subiram e caíram, com a mediana em reais e em dólares;
  - as cinco maiores altas e as cinco maiores quedas em dólares, do melhor para o pior;
  - proventos da semana seguinte (último dia com direito e pagamentos), do maior para o menor yield;
  - desde a edição anterior: proventos anunciados, balanços entregues à CVM, índice de previsibilidade
    que mudou 3 pontos ou mais, empresas que entraram ou saíram da base;
  - uma aula do curso da página inicial por edição, em ordem.
"""

import argparse
import json
import re
import sys
from bisect import bisect_right
from datetime import date, datetime, timedelta, timezone
from email.utils import format_datetime
from pathlib import Path
from statistics import median
from xml.sax.saxutils import escape as xesc

sys.path.insert(0, str(Path(__file__).resolve().parent))
import gerar_paginas as G  # noqa: E402  (cabeçalho, rodapé, formatos e endereço do site)

RAIZ = Path(__file__).resolve().parent.parent
SAIDA = RAIZ / "semana"
BASE = RAIZ / "data" / "empresas.js"
AGENDA = RAIZ / "data" / "agenda.js"
HIST = RAIZ / "data" / "historico"
INICIO_JS = RAIZ / "inicio.js"

FUSO = timezone(timedelta(hours=-3))  # Brasília, sem horário de verão desde 2019
JANELA_DIAS = 4       # a edição da sexta ainda sai até a terça (a execução de segunda roda na madrugada de terça)
N_MOVIMENTOS = 5      # maiores altas e maiores quedas
LIMIAR_INDICE = 3     # pontos no índice de previsibilidade
MAX_LISTA = 12        # linhas das tabelas de mudanças: metade do topo, metade do fim
MAX_PROVENTOS = 15    # linhas das tabelas de proventos, do maior yield para o menor
ITENS_FEED = 12
TITULO = "Real Terms Weekly"
DESCRICAO = ("A free weekly summary of Brazilian stocks for international investors: the real against the "
             "dollar, the biggest moves, upcoming dividends, new filings and one lesson.")
MESES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October",
         "November", "December"]
DIAS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
TIPOS = {"dividendo": "Dividend", "jcp": "JCP", "rendimento": "Distribution"}
TRIMESTRE = {3: "Q1", 6: "Q2", 9: "Q3", 12: "Q4"}
# virada de sinal do lucro, sem variação percentual: posição na ordem do melhor para o pior
VIRADA = {"back to profit": 1e6, "loss narrowed": 0.0, "loss unchanged": 0.0, "loss widened": -1e6 + 1, "to a loss": -1e6}
EDICAO = re.compile(r"\d{4}-\d{2}-\d{2}")
# no site, ".stat span" (rótulo do quadro de números) pintaria de cinza o sinal da variação
ESTILO_PAGINA = ("<style>.stat b span{font-size:inherit}.stat b .pos{color:var(--pos)}"
                 ".stat b .neg{color:var(--neg)}.stat b .mudo{color:var(--muted)}</style>")
esc = G.esc


# ---------------------------------------------------------------- leitura

def ler_js(caminho):
    """window.X = {...}; (empresas.js, agenda.js) → dict"""
    return json.loads(caminho.read_text(encoding="utf-8").split("=", 1)[1].rstrip().rstrip(";"))


def ler_hist(nome):
    """data/historico/<TICKER>.js ou _indices.js (formato do scripts/historico.py) → dict, ou None"""
    p = HIST / f"{nome}.js"
    if not p.exists():
        return None
    texto = p.read_text(encoding="utf-8")
    corpo = texto.split("]=", 1)[1] if "]=" in texto else texto.split("=", 1)[1]
    return json.loads(corpo.rstrip().rstrip(";"))


def datas(h):
    """datas de uma série compacta: a primeira e os saltos em dias"""
    out = [date.fromisoformat(h["d0"])]
    for s in h["dd"]:
        out.append(out[-1] + timedelta(days=s))
    return out


def precos(h):
    """fechamentos: inteiros (centavos ou décimos de milésimo) com as diferenças entre pregões"""
    v, out = h["p0"], [h["p0"] / h["esc"]]
    for x in h["dp"]:
        v += x
        out.append(v / h["esc"])
    return out


def no_dia(ds, vs, dia):
    """(data, valor) do último dado até 'dia', ou None"""
    i = bisect_right(ds, dia) - 1
    return (ds[i], vs[i]) if i >= 0 else None


def variacao(h, ini, fim, desde):
    """Fechamento do último pregão até 'fim' contra o do último até 'ini', ajustado pelos desdobramentos,
    grupamentos e bonificações com data no meio (quem tinha uma ação passa a ter 'fator' ações).
    None se o papel não negociou de 'desde' em diante (suspenso ou sem pregão na semana)."""
    ds, ps = datas(h), precos(h)
    a, b = no_dia(ds, ps, ini), no_dia(ds, ps, fim)
    if not a or not b or b[0] < desde or b[0] <= a[0]:
        return None
    fator = 1.0
    for ev in h.get("ev") or []:
        if a[0].isoformat() < ev[0] <= b[0].isoformat():
            fator *= ev[1]
    return {"de": a, "ate": b, "var": b[1] * fator / a[1] - 1}


def aulas():
    """[(palavra, pergunta)] em inglês, na ordem do curso da página inicial (0 = capa)"""
    if not INICIO_JS.exists():
        return []
    texto = INICIO_JS.read_text(encoding="utf-8")
    return re.findall(r'palavra:\s*\["[^"]*",\s*"([^"]*)"\],\s*pergunta:\s*\["[^"]*",\s*"([^"]*)"\]', texto)


# ---------------------------------------------------------------- datas

def sexta(dia):
    """sexta-feira mais recente até 'dia' (a própria, se for sexta)"""
    return dia - timedelta(days=(dia.weekday() - 4) % 7)


def deve_gerar(hoje, existe, cotacoes_em):
    """A edição da sexta sai uma vez: na sexta, só se o fechamento de sexta já está na base
    (cotacoes_em); de sábado até a terça, de qualquer jeito."""
    F = sexta(hoje)
    dias = (hoje - F).days
    if existe or dias > JANELA_DIAS:
        return False
    return dias >= 1 or (cotacoes_em or "") >= F.isoformat()


def _d(d):
    return date.fromisoformat(d) if isinstance(d, str) else d


def dia_curto(d, ano_ref=None):
    d = _d(d)
    return f"{MESES[d.month - 1][:3]} {d.day}" + (f", {d.year}" if ano_ref and d.year != ano_ref else "")


def dia_semana(d):
    d = _d(d)
    return f"{DIAS[d.weekday()]}, {dia_curto(d)}"


def intervalo(ini, fim):
    """'November 16–20, 2026' · 'November 30 – December 4, 2026' · 'December 28, 2026 – January 1, 2027'"""
    if ini.year != fim.year:
        return f"{MESES[ini.month - 1]} {ini.day}, {ini.year} – {MESES[fim.month - 1]} {fim.day}, {fim.year}"
    if ini.month != fim.month:
        return f"{MESES[ini.month - 1]} {ini.day} – {MESES[fim.month - 1]} {fim.day}, {fim.year}"
    return f"{MESES[ini.month - 1]} {ini.day}–{fim.day}, {fim.year}"


# ---------------------------------------------------------------- conteúdo

def extremos(itens, chave, n):
    """os n melhores e os n piores, do melhor para o pior; com poucos itens, uma lista só"""
    ordem = sorted(itens, key=lambda x: (-chave(x), x.get("t", "")))
    if len(ordem) <= 2 * n:
        return ordem, []
    return ordem[:n], ordem[-n:]


def chave_provento(x):
    return f"{x['t']}|{x['tipo']}|{x['valor']:.8f}|{x['com']}"


def por_yield(p):
    return (p["yield"] is None, -(p["yield"] or 0), p["t"])


def retrato(d, agenda, F):
    """o que a edição seguinte precisa para saber o que mudou na semana"""
    emp = {}
    for e in d["empresas"]:
        t = e.get("ttm") or {}
        emp[e["cnpj"]] = {"t": e["ticker"], "nome": G.nome_curto(e["nome"]), "ano": e["anos"][-1],
                          "rec_ano": e["series"]["receita"][-1], "ll_ano": e["series"]["lucro_liquido"][-1],
                          "ttm": t.get("ate"), "rec": t.get("receita"), "ll": t.get("lucro_liquido"),
                          "indice": ((e.get("score") or {}).get("brl") or {}).get("total")}
    return {"data": F.isoformat(), "gerado_em": d["gerado_em"], "cotacoes_em": d.get("cotacoes_em"),
            "empresas": emp, "proventos": sorted(chave_provento(x) for lst in agenda.values() for x in lst)}


def balanco(b, periodo, rec, ll):
    """linha de balanço novo: valores de agora e variação contra o retrato anterior"""
    def var(antes, agora):
        return round(agora / antes - 1, 6) if antes and agora is not None and antes > 0 and agora > 0 else None

    def virada(antes, agora):
        if antes is None or agora is None or (antes > 0 and agora > 0):
            return None
        if antes <= 0 < agora:
            return "back to profit"
        if antes > 0 >= agora:
            return "to a loss"
        return "loss narrowed" if agora > antes else "loss widened" if agora < antes else "loss unchanged"

    return {"t": b["t"], "pagina": b["t"], "nome": b["nome"], "periodo": periodo,
            "rec": rec[1], "rec_var": var(*rec), "ll": ll[1], "ll_var": var(*ll), "ll_txt": virada(*ll)}


def comparar(ant, atual):
    """balanços novos, mudanças no índice e quem entrou ou saiu, entre dois retratos"""
    A, B = ant["empresas"], atual["empresas"]
    balancos, indice = [], []
    for c, b in B.items():
        a = A.get(c)
        if not a:
            continue
        if b["ano"] > a["ano"]:
            balancos.append(balanco(b, f"FY {b['ano']}", (a["rec_ano"], b["rec_ano"]), (a["ll_ano"], b["ll_ano"])))
        elif b.get("ttm") and b["ttm"] > (a.get("ttm") or ""):
            fim = date.fromisoformat(b["ttm"])
            balancos.append(balanco(b, f"{TRIMESTRE.get(fim.month, dia_curto(fim))} {fim.year}",
                                    (a.get("rec"), b.get("rec")), (a.get("ll"), b.get("ll"))))
        if a.get("indice") is not None and b.get("indice") is not None and abs(b["indice"] - a["indice"]) >= LIMIAR_INDICE:
            indice.append({"t": b["t"], "pagina": b["t"], "nome": b["nome"], "de": a["indice"], "para": b["indice"]})
    nota_ll = lambda x: x["ll_var"] if x["ll_var"] is not None else VIRADA.get(x["ll_txt"], -2e6)
    btopo, bfim = extremos(balancos, nota_ll, MAX_LISTA // 2)
    itopo, ifim = extremos(indice, lambda x: x["para"] - x["de"], MAX_LISTA // 2)
    por_indice = lambda x: (x["indice"] is None, -(x["indice"] or 0), x["t"])
    entraram = [{"t": B[c]["t"], "pagina": B[c]["t"], "nome": B[c]["nome"], "indice": B[c]["indice"]} for c in set(B) - set(A)]
    sairam = [{"t": A[c]["t"], "pagina": None, "nome": A[c]["nome"], "indice": A[c]["indice"]} for c in set(A) - set(B)]
    return {"desde": ant.get("data"),
            "balancos": {"topo": btopo, "fim": bfim, "total": len(balancos)},
            "indice": {"topo": itopo, "fim": ifim, "total": len(indice)},
            "entraram": sorted(entraram, key=por_indice), "sairam": sorted(sairam, key=por_indice)}


def frase(r):
    """uma linha com o essencial da semana (abre a edição e vai na descrição do RSS)"""
    partes, c, u = [], r.get("cambio"), r.get("universo")
    if c:
        partes.append(f"the real {'rose' if c['real'] >= 0 else 'fell'} {abs(c['real']) * 100:.1f}% against the dollar")
    if u and u["n"]:
        partes.append(f"{u['sobe']} of {u['n']} stocks gained in reais")
    pv = r["proventos"]
    nd, npg = pv["direito"]["total"], pv["pagamentos"]["total"]
    if nd:
        partes.append(f"{nd} {'dividend has its' if nd == 1 else 'dividends have their'} last day with rights next week")
    if npg:
        partes.append(f"{npg} dividend {'payment is' if npg == 1 else 'payments are'} due next week")
    m = r.get("mudancas")
    if m and m["balancos"]["total"]:
        n = m["balancos"]["total"]
        partes.append(f"{n} {'company' if n == 1 else 'companies'} filed results")
    if not partes:
        return "A weekly summary of Brazilian stocks."
    texto = "; ".join(partes)
    return texto[0].upper() + texto[1:] + "."


def montar(d, agenda, indices, F, anterior, numero, hist=ler_hist, lista_aulas=None, agora=None):
    """Conteúdo da edição da sexta F e o retrato que a próxima edição vai comparar.
    'anterior' é o estado.json da edição anterior (None na primeira)."""
    seg = F - timedelta(days=4)
    prox = (F + timedelta(days=3), F + timedelta(days=7))
    ptax = (indices or {}).get("ptax")
    px = (datas(ptax), ptax["v"]) if ptax else None

    def ptax_em(dia):
        r = no_dia(*px, dia) if px else None
        return r[1] if r else None

    # câmbio e movimentos da semana (último fechamento da semana contra o da semana anterior)
    cambio = None
    if px:
        a, b = no_dia(*px, F - timedelta(days=7)), no_dia(*px, F)
        if a and b and b[0] > a[0]:
            cambio = {"de": a[1], "para": b[1], "data": b[0].isoformat(), "real": round(a[1] / b[1] - 1, 6)}
    linhas = []
    for e in d["empresas"]:
        h = hist(e["ticker"])
        v = variacao(h, F - timedelta(days=7), F, seg) if h else None
        if not v:
            continue
        p0, p1 = ptax_em(v["de"][0]), ptax_em(v["ate"][0])
        usd = (1 + v["var"]) * p0 / p1 - 1 if p0 and p1 else None
        linhas.append({"t": e["ticker"], "pagina": e["ticker"], "nome": G.nome_curto(e["nome"]),
                       "preco": round(v["ate"][1], 4), "data": v["ate"][0].isoformat(),
                       "brl": round(v["var"], 6), "usd": None if usd is None else round(usd, 6)})
    universo = None
    if linhas:
        usds = [x["usd"] for x in linhas if x["usd"] is not None]
        universo = {"n": len(linhas), "sobe": sum(x["brl"] > 0 for x in linhas), "desce": sum(x["brl"] < 0 for x in linhas),
                    "mediana_brl": round(median(x["brl"] for x in linhas), 6),
                    "mediana_usd": round(median(usds), 6) if usds else None}
    topo, fim = extremos(linhas, lambda x: x["usd"] if x["usd"] is not None else x["brl"], N_MOVIMENTOS)

    # proventos: valor bruto por ação, em dólar pela PTAX mais recente, yield sobre o último fechamento
    por_cnpj = {e["cnpj"]: e for e in d["empresas"]}
    hoje_ptax = d.get("ptax_atual") or {}

    def provento(cnpj, x):
        e = por_cnpj.get(cnpj)
        if not e:
            return None
        preco = (e["cotacao"].get(x["t"]) or {}).get("preco")
        return {"t": x["t"], "pagina": e["ticker"] if e["cotacao"] else None, "nome": G.nome_curto(e["nome"]),
                "tipo": x["tipo"], "valor": x["valor"],
                "usd": round(x["valor"] / hoje_ptax["valor"], 6) if hoje_ptax.get("valor") else None,
                "yield": round(x["valor"] / preco, 6) if preco else None, "com": x["com"], "pag": x.get("pag")}

    def selecionar(filtro):
        """uma linha por empresa, tipo e datas: o ticker principal (ou a classe de maior yield) e as outras
        classes ao lado, para TAEE3, TAEE4 e TAEE11 não ocuparem três linhas"""
        grupos = {}
        for c, lst in agenda.items():
            for x in lst:
                p = provento(c, x) if filtro(x) else None
                if p:
                    grupos.setdefault((c, x["tipo"], x["com"], x.get("pag")), []).append(p)
        itens = []
        for (c, *_), ps in grupos.items():
            p = next((q for q in ps if q["t"] == por_cnpj[c]["ticker"]), None) or min(ps, key=por_yield)
            p["outros"] = sorted(q["t"] for q in ps if q is not p)
            itens.append(p)
        itens.sort(key=por_yield)
        return {"itens": itens[:MAX_PROVENTOS], "total": len(itens)}

    na_semana = lambda s: bool(s) and prox[0].isoformat() <= s <= prox[1].isoformat()
    proventos = {"semana": [prox[0].isoformat(), prox[1].isoformat()],
                 "direito": selecionar(lambda x: na_semana(x["com"])),
                 "pagamentos": selecionar(lambda x: na_semana(x.get("pag")))}

    estado = retrato(d, agenda, F)
    mudancas = None
    if anterior:
        mudancas = comparar(anterior, estado)
        vistos = set(anterior.get("proventos") or [])
        mudancas["anunciados"] = selecionar(lambda x: chave_provento(x) not in vistos)

    lista = aulas() if lista_aulas is None else lista_aulas
    aula = None
    if len(lista) > 1:
        n = (numero - 1) % (len(lista) - 1) + 1
        aula = {"n": n, "total": len(lista) - 1, "palavra": lista[n][0], "pergunta": lista[n][1]}

    r = {"data": F.isoformat(), "numero": numero, "semana_txt": "Week of " + intervalo(seg, F),
         "gerado_em": d["gerado_em"], "publicado_em": (agora or datetime.now(FUSO)).isoformat(timespec="minutes"),
         "pregao": max((x["data"] for x in linhas), default=None), "cambio": cambio,
         "ptax_hoje": hoje_ptax or None, "universo": universo, "movimentos": {"topo": topo, "fim": fim},
         "proventos": proventos, "mudancas": mudancas, "aula": aula}
    r["frase"] = frase(r)
    return r, estado


# ---------------------------------------------------------------- HTML: página do site e e-mail

class Estilo:
    """O mesmo conteúdo em dois formatos: página do site (classes do style.css, links relativos) e
    e-mail/RSS (estilos na própria tag, cores fixas do tema claro, links absolutos)."""
    TEXTO, MUDO, POS, NEG, LINHA, LINK = "#0e1a24", "#5b6b7a", "#16803c", "#c0362c", "#e1e6ea", "#0b7a6b"

    def __init__(self, email, raiz):
        self.email, self.raiz = email, raiz

    def secao(self, titulo, corpo):
        if self.email:
            return f'<h2 style="font-size:18px;line-height:1.3;margin:32px 0 8px;color:{self.TEXTO}">{esc(titulo)}</h2>{corpo}'
        return f'<section class="cartao" style="margin-top:16px"><h2>{esc(titulo)}</h2>{corpo}</section>'

    def sub(self, titulo):
        estilo = f"font-size:15px;margin:22px 0 6px;color:{self.TEXTO}" if self.email else "font-size:15px;margin:20px 0 8px"
        return f'<h3 style="{estilo}">{esc(titulo)}</h3>'

    def p(self, conteudo, mudo=False):
        if self.email:
            cor, tam = (self.MUDO, 13) if mudo else (self.TEXTO, 15)
            return f'<p style="margin:8px 0;font-size:{tam}px;line-height:1.5;color:{cor}">{conteudo}</p>'
        classe = ' class="mudo"' if mudo else ""
        return f'<p{classe} style="margin:10px 0 0">{conteudo}</p>'

    def sinal(self, v, casas=1):
        if v is None:
            return "–"
        txt = f"{v * 100:+.{casas}f}%".replace("-", "−")
        if self.email:
            cor = self.POS if v > 0 else self.NEG if v < 0 else self.MUDO
            return f'<span style="color:{cor}">{txt}</span>'
        classe = "pos" if v > 0 else "neg" if v < 0 else "mudo"
        return f'<span class="{classe}">{txt}</span>'

    def link(self, caminho, texto):
        href = caminho if caminho.startswith("http") else self.raiz + caminho
        estilo = f' style="color:{self.LINK}"' if self.email else ""
        return f'<a href="{esc(href)}"{estilo}>{texto}</a>'

    def empresa(self, x):
        """ticker em negrito e nome, com link para a página da empresa quando ela existe"""
        rotulo = f"<b>{esc(x['t'])}</b> {esc(x['nome'])}"
        return self.link(f"acao/{x['pagina']}/", rotulo) if x.get("pagina") else rotulo

    def pequeno(self, texto):
        if self.email:
            return f'<br><span style="font-size:12px;color:{self.MUDO}">{texto}</span>'
        return f'<br><span class="mudo" style="font-size:12px">{texto}</span>'

    def numeros(self, pares):
        if self.email:
            celula = lambda r, v: (f'<td style="padding:8px 24px 8px 0;vertical-align:top"><div style="font-size:12px;color:{self.MUDO}">{r}</div>'
                                   f'<div style="font-size:18px;font-weight:600;color:{self.TEXTO};white-space:nowrap">{v}</div></td>')
            linhas = "".join("<tr>" + "".join(celula(r, v) for r, v in pares[i:i + 2]) + "</tr>" for i in range(0, len(pares), 2))
            return f'<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:4px 0">{linhas}</table>'
        return '<div class="stats" style="margin-top:6px">' + "".join(
            f'<div class="stat"><span>{r}</span><b class="num">{v}</b></div>' for r, v in pares) + "</div>"

    def tabela(self, cab, linhas, num=()):
        """cab: títulos; linhas: listas de células em HTML; num: colunas numéricas.
        Uma linha None separa os melhores dos piores."""
        num = set(num)
        if self.email:
            def cel(tag, i, c):
                al = "right" if i in num else "left"
                if tag == "th":
                    return (f'<th align="{al}" style="padding:6px 8px;border-bottom:2px solid {self.LINHA};font-size:12px;'
                            f'font-weight:600;color:{self.MUDO};text-align:{al}">{c}</th>')
                extra = ";white-space:nowrap" if i > 0 else ""  # só o nome da empresa quebra linha
                return f'<td align="{al}" style="padding:6px 8px;border-bottom:1px solid {self.LINHA};text-align:{al};vertical-align:top{extra}">{c}</td>'
            sep = f'<tr><td colspan="{len(cab)}" align="center" style="padding:2px;color:{self.MUDO}">⋯</td></tr>'
            corpo = "".join(sep if ln is None else "<tr>" + "".join(cel("td", i, c) for i, c in enumerate(ln)) + "</tr>" for ln in linhas)
            return (f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;'
                    f'font-size:14px;color:{self.TEXTO}"><tr>' + "".join(cel("th", i, c) for i, c in enumerate(cab)) + f"</tr>{corpo}</table>")

        def cel(tag, i, c):
            classe = ' class="num"' if i in num else ""
            return f"<{tag}{classe}>{c}</{tag}>"
        sep = f'<tr><td colspan="{len(cab)}" class="mudo" style="text-align:center">⋯</td></tr>'
        corpo = "".join(sep if ln is None else "<tr>" + "".join(cel("td", i, c) for i, c in enumerate(ln)) + "</tr>" for ln in linhas)
        return ('<div class="tabela-wrap" style="margin-top:10px"><table><thead><tr>' +
                "".join(cel("th", i, c) for i, c in enumerate(cab)) + f"</tr></thead><tbody>{corpo}</tbody></table></div>")


def bloco_cabecalho(r, E, nivel=1):
    rotulo = f"{TITULO} · Issue {r['numero']}"
    h = f"h{nivel}"
    if E.email:
        return (f'<p style="margin:0;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:{E.MUDO}">{esc(rotulo)}</p>'
                f'<h1 style="font-size:24px;line-height:1.25;margin:6px 0 10px;color:{E.TEXTO}">{esc(r["semana_txt"])}</h1>' + E.p(esc(r["frase"])))
    return (f'<section class="intro"><p style="margin:0 0 4px;font-size:12px;letter-spacing:.08em;text-transform:uppercase">{esc(rotulo)}</p>'
            f'<{h}>{esc(r["semana_txt"])}</{h}><p>{esc(r["frase"])}</p></section>')


def bloco_numeros(r, E):
    c, u = r.get("cambio"), r.get("universo")
    pares = []
    if c:
        pares += [("US$ 1 =", f"R$ {c['para']:.4f}"), ("Real vs. dollar", E.sinal(c["real"]))]
    if u:
        pares += [("Stocks up · down", f"{u['sobe']} · {u['desce']}"), ("Median move in US$", E.sinal(u["mediana_usd"]))]
    if not pares:
        return ""
    nota = []
    if r.get("pregao"):
        nota.append(f"Closing prices of {dia_semana(r['pregao'])} against the previous week's close")
    if c:
        nota.append(f"PTAX rate of {dia_semana(c['data'])}; a positive change means the real gained")
    if u:
        nota.append(f"{u['n']} stocks, the main ticker of each company; median move in reais {E.sinal(u['mediana_brl'])}")
    return E.secao("The week in numbers", E.numeros(pares) + E.p(". ".join(nota) + ".", mudo=True))


def bloco_movimentos(r, E):
    m = r["movimentos"]
    if not m["topo"]:
        return ""
    linha = lambda x: [E.empresa(x), f"R$ {x['preco']:,.2f}", E.sinal(x["brl"]), E.sinal(x["usd"])]
    linhas = [linha(x) for x in m["topo"]] + ([None] + [linha(x) for x in m["fim"]] if m["fim"] else [])
    nota = ("The five best and the five worst, from best to worst. " if m["fim"] else "From best to worst. ") + \
        "Price change, adjusted for splits; dividends are not included."
    return E.secao("Biggest moves, in US$", E.tabela(["Company", "Close", "Week in R$", "Week in US$"], linhas, num=(1, 2, 3)) +
                   E.p(nota, mudo=True))


def _por_acao(x, E):
    usd = f"≈ US$ {x['usd']:.4f}" if x.get("usd") is not None else ""
    return f"R$ {x['valor']:.4f}" + (E.pequeno(usd) if usd else "")


def _tipo(x):
    return TIPOS.get(x["tipo"], x["tipo"].capitalize())


def _mais(lista, E, rotulo):
    falta = lista["total"] - len(lista["itens"])
    return E.p(f"…and {falta} more {rotulo}. " + E.link("#/agenda", "See the full calendar →"), mudo=True) if falta > 0 else ""


def tabela_proventos(lista, E, ano_ref, com_data_com):
    def comeco(x):
        outros = x.get("outros") or []
        return [E.empresa(x) + (E.pequeno("also " + ", ".join(esc(t) for t in outros)) if outros else ""), _tipo(x),
                _por_acao(x, E), G.pct(x["yield"], 2) if x["yield"] is not None else "–"]
    if com_data_com:
        cab = ["Company", "Type", "Per share", "Yield", "Last day with rights", "Payment"]
        linha = lambda x: comeco(x) + [dia_curto(x["com"], ano_ref), dia_curto(x["pag"], ano_ref) if x.get("pag") else "to be set"]
    else:
        cab = ["Company", "Type", "Per share", "Yield", "Payment"]
        linha = lambda x: comeco(x) + [dia_curto(x["pag"], ano_ref)]
    return E.tabela(cab, [linha(x) for x in lista["itens"]], num=(2, 3))


def bloco_proventos(r, E):
    pv = r["proventos"]
    ini, fim = (date.fromisoformat(s) for s in pv["semana"])
    ano = ini.year
    partes = []
    if pv["direito"]["itens"]:
        partes.append(E.sub("Last day to buy with rights") + tabela_proventos(pv["direito"], E, ano, True) +
                      _mais(pv["direito"], E, "dividends"))
    if pv["pagamentos"]["itens"]:
        partes.append(E.sub("Payments") + tabela_proventos(pv["pagamentos"], E, ano, False) +
                      _mais(pv["pagamentos"], E, "payments"))
    if not partes:
        partes.append(E.p("No dividend dates or payments scheduled for next week so far."))
    data_ptax = (r.get("ptax_hoje") or {}).get("data")
    partes.append(E.p(
        "Gross amounts per share" + (f", in dollars at the PTAX rate of {dia_curto(data_ptax)}" if data_ptax else "") +
        "; yield on the latest close, from highest to lowest. Buying after the last day with rights does not entitle "
        "you to the payment: the shares trade ex-dividend from the next session. Brazil withholds income tax from "
        "non-residents: 10% on dividends since January 2026, and a higher rate on JCP (interest on equity, a payout "
        "the company deducts from its taxable income) that depends on your country's tax treaty. " +
        E.link("#/agenda", "Full dividend calendar →"), mudo=True))
    return E.secao(f"Dividends next week ({intervalo(ini, fim)})", "".join(partes))


def bloco_mudancas(r, E):
    m = r.get("mudancas")
    if m is None:
        return E.secao("Since the last issue", E.p(
            "This is the first issue. From the next one on, this section lists new dividend announcements, results "
            "filed with the CVM and changes in the predictability score.", mudo=True))
    partes = []
    an = m["anunciados"]
    if an["itens"]:
        partes.append(E.sub(f"New dividend announcements ({an['total']})") + tabela_proventos(an, E, int(r["data"][:4]), True) +
                      _mais(an, E, "announcements"))
    b = m["balancos"]
    if b["topo"]:
        def linha(x):
            ll = E.sinal(x["ll_var"]) if x["ll_var"] is not None else (esc(x["ll_txt"]) if x["ll_txt"] else "–")
            return [E.empresa(x), esc(x["periodo"]), G.dinheiro(x["rec"]), E.sinal(x["rec_var"]), G.dinheiro(x["ll"]), ll]
        linhas = [linha(x) for x in b["topo"]] + ([None] + [linha(x) for x in b["fim"]] if b["fim"] else [])
        mais = f" Showing the six best and six worst of {b['total']}." if b["fim"] else ""
        partes.append(E.sub(f"Results filed with the CVM ({b['total']})") +
                      E.tabela(["Company", "Period", "Revenue, 12m", "Change", "Net income, 12m", "Change"], linhas, num=(2, 3, 4, 5)) +
                      E.p("12-month figures in reais, from the best to the worst change in net income. For a quarterly filing, "
                          "the change compares with the 12-month figure before it: the new quarter against the same quarter "
                          "a year earlier. For an annual filing, the year against the previous one." + mais, mudo=True))
    i = m["indice"]
    if i["topo"]:
        linha = lambda x: [E.empresa(x), str(x["de"]), f"<b>{x['para']}</b>", f"{x['para'] - x['de']:+d}".replace("-", "−")]
        linhas = [linha(x) for x in i["topo"]] + ([None] + [linha(x) for x in i["fim"]] if i["fim"] else [])
        partes.append(E.sub(f"Predictability score moved {LIMIAR_INDICE} points or more ({i['total']})") +
                      E.tabela(["Company", "Before", "Now", "Change"], linhas, num=(1, 2, 3)) +
                      E.p("Score from 0 to 100 that measures how steady revenue, margins, profits and dividends have been. "
                          + E.link("#/ranking", "See the ranking →"), mudo=True))
    if m["entraram"] or m["sairam"]:
        itens = [f"Joined: {E.empresa(x)}" for x in m["entraram"]] + [f"Left: {E.empresa(x)}" for x in m["sairam"]]
        partes.append(E.sub("Coverage") + E.p(" · ".join(itens)) +
                      E.p("Real Terms covers stocks that trade at least R$ 1 million a day on average.", mudo=True))
    if not partes:
        partes.append(E.p("No new dividend announcements, filings or score changes this week.", mudo=True))
    return E.secao("Since the last issue", "".join(partes))


def bloco_aula(r, E):
    a = r.get("aula")
    if not a:
        return ""
    return E.secao("Learn", E.p(f"Lesson {a['n']} of {a['total']} · <b>{esc(a['palavra'].capitalize())}</b>: {esc(a['pergunta'])}") +
                   E.p(E.link(f"#/curso/{a['n']}", "Open the lesson →")))


def conteudo(r, E, nivel=1):
    return "".join([bloco_cabecalho(r, E, nivel), bloco_numeros(r, E), bloco_movimentos(r, E),
                    bloco_proventos(r, E), bloco_mudancas(r, E), bloco_aula(r, E)])


def html_email(r):
    """a edição em HTML de e-mail: vai no RSS, de onde um serviço de newsletter a manda"""
    E = Estilo(True, G.SITE_URL + "/")
    web = f"semana/{r['data']}/"
    rodape = (f'<hr style="border:0;border-top:1px solid {E.LINHA};margin:32px 0 12px">' +
              E.p(f'{E.link(web, "Read on the web")} · {E.link("semana/", "All issues")} · {E.link("", "Real Terms")}', mudo=True) +
              E.p("A data tool, not investment advice. Sources: CVM open-data portal (company filings), B3 (prices and "
                  "corporate actions) and the Central Bank of Brazil (PTAX).", mudo=True))
    return ('<div style="font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,Helvetica,Arial,sans-serif;'
            f'max-width:640px;color:{E.TEXTO}">' + conteudo(r, E) + rodape + "</div>")


def pagina_edicao(r):
    raiz = "../../"
    E = Estilo(False, raiz)
    url = f"{G.SITE_URL}/semana/{r['data']}/"
    corpo = ('<a class="voltar" href="../">← All issues</a>' + conteudo(r, E) +
             E.secao("Every week", E.p(f"{esc(DESCRICAO)} {E.link('semana/feed.xml', 'Follow by RSS')}.")))
    return (G.cabeca(f"{r['semana_txt']} · {TITULO}", r["frase"], url, ESTILO_PAGINA) + corpo + G.RODAPE) \
        .replace("{raiz}", raiz).replace("{data}", esc(r["gerado_em"][:10]))


def pagina_arquivo(eds):
    raiz = "../"
    E = Estilo(False, raiz)
    intro = (f'<section class="intro"><h1>{TITULO}</h1><p>{esc(DESCRICAO)} '
             f'{E.link("semana/feed.xml", "Follow by RSS")} or read the latest issue below.</p></section>')
    if eds:
        itens = "".join(f'<li>{E.link("semana/" + r["data"] + "/", esc(r["semana_txt"]))} <span class="mudo">· Issue {r["numero"]}</span></li>'
                        for r in eds)
        corpo = (intro + conteudo(eds[0], E, nivel=2) +
                 E.secao("All issues", f'<ul style="margin:10px 0 0;padding-left:18px;line-height:1.8">{itens}</ul>'))
        data = eds[0]["gerado_em"][:10]
    else:
        corpo, data = intro + E.secao("Coming soon", E.p("The first issue comes out on Friday.")), ""
    return (G.cabeca(f"{TITULO}: Brazilian stocks every week", DESCRICAO, f"{G.SITE_URL}/semana/", ESTILO_PAGINA) + corpo + G.RODAPE) \
        .replace("{raiz}", raiz).replace("{data}", esc(data))


def feed(eds):
    """RSS 2.0; o guid é o endereço da edição, então um serviço de e-mail manda cada uma uma vez só"""
    itens = []
    for r in eds[:ITENS_FEED]:
        url = f"{G.SITE_URL}/semana/{r['data']}/"
        corpo = html_email(r).replace("]]>", "]]]]><![CDATA[>")
        itens.append("  <item>\n"
                     f"    <title>{xesc(r['semana_txt'] + ' · ' + TITULO)}</title>\n"
                     f"    <link>{url}</link>\n"
                     f'    <guid isPermaLink="true">{url}</guid>\n'
                     f"    <pubDate>{format_datetime(datetime.fromisoformat(r['publicado_em']))}</pubDate>\n"
                     f"    <description>{xesc(r['frase'])}</description>\n"
                     f"    <content:encoded><![CDATA[{corpo}]]></content:encoded>\n"
                     "  </item>\n")
    ultima = f"  <lastBuildDate>{format_datetime(datetime.fromisoformat(eds[0]['publicado_em']))}</lastBuildDate>\n" if eds else ""
    return ('<?xml version="1.0" encoding="UTF-8"?>\n'
            '<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:atom="http://www.w3.org/2005/Atom">\n'
            "<channel>\n"
            f"  <title>{TITULO}</title>\n"
            f"  <link>{G.SITE_URL}/semana/</link>\n"
            f'  <atom:link href="{G.SITE_URL}/semana/feed.xml" rel="self" type="application/rss+xml"/>\n'
            f"  <description>{xesc(DESCRICAO)}</description>\n"
            "  <language>en</language>\n" + ultima + "".join(itens) + "</channel>\n</rss>\n")


# ---------------------------------------------------------------- arquivos

def edicoes():
    """resumo.json de cada edição, da mais nova para a mais antiga"""
    if not SAIDA.exists():
        return []
    pastas = sorted((p for p in SAIDA.iterdir() if p.is_dir() and EDICAO.fullmatch(p.name)), reverse=True)
    return [json.loads((p / "resumo.json").read_text(encoding="utf-8")) for p in pastas if (p / "resumo.json").exists()]


def estado_anterior(F):
    """estado.json da edição mais recente antes de F, ou None"""
    if not SAIDA.exists():
        return None
    for p in sorted(SAIDA.iterdir(), reverse=True):
        if EDICAO.fullmatch(p.name) and p.name < F.isoformat() and (p / "estado.json").exists():
            return json.loads((p / "estado.json").read_text(encoding="utf-8"))
    return None


def gerar(F):
    d, agenda = ler_js(BASE), (ler_js(AGENDA)["empresas"] if AGENDA.exists() else {})
    pasta = SAIDA / F.isoformat()
    velho = json.loads((pasta / "resumo.json").read_text(encoding="utf-8")) if (pasta / "resumo.json").exists() else None
    numero = velho["numero"] if velho else 1 + sum(1 for r in edicoes() if r["data"] < F.isoformat())
    r, estado = montar(d, agenda, ler_hist("_indices"), F, estado_anterior(F), numero)
    if velho:  # refeita: mantém a data de publicação, para o RSS não tratar como edição nova
        r["publicado_em"] = velho["publicado_em"]
    pasta.mkdir(parents=True, exist_ok=True)
    (pasta / "resumo.json").write_text(json.dumps(r, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    (pasta / "estado.json").write_text(json.dumps(estado, ensure_ascii=False, separators=(",", ":"), sort_keys=True) + "\n",
                                       encoding="utf-8")
    return r


def desenhar():
    """redesenha todas as edições, o arquivo e o feed a partir dos resumo.json"""
    eds = edicoes()
    for r in eds:
        (SAIDA / r["data"] / "index.html").write_text(pagina_edicao(r), encoding="utf-8")
    SAIDA.mkdir(exist_ok=True)
    (SAIDA / "index.html").write_text(pagina_arquivo(eds), encoding="utf-8")
    (SAIDA / "feed.xml").write_text(feed(eds), encoding="utf-8")
    return eds


def main():
    ap = argparse.ArgumentParser(description="Resumo semanal em inglês (semana/ e semana/feed.xml)")
    ap.add_argument("--data", help="sexta da edição (AAAA-MM-DD); gera mesmo fora da janela de sexta a segunda")
    ap.add_argument("--refazer", action="store_true", help="refaz a edição se ela já existe")
    a = ap.parse_args()
    hoje = datetime.now(FUSO).date()
    F = date.fromisoformat(a.data) if a.data else sexta(hoje)
    if F.weekday() != 4:
        sys.exit(f"{F} não é sexta-feira")
    existe = (SAIDA / F.isoformat() / "resumo.json").exists()
    cotacoes_em = ler_js(BASE).get("cotacoes_em")
    if (a.data and (not existe or a.refazer)) or (not a.data and (deve_gerar(hoje, existe, cotacoes_em) or (existe and a.refazer))):
        r = gerar(F)
        print(f"edição {r['numero']} ({F}) gerada: {r['frase']}")
    elif existe:
        print(f"edição de {F} já existe; só redesenho as páginas")
    else:
        print(f"fora da janela da edição de {F}; só redesenho as páginas")
    eds = desenhar()
    print(f"{len(eds)} edições em semana/ · feed com {min(len(eds), ITENS_FEED)}")


if __name__ == "__main__":
    main()
