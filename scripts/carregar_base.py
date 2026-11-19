"""Carrega data/empresas.js no PostgreSQL (Fase 1 de docs/arquitetura-comercial.md).

Cada execução é uma "carga". Tudo acontece numa única transação:

1. aplica db/schema.sql (idempotente);
2. grava cadastro, tickers, fundamentos, ajustes, preços de fim de exercício e PTAX nas tabelas
   com histórico por intervalo de cargas: só ganha linha nova o que mudou, e o que mudou ou
   sumiu tem a linha anterior encerrada (carga_ate);
3. grava os retratos da carga (cotação, valor de mercado, índice de previsibilidade);
4. remonta a base inteira a partir do Postgres e compara com o JSON, campo a campo. Se algum
   valor divergir, a transação é desfeita e nada fica gravado.

O JSON continua sendo o que o site lê; a base em Postgres anda junto, com histórico, e é o
ponto de partida da API e dos planos pagos.

Uso, a partir da raiz do projeto:
    DATABASE_URL=postgresql://usuario:senha@host/banco python3 scripts/carregar_base.py
    python3 scripts/carregar_base.py --url postgresql://…   # mesma coisa
    python3 scripts/carregar_base.py --forcar                # carrega mesmo que já esteja lá
"""

import json
import os
import sys
import time
from datetime import date
from decimal import Decimal
from pathlib import Path

import psycopg
from psycopg.types.json import Jsonb

RAIZ = Path(__file__).resolve().parent.parent
ARQ = RAIZ / "data" / "empresas.js"
ESQUEMA = RAIZ / "db" / "schema.sql"
MIL = Decimal(1000)

# (código, nome em português, nome em inglês, unidade, natureza). Valores em "brl" chegam em
# R$ mil no JSON e são gravados em reais. Natureza decide a PTAX na conversão para dólar.
METRICAS = [
    ("receita", "Receita líquida", "Net revenue", "brl", "fluxo"),
    ("lucro_bruto", "Lucro bruto", "Gross profit", "brl", "fluxo"),
    ("ebit", "EBIT", "EBIT", "brl", "fluxo"),
    ("lucro_liquido", "Lucro líquido", "Net income", "brl", "fluxo"),
    ("lucro_controladora", "Lucro dos controladores", "Net income to controlling shareholders", "brl", "fluxo"),
    ("ebitda", "EBITDA", "EBITDA", "brl", "fluxo"),
    ("ativo_total", "Ativo total", "Total assets", "brl", "saldo"),
    ("pl", "Patrimônio líquido", "Shareholders' equity", "brl", "saldo"),
    ("pl_controladora", "Patrimônio líquido dos controladores", "Equity attributable to controlling shareholders", "brl", "saldo"),
    ("divida_bruta", "Dívida bruta", "Gross debt", "brl", "saldo"),
    ("caixa", "Caixa e aplicações", "Cash and short-term investments", "brl", "saldo"),
    ("divida_liquida", "Dívida líquida", "Net debt", "brl", "saldo"),
    ("fco", "Caixa operacional", "Operating cash flow", "brl", "fluxo"),
    ("fci", "Caixa de investimentos", "Investing cash flow", "brl", "fluxo"),
    ("fcf", "Caixa de financiamentos", "Financing cash flow", "brl", "fluxo"),
    ("capex", "Investimentos (capex)", "Capital expenditure", "brl", "fluxo"),
    ("dividendos_pagos", "Dividendos e JCP pagos", "Dividends and interest on equity paid", "brl", "fluxo"),
    ("acoes", "Ações em circulação", "Shares outstanding", "acoes", "saldo"),
    ("acoes_on", "Ações ordinárias", "Common shares", "acoes", "saldo"),
    ("acoes_pn", "Ações preferenciais", "Preferred shares", "acoes", "saldo"),
    ("lpa_declarado", "LPA declarado", "Reported EPS", "brl_por_acao", "fluxo"),
    ("fco_operacoes", "Caixa gerado nas operações", "Cash generated from operations", "brl", "fluxo"),
    ("fco_giro", "Variação do capital de giro", "Change in working capital", "brl", "fluxo"),
    ("var_caixa", "Variação do caixa", "Change in cash", "brl", "fluxo"),
    ("fx_caixa", "Variação cambial do caixa", "FX effect on cash", "brl", "fluxo"),
    ("valor_mercado", "Valor de mercado no fim do exercício", "Market cap at fiscal year-end", "brl", "saldo"),
]
CODIGOS = [m[0] for m in METRICAS]
MONETARIAS = {m[0] for m in METRICAS if m[3] == "brl"}
# séries do JSON que não são números: viram linhas da tabela ajuste
MARCAS = {"acoes_estimadas": "acoes_estimadas_pelo_lpa", "acoes_corrigidas": "acoes_escala_corrigida_pelo_preco"}
ORDEM_SERIES = CODIGOS[:-1] + ["acoes_estimadas", "acoes_corrigidas", "valor_mercado"]
ORDEM_12M = ("receita", "lucro_liquido", "lucro_controladora", "ebit", "ebitda", "fco", "capex", "dividendos_pagos",
             "ativo_total", "pl", "pl_controladora", "divida_bruta", "caixa", "divida_liquida")
CHAVES_EMPRESA = ("cnpj", "cd_cvm", "nome", "tickers", "ticker", "setor", "segmento", "controle", "site", "exterior",
                  "units", "setor_b3", "financeiro", "individual", "cotacao", "valor_mercado", "ttm",
                  "valor_mercado_dfp", "acoes_b3", "acoes_cvm", "proventos_12m", "dy12m", "liquidez", "precos_ano", "anos",
                  "series", "score")
CHAVES_TOPO = ("gerado_em", "ano_final", "unidade", "ptax", "ptax_atual", "cotacoes_em", "empresas")


class Divergencia(Exception):
    """A base remontada do Postgres não bate com o JSON; a carga é desfeita."""


# ---------------------------------------------------------------- conversões

def ler_json(caminho: Path = ARQ) -> dict:
    texto = caminho.read_text(encoding="utf-8")
    return json.loads(texto.split("=", 1)[1].rstrip().rstrip(";"))


def dec(v):
    """Número do JSON → Decimal exato (float pelo repr, para não ganhar nem perder dígitos)."""
    if v is None:
        return None
    if isinstance(v, bool):
        raise TypeError("valor lógico onde se esperava número")
    return Decimal(v) if isinstance(v, int) else Decimal(repr(v))


def reais(v_mil):
    return None if v_mil is None else dec(v_mil) * MIL


def num(d, mil=False):
    """Decimal do Postgres → int quando inteiro, float quando não (como no JSON)."""
    if d is None:
        return None
    if mil:
        d = d / MIL
    return int(d) if d == d.to_integral_value() else float(d)


def data(iso):
    return None if iso is None else date.fromisoformat(iso)


# ---------------------------------------------------------------- validação de forma

def conferir_forma(dados: dict):
    """Falha alto quando o JSON ganha um campo que a base ainda não sabe guardar."""
    if tuple(dados) != CHAVES_TOPO:
        raise ValueError(f"chaves do topo mudaram: {list(dados)}")
    if dados["unidade"] != "R$ mil":
        raise ValueError(f"unidade inesperada: {dados['unidade']}")
    for e in dados["empresas"]:
        if set(e) != set(CHAVES_EMPRESA):
            raise ValueError(f"{e.get('ticker')}: campos mudaram: {sorted(set(e) ^ set(CHAVES_EMPRESA))}")
        if set(e["series"]) != set(ORDEM_SERIES):
            raise ValueError(f"{e['ticker']}: séries mudaram: {sorted(set(e['series']) ^ set(ORDEM_SERIES))}"
                             " (inclua a nova em METRICAS)")
        # nos 12 meses, campo que não dá para calcular (EBITDA de banco, por exemplo) fica de fora
        if e["ttm"] and ("ate" not in e["ttm"] or not set(e["ttm"]) - {"ate"} <= set(ORDEM_12M)):
            raise ValueError(f"{e['ticker']}: campos de 12 meses mudaram: {sorted(e['ttm'])}")


# ---------------------------------------------------------------- gravação

def aplicar_esquema(cur):
    cur.execute(ESQUEMA.read_text(encoding="utf-8"))
    cur.executemany(
        "insert into metrica (codigo, ordem, nome_pt, nome_en, unidade, natureza) values (%s, %s, %s, %s, %s, %s) "
        "on conflict (codigo) do update set ordem = excluded.ordem, nome_pt = excluded.nome_pt, "
        "nome_en = excluded.nome_en, unidade = excluded.unidade, natureza = excluded.natureza",
        [(c, k, pt, en, u, n) for k, (c, pt, en, u, n) in enumerate(METRICAS)])


def sincronizar(cur, tabela, chaves, valores, linhas, carga):
    """Deixa as linhas vigentes de `tabela` iguais a `linhas`, guardando o histórico.

    Linha cuja chave sumiu ou cujo valor mudou é encerrada (carga_ate = carga); chave nova ou
    valor novo ganha linha com carga_de = carga. Linha igual não é tocada.
    """
    colunas = chaves + valores
    tmp = f"novo_{tabela}"
    cur.execute(f"drop table if exists {tmp}")
    cur.execute(f"create temp table {tmp} on commit drop as select {', '.join(colunas)} from {tabela} with no data")
    with cur.copy(f"copy {tmp} ({', '.join(colunas)}) from stdin") as cp:
        for linha in linhas:
            cp.write_row(linha)
    mesma_chave = " and ".join(f"v.{c} = n.{c}" for c in chaves)
    mesmo_valor = " and ".join(f"v.{c} is not distinct from n.{c}" for c in valores) or "true"
    cur.execute(f"update {tabela} v set carga_ate = %s where v.carga_ate is null and not exists "
                f"(select 1 from {tmp} n where {mesma_chave} and {mesmo_valor})", [carga])
    encerradas = cur.rowcount
    cur.execute(f"insert into {tabela} ({', '.join(colunas)}, carga_de) "
                f"select {', '.join('n.' + c for c in colunas)}, %s from {tmp} n where not exists "
                f"(select 1 from {tabela} v where v.carga_ate is null and {mesma_chave})", [carga])
    return {"novas": cur.rowcount, "encerradas": encerradas}


def copiar(cur, tabela, colunas, linhas):
    with cur.copy(f"copy {tabela} ({', '.join(colunas)}) from stdin") as cp:
        for linha in linhas:
            cp.write_row(linha)
    return len(linhas)


def ids(cur, sql_insert, linhas, sql_select):
    cur.executemany(sql_insert, linhas)
    cur.execute(sql_select)
    return dict(cur.fetchall())


def carregar(cur, dados: dict) -> tuple:
    """Grava `dados` como uma nova carga na transação de `cur`. Devolve (id da carga, resumo)."""
    conferir_forma(dados)
    aplicar_esquema(cur)
    E = dados["empresas"]
    pa = dados["ptax_atual"] or {}
    cur.execute("insert into carga (gerado_em, ano_final, cotacoes_em, ptax_atual_data, ptax_atual_valor) "
                "values (%s, %s, %s, %s, %s) returning id",
                [dados["gerado_em"], dados["ano_final"], data(dados["cotacoes_em"]), data(pa.get("data")), dec(pa.get("valor"))])
    carga = cur.fetchone()[0]

    emp = ids(cur, "insert into empresa (cd_cvm, cnpj) values (%s, %s) "
                   "on conflict (cd_cvm) do update set cnpj = excluded.cnpj",
              [(e["cd_cvm"], e["cnpj"]) for e in E], "select cd_cvm, id from empresa")
    pap = ids(cur, "insert into papel (empresa_id, ticker) values (%s, %s) on conflict (ticker) do nothing",
              [(emp[e["cd_cvm"]], t) for e in E for t in e["tickers"]], "select ticker, id from papel")

    cadastro, listagem, anual, doze, ajuste, precos = [], [], [], [], [], []
    ret_emp, ret_pap, indice = [], [], []
    for e in E:
        eid, anos, s = emp[e["cd_cvm"]], e["anos"], e["series"]
        cadastro.append((eid, e["nome"], e["setor"], e["segmento"], e["controle"], e["site"],
                         Jsonb(e["setor_b3"]) if e["setor_b3"] is not None else None, Jsonb(e["exterior"]), Jsonb(e["units"])))
        listagem += [(pap[t], k) for k, t in enumerate(e["tickers"])]
        for k, ano in enumerate(anos):
            for m in CODIGOS:
                v = s[m][k]
                anual.append((eid, ano, m, reais(v) if m in MONETARIAS else dec(v)))
            if s["acoes_estimadas"][k]:
                ajuste.append((eid, ano, "acoes", MARCAS["acoes_estimadas"], None))
        ajuste += [(eid, ano, "acoes", MARCAS["acoes_corrigidas"], k) for k, ano in enumerate(s["acoes_corrigidas"])]
        if e["ttm"]:
            ate = data(e["ttm"]["ate"])
            doze += [(eid, ate, m, reais(e["ttm"][m])) for m in ORDEM_12M if m in e["ttm"]]
        for t, serie in e["precos_ano"].items():
            precos += [(pap[t], anos[k], dec(v)) for k, v in enumerate(serie) if v is not None]
        b3 = e["acoes_b3"] or {}
        ret_emp.append((carga, eid, e["ticker"], e["financeiro"], e["individual"], reais(e["valor_mercado"]),
                        reais(e["valor_mercado_dfp"]), b3.get("on"), b3.get("pn"), b3.get("tesouraria"),
                        Jsonb(e["acoes_cvm"]) if e["acoes_cvm"] is not None else None,
                        reais(e["proventos_12m"]), dec(e["liquidez"])))
        for t, c in e["cotacao"].items():
            ret_pap.append((carga, pap[t], dec(c["preco"]), data(c["data"]), dec(c["volume"]), dec(e["dy12m"].get(t))))
        for moeda in ("brl", "usd"):
            x = e["score"][moeda]
            if x:
                indice.append((carga, eid, moeda, "v1", x["total"], Jsonb(x["componentes"]), x["anos"][0], x["anos"][1]))

    resumo = {
        "empresas": len(E),
        "cadastro": sincronizar(cur, "cadastro", ["empresa_id"],
                                ["nome", "setor", "segmento", "controle", "site", "setor_b3", "exterior", "units"], cadastro, carga),
        "listagem": sincronizar(cur, "listagem", ["papel_id"], ["ordem"], listagem, carga),
        "fundamento_anual": sincronizar(cur, "fundamento_anual", ["empresa_id", "exercicio", "metrica"], ["valor"], anual, carga),
        "fundamento_12m": sincronizar(cur, "fundamento_12m", ["empresa_id", "ate", "metrica"], ["valor"], doze, carga),
        "ajuste": sincronizar(cur, "ajuste", ["empresa_id", "exercicio", "metrica", "regra"], ["ordem"], ajuste, carga),
        "preco_fim_exercicio": sincronizar(cur, "preco_fim_exercicio", ["papel_id", "exercicio"], ["fechamento"], precos, carga),
        "ptax_anual": sincronizar(cur, "ptax_anual", ["ano"], ["media", "fim"],
                                  [(int(a), dec(p["media"]), dec(p["fim"])) for a, p in dados["ptax"].items()], carga),
        "retrato_empresa": copiar(cur, "retrato_empresa",
                                  ["carga_id", "empresa_id", "ticker_principal", "financeiro", "individual", "valor_mercado",
                                   "valor_mercado_dfp", "acoes_on", "acoes_pn", "tesouraria", "acoes_cvm", "proventos_12m", "liquidez"], ret_emp),
        "retrato_papel": copiar(cur, "retrato_papel", ["carga_id", "papel_id", "preco", "data", "volume", "dy12m"], ret_pap),
        "indice": copiar(cur, "indice", ["carga_id", "empresa_id", "moeda", "metodologia", "total", "componentes",
                                         "ano_ini", "ano_fim"], indice),
    }
    cur.execute("update carga set resumo = %s where id = %s", [Jsonb(resumo), carga])
    return carga, resumo


# ---------------------------------------------------------------- leitura (remonta o JSON de uma carga)

def exportar(cur, carga: int) -> dict:
    """Remonta, a partir do Postgres, o mesmo dicionário que data/empresas.js tinha na carga."""
    p = {"c": carga}
    vig = "{a}.carga_de <= %(c)s and ({a}.carga_ate is null or {a}.carga_ate > %(c)s)"

    cur.execute("select gerado_em, ano_final, cotacoes_em, ptax_atual_data, ptax_atual_valor from carga where id = %(c)s", p)
    gerado_em, ano_final, cotacoes_em, pa_data, pa_valor = cur.fetchone()
    cur.execute(f"select ano, media, fim from ptax_anual t where {vig.format(a='t')} order by ano", p)
    ptax = {str(a): {"media": num(m), "fim": num(f)} for a, m, f in cur.fetchall()}

    cur.execute(f"""select r.empresa_id, e.cnpj, e.cd_cvm, c.nome, c.setor, c.segmento, c.controle, c.site, c.exterior,
                           c.units, c.setor_b3, r.ticker_principal, r.financeiro, r.individual, r.valor_mercado,
                           r.valor_mercado_dfp, r.acoes_on, r.acoes_pn, r.tesouraria, r.acoes_cvm, r.proventos_12m, r.liquidez
                    from retrato_empresa r join empresa e on e.id = r.empresa_id
                    join cadastro c on c.empresa_id = r.empresa_id and {vig.format(a='c')}
                    where r.carga_id = %(c)s""", p)
    E = {}
    for (eid, cnpj, cd_cvm, nome, setor, segmento, controle, site, exterior, units, setor_b3, ticker, fin, ind,
         vm, vm_dfp, on, pn, tes, cvm, prov, liq) in cur.fetchall():
        E[eid] = {
            "cnpj": cnpj, "cd_cvm": cd_cvm, "nome": nome, "tickers": [], "ticker": ticker, "setor": setor,
            "segmento": segmento, "controle": controle, "site": site, "exterior": exterior, "units": units,
            "setor_b3": setor_b3, "financeiro": fin, "individual": ind, "cotacao": {}, "valor_mercado": num(vm, True),
            "ttm": None, "valor_mercado_dfp": num(vm_dfp, True),
            "acoes_b3": None if on is None and pn is None and tes is None else {"on": on, "pn": pn, "tesouraria": tes},
            "acoes_cvm": cvm,
            "proventos_12m": num(prov, True), "dy12m": {}, "liquidez": num(liq), "precos_ano": {}, "anos": [],
            "series": {}, "score": {"brl": None, "usd": None},
        }

    cur.execute(f"""select p.empresa_id, p.ticker from listagem l join papel p on p.id = l.papel_id
                    where {vig.format(a='l')} order by p.empresa_id, l.ordem""", p)
    for eid, t in cur.fetchall():
        E[eid]["tickers"].append(t)

    cur.execute(f"select empresa_id, exercicio, metrica, valor from fundamento_anual f where {vig.format(a='f')}", p)
    anual = {}
    for eid, ano, m, v in cur.fetchall():
        anual.setdefault(eid, {}).setdefault(ano, {})[m] = num(v, m in MONETARIAS)
    cur.execute(f"select empresa_id, exercicio, regra from ajuste a where {vig.format(a='a')} order by ordem, exercicio", p)
    marcas = {}
    for eid, ano, regra in cur.fetchall():
        marcas.setdefault(eid, {}).setdefault(regra, []).append(ano)
    for eid, e in E.items():
        por_ano = anual.get(eid, {})
        e["anos"] = sorted(por_ano)
        mk = marcas.get(eid, {})
        estimadas = set(mk.get(MARCAS["acoes_estimadas"], []))
        for m in ORDEM_SERIES:
            if m == "acoes_estimadas":
                e["series"][m] = [a in estimadas for a in e["anos"]]
            elif m == "acoes_corrigidas":
                e["series"][m] = mk.get(MARCAS["acoes_corrigidas"], [])
            else:
                e["series"][m] = [por_ano[a].get(m) for a in e["anos"]]

    cur.execute(f"select empresa_id, ate, metrica, valor from fundamento_12m f where {vig.format(a='f')}", p)
    doze = {}
    for eid, ate, m, v in cur.fetchall():
        doze.setdefault(eid, {"ate": ate.isoformat()})[m] = num(v, True)
    for eid, x in doze.items():
        E[eid]["ttm"] = {"ate": x["ate"], **{m: x[m] for m in ORDEM_12M if m in x}}

    cur.execute(f"""select p.empresa_id, p.ticker, f.exercicio, f.fechamento from preco_fim_exercicio f
                    join papel p on p.id = f.papel_id where {vig.format(a='f')}""", p)
    precos = {}
    for eid, t, ano, v in cur.fetchall():
        precos.setdefault(eid, {}).setdefault(t, {})[ano] = num(v)
    for eid, por_ticker in precos.items():
        e = E[eid]
        # mesma ordem de tickers da base
        for t in sorted(por_ticker, key=lambda x: e["tickers"].index(x) if x in e["tickers"] else 99):
            e["precos_ano"][t] = [por_ticker[t].get(a) for a in e["anos"]]

    cur.execute("""select p.empresa_id, p.ticker, r.preco, r.data, r.volume, r.dy12m from retrato_papel r
                   join papel p on p.id = r.papel_id where r.carga_id = %(c)s""", p)
    for eid, t, preco, d, vol, dy in sorted(cur.fetchall(), key=lambda x: (x[0], E[x[0]]["tickers"].index(x[1]))):
        E[eid]["cotacao"][t] = {"preco": num(preco), "data": d.isoformat(), "volume": num(vol)}
        if dy is not None:
            E[eid]["dy12m"][t] = num(dy)

    cur.execute("select empresa_id, moeda, total, componentes, ano_ini, ano_fim from indice where carga_id = %(c)s", p)
    for eid, moeda, total, comp, ini, fim in cur.fetchall():
        E[eid]["score"][moeda] = {"total": total, "componentes": comp, "anos": [ini, fim]}

    empresas = sorted(({k: e[k] for k in CHAVES_EMPRESA} for e in E.values()), key=lambda e: e["ticker"])
    return {
        "gerado_em": gerado_em, "ano_final": ano_final, "unidade": "R$ mil", "ptax": ptax,
        "ptax_atual": {"data": pa_data.isoformat(), "valor": num(pa_valor)} if pa_data else None,
        "cotacoes_em": cotacoes_em.isoformat() if cotacoes_em else None, "empresas": empresas,
    }


def comparar(a, b, caminho="", limite=20) -> list:
    """Diferenças entre duas estruturas do JSON. Números comparam por valor; lógico só com lógico."""
    dif = []

    def visita(x, y, c):
        if len(dif) >= limite:
            return
        if isinstance(x, bool) or isinstance(y, bool):
            if type(x) is not type(y) or x != y:
                dif.append(f"{c}: {x!r} ≠ {y!r}")
        elif isinstance(x, (int, float)) and isinstance(y, (int, float)):
            if x != y:
                dif.append(f"{c}: {x!r} ≠ {y!r}")
        elif isinstance(x, dict) and isinstance(y, dict):
            for k in x.keys() | y.keys():
                if k not in x or k not in y:
                    dif.append(f"{c}.{k}: só de um lado")
                else:
                    visita(x[k], y[k], f"{c}.{k}")
        elif isinstance(x, list) and isinstance(y, list):
            if len(x) != len(y):
                dif.append(f"{c}: {len(x)} itens ≠ {len(y)}")
            else:
                for i, (u, v) in enumerate(zip(x, y)):
                    visita(u, v, f"{c}[{i}]")
        elif x != y:
            dif.append(f"{c}: {x!r} ≠ {y!r}")

    visita(a, b, caminho or "base")
    return dif


def publicar(conn, dados: dict) -> tuple:
    """Carrega e confere na mesma transação; com divergência, desfaz e levanta Divergencia."""
    try:
        with conn.cursor() as cur:
            carga, resumo = carregar(cur, dados)
            dif = comparar(dados, exportar(cur, carga))
            if dif:
                raise Divergencia("a base remontada do Postgres não bate com o JSON:\n  " + "\n  ".join(dif))
        conn.commit()
        return carga, resumo
    except Exception:
        conn.rollback()
        raise


def main():
    args = sys.argv[1:]
    url = args[args.index("--url") + 1] if "--url" in args else os.environ.get("DATABASE_URL")
    if not url:
        sys.exit("defina DATABASE_URL ou passe --url postgresql://…")
    dados = ler_json()
    inicio = time.time()
    with psycopg.connect(url) as conn:
        if "--forcar" not in args:
            with conn.cursor() as cur:
                cur.execute("select to_regclass('carga') is not null")
                if cur.fetchone()[0]:
                    cur.execute("select id from carga where gerado_em = %s", [dados["gerado_em"]])
                    ja = cur.fetchone()
                    if ja:
                        print(f"base de {dados['gerado_em']} já está na carga {ja[0]}; nada a fazer (use --forcar)")
                        return
            conn.rollback()
        try:
            carga, resumo = publicar(conn, dados)
        except Divergencia as erro:
            sys.exit(f"carga desfeita: {erro}")
    print(f"carga {carga} publicada em {time.time() - inicio:.1f}s · {resumo['empresas']} empresas · conferida com o JSON")
    for tabela, r in resumo.items():
        if isinstance(r, dict):
            print(f"  {tabela:20} {r['novas']:>7} novas  {r['encerradas']:>6} encerradas")
        elif tabela != "empresas":
            print(f"  {tabela:20} {r:>7} linhas")


if __name__ == "__main__":
    main()
