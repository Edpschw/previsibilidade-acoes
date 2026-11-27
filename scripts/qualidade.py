"""Controle de qualidade: cruzamentos entre fontes e os dados da aba Qualidade (#/qualidade).

Chamado no fim de scripts/auditar.py, que já mede a cobertura e roda as regras de plausibilidade. Este
módulo soma os cruzamentos: o mesmo número, lido em duas fontes ou por dois caminhos de leitura, tem de
bater. Cada cruzamento diz quantos casos testou, quantos passaram e quais falharam, com os dois valores.

    CVM          identidades das demonstrações (o fluxo de caixa fecha, PL ≤ ativo, lucro bruto ≤ receita,
                 EBITDA ≥ EBIT, tesouraria ≤ ações emitidas), LPA calculado × LPA declarado na DRE e
                 12 meses (ITR) × exercício (DFP)
    CVM × B3     ações da composição do capital × ficha da B3; valor de mercado pelas ações da B3 × da DFP
    B3 × B3      cotação da base × histórico diário (dois leitores do COTAHIST); preço de fim de exercício
                 × histórico; agenda de proventos (ficha) × página de eventos corporativos, e pagamento depois
                 da data-com; desdobramento ou grupamento × salto do preço no dia; toda empresa da base acima
                 do corte de liquidez
    BCB          PTAX média e de fim de ano da base × série diária do Banco Central
    Atualização  data de cada fonte contra a data da base

Escreve:
    data/qualidade.js               window.QUALIDADE; a aba carrega só quando abre
    data/qualidade_historico.json   um resumo por pregão, para o gráfico da evolução

Os nomes e as explicações de cada cruzamento ficam em qualidade.js (raiz), em português e inglês.
"""

import json
import statistics
import sys
from collections import Counter, defaultdict
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import resumo as R  # noqa: E402  (leitura do histórico diário: datas, preços, PTAX)

RAIZ = Path(__file__).resolve().parent.parent
SAIDA = RAIZ / "data" / "qualidade.js"
HISTORICO = RAIZ / "data" / "qualidade_historico.json"
AGENDA = RAIZ / "data" / "agenda.js"
MAX_FALHAS = 3000       # falhas guardadas por cruzamento: todas, para o filtro de setor e o controle por empresa
MAX_HISTORICO = 400     # pregões no gráfico da evolução
# cruzamentos que as regras da auditoria não cobrem: entram na nota de cada empresa com este peso
PESO_NOVOS = {"acoes_cvm_b3": "média", "cotacao_hist": "alta", "preco_ano_hist": "baixa", "agenda_hist": "média",
              "eventos_preco": "baixa", "ebitda_ebit": "baixa", "ttm_anual": "baixa"}
PENALIDADE = {"alta": 25, "média": 10, "baixa": 3, "info": 0}
LIQUIDEZ_SAIDA = 500_000   # o mesmo de scripts/processar.py: abaixo disso a empresa sai da base


class Checagem:
    """Um cruzamento: casos testados, quantos passaram e as falhas com os dois valores comparados, no total
    e por empresa (ticker principal), para a aba filtrar por setor e montar o controle por empresa."""

    def __init__(self, id_, grupo):
        self.id, self.grupo, self.testados, self.ok, self.falhas, self.por_empresa = id_, grupo, 0, 0, [], {}

    def caso(self, passou, emp=None, **falha):
        self.testados += 1
        self.ok += 1 if passou else 0
        if emp:
            pe = self.por_empresa.setdefault(emp, [0, 0])
            pe[0] += 1
            pe[1] += 1 if passou else 0
        if not passou:
            if emp:
                falha["e"] = emp
            self.falhas.append(falha)

    def saida(self):
        out = {"id": self.id, "grupo": self.grupo, "testados": self.testados, "ok": self.ok,
               "n_falhas": len(self.falhas), "falhas": self.falhas[:MAX_FALHAS]}
        if self.por_empresa:  # só os cruzamentos gerais (PTAX) ficam sem empresa
            out["por_empresa"] = self.por_empresa
        return out


def _r(v, casas=4):
    return None if v is None else round(v, casas)


# ---------------------------------------------------------------- CVM

def identidades(d):
    """o que a própria demonstração precisa respeitar"""
    dfc, bruto, pla, ebt, ttm = (Checagem("dfc", "cvm"), Checagem("bruto_receita", "cvm"), Checagem("pl_ativo", "cvm"),
                                 Checagem("ebitda_ebit", "cvm"), Checagem("ttm_anual", "cvm"))
    for e in d["empresas"]:
        s, anos, tk = e["series"], e["anos"], e["ticker"]
        for k, ano in enumerate(anos):
            fco, fci, fcf, vc = s["fco"][k], s["fci"][k], s["fcf"][k], s["var_caixa"][k]
            if None not in (fco, fci, fcf, vc):
                soma = fco + fci + fcf + (s["fx_caixa"][k] or 0)
                escala = max(abs(fco), abs(fci), abs(fcf), 1)
                dfc.caso(abs(soma - vc) <= max(0.02 * escala, 1000), emp=tk, t=tk, ano=ano, a=soma, b=vc)
            at, pl = s["ativo_total"][k], s["pl"][k]
            if at is not None and pl is not None:
                pla.caso(at > 0 and pl <= at * 1.01, emp=tk, t=tk, ano=ano, a=pl, b=at)
            if e["financeiro"]:
                continue
            lb, rec = s["lucro_bruto"][k], s["receita"][k]
            if lb is not None and rec and rec > 0:
                bruto.caso(lb <= rec * 1.01, emp=tk, t=tk, ano=ano, a=lb, b=rec)
            eb, ebit = s["ebitda"][k], s["ebit"][k]
            if eb is not None and ebit is not None:
                ebt.caso(eb >= ebit - max(abs(ebit) * 0.01, 1000), emp=tk, t=tk, ano=ano, a=eb, b=ebit)
        t12 = e.get("ttm") or {}
        rec = s["receita"][-1]
        if t12.get("receita") and rec and rec > 0:
            ttm.caso(0.5 <= t12["receita"] / rec <= 2, emp=tk, t=tk, ano=t12["ate"], a=t12["receita"], b=rec)
    return [dfc, bruto, pla, ebt, ttm]


def lpa(d):
    """LPA calculado (lucro da controladora ÷ ações) × LPA declarado na DRE, como em scripts/auditar.py"""
    c, pontos = Checagem("lpa", "cvm"), []
    for e in d["empresas"]:
        s, anos, tk = e["series"], e["anos"], e["ticker"]
        estimadas = s.get("acoes_estimadas") or [False] * len(anos)
        for i, ano in enumerate(anos):
            lpa_d, ac, luc = s["lpa_declarado"][i], s["acoes"][i], s["lucro_controladora"][i]
            if estimadas[i] or not (lpa_d and ac and luc) or abs(lpa_d) < 0.05:
                continue  # ações estimadas pelo próprio LPA: comparar seria circular
            lpa_c = luc * 1000 / ac
            media = (ac + s["acoes"][i - 1]) / 2 if i and s["acoes"][i - 1] else ac
            ok = 0.67 < lpa_c / lpa_d < 1.5 or 0.67 < luc * 1000 / media / lpa_d < 1.5
            c.caso(ok, emp=tk, t=tk, ano=ano, a=_r(lpa_c), b=_r(lpa_d))
            pontos.append([_r(lpa_c, 3), _r(lpa_d, 3), 1 if ok else 0, tk])
    return c, pontos


# ---------------------------------------------------------------- CVM × B3

def cvm_b3(d):
    acoes, vm = Checagem("acoes_cvm_b3", "cvm_b3"), Checagem("vm_b3_dfp", "cvm_b3")
    tes = Checagem("tesouraria", "cvm")
    pontos = []
    for e in d["empresas"]:
        tk = e["ticker"]
        cv, b3 = e.get("acoes_cvm"), e.get("acoes_b3")
        if cv:
            tes.caso(0 <= cv.get("tesouraria_on", 0) <= cv["on"] and 0 <= cv.get("tesouraria_pn", 0) <= cv["pn"], emp=tk,
                     t=tk, data=cv.get("data"), a=cv.get("tesouraria_on", 0) + cv.get("tesouraria_pn", 0), b=cv["on"] + cv["pn"])
        if cv and b3:
            a = cv["on"] + cv["pn"] - cv.get("tesouraria_on", 0) - cv.get("tesouraria_pn", 0)
            b = b3["on"] + b3["pn"] - b3.get("tesouraria", 0)
            if a > 0 and b > 0:
                ok = abs(a / b - 1) <= 0.05
                acoes.caso(ok, emp=tk, t=tk, data=cv.get("data"), a=a, b=b)
                pontos.append([a, b, 1 if ok else 0, tk])
        v, vd = e.get("valor_mercado"), e.get("valor_mercado_dfp")
        if v and vd and vd > 0:
            vm.caso(0.8 < v / vd < 1.25, emp=tk, t=tk, ano=e["anos"][-1], a=v, b=vd)
    return [tes, acoes, vm], pontos


# ---------------------------------------------------------------- B3 × B3

def b3_b3(d, agenda, hist=R.ler_hist):
    cot, fim, ag, ev = (Checagem("cotacao_hist", "b3"), Checagem("preco_ano_hist", "b3"),
                        Checagem("agenda_hist", "b3"), Checagem("eventos_preco", "b3"))
    datas_ag, escopo = Checagem("agenda_datas", "b3"), Checagem("escopo_liquidez", "b3")
    principal = {t: e["ticker"] for e in d["empresas"] for t in e["tickers"]}     # PETR3 → PETR4
    por_cnpj = {e.get("cnpj"): e["ticker"] for e in d["empresas"]}
    for e in d["empresas"]:
        escopo.caso((e.get("liquidez") or 0) >= LIQUIDEZ_SAIDA, emp=e["ticker"], t=e["ticker"],
                    a=e.get("liquidez") or 0, b=LIQUIDEZ_SAIDA)
    cache = {}

    def serie(t):
        if t not in cache:
            h = hist(t)
            cache[t] = (h, R.datas(h), R.precos(h)) if h else None
        return cache[t]

    for e in d["empresas"]:
        tk = e["ticker"]
        for t, c in e["cotacao"].items():
            sr = serie(t)
            if not sr:
                continue
            alvo = date.fromisoformat(c["data"])
            r = R.no_dia(sr[1], sr[2], alvo)
            if r:
                cot.caso(r[0] == alvo and abs(r[1] - c["preco"]) <= max(0.005, c["preco"] * 1e-4), emp=tk,
                         t=t, data=c["data"], a=c["preco"], b=_r(r[1]))
        for t, lst in e["precos_ano"].items():
            sr = serie(t)
            if not sr:
                continue
            for k, ano in enumerate(e["anos"]):
                p = lst[k] if k < len(lst) else None
                if p is None or ano < sr[1][0].year:
                    continue
                r = R.no_dia(sr[1], sr[2], date(ano, 12, 31))
                if r and r[0].year == ano:
                    fim.caso(abs(r[1] - p) <= max(0.005, p * 1e-3), emp=tk, t=t, ano=ano, a=p, b=_r(r[1]))
    for cnpj, itens in agenda.items():
        for x in itens:
            emp = por_cnpj.get(cnpj) or principal.get(x["t"])
            if x.get("pag"):
                datas_ag.caso(x["pag"] >= x["com"], emp=emp, t=x["t"], data=x["com"], a=x["com"], b=x["pag"])
            sr = serie(x["t"])
            if not sr:
                continue
            iguais = [p for p in sr[0].get("pv") or [] if p[0] == x["com"] and p[2] == x["tipo"]]
            ok = any(abs(p[1] - x["valor"]) <= max(1e-6, abs(x["valor"]) * 0.01) for p in iguais)
            ag.caso(ok, emp=emp, t=x["t"], data=x["com"], a=x["valor"], b=_r(iguais[0][1], 6) if iguais else None)
    for t, sr in list(cache.items()):
        if not sr:
            continue
        h, ds, ps = sr
        for d_ex, fator, *_ in h.get("ev") or []:
            dia = date.fromisoformat(d_ex)
            i = next((k for k, x in enumerate(ds) if x >= dia), None)
            if not i or not fator:
                continue
            salto = ps[i - 1] / ps[i]
            ev.caso(0.65 < salto / fator < 1.5, emp=principal.get(t), t=t, data=d_ex, a=_r(salto), b=_r(fator, 6))
    return [cot, fim, ag, datas_ag, ev, escopo]


# ---------------------------------------------------------------- BCB

def ptax(d, hist=R.ler_hist):
    media, fim = Checagem("ptax_media", "bcb"), Checagem("ptax_fim", "bcb")
    ind = hist("_indices") or {}
    if not ind.get("ptax"):
        return [media, fim]
    por_ano = defaultdict(list)
    for dia, v in zip(R.datas(ind["ptax"]), ind["ptax"]["v"]):
        por_ano[dia.year].append(v)
    for ano_s, x in sorted(d["ptax"].items()):
        vs = por_ano.get(int(ano_s))
        if not vs:
            continue
        if x.get("media"):
            m = statistics.fmean(vs)
            media.caso(abs(m / x["media"] - 1) <= 0.005, ano=int(ano_s), a=x["media"], b=_r(m))
        if x.get("fim"):
            fim.caso(abs(vs[-1] / x["fim"] - 1) <= 0.001, ano=int(ano_s), a=x["fim"], b=_r(vs[-1]))
    return [media, fim]


# ---------------------------------------------------------------- atualização

def atualizacao(d, agenda_gerada, hist=R.ler_hist):
    """data de cada fonte contra a da base: tudo do mesmo processamento"""
    base = date.fromisoformat(d["gerado_em"][:10])
    ind = hist("_indices") or {}
    datas_itr = [date.fromisoformat(e["ttm"]["ate"]) for e in d["empresas"] if e.get("ttm")]
    itr_recente = max(datas_itr) if datas_itr else None
    com_itr = sum(1 for x in datas_itr if itr_recente and (itr_recente - x).days <= 100)
    linhas = [
        {"id": "cotacoes", "data": d["cotacoes_em"], "ok": (base - date.fromisoformat(d["cotacoes_em"])).days <= 5},
        {"id": "ptax", "data": (d.get("ptax_atual") or {}).get("data"),
         "ok": bool(d.get("ptax_atual")) and (base - date.fromisoformat(d["ptax_atual"]["data"])).days <= 5},
        {"id": "historico", "data": (ind.get("gerado_em") or "")[:10] or None,
         "ok": bool(ind.get("gerado_em")) and abs((base - date.fromisoformat(ind["gerado_em"][:10])).days) <= 1},
        {"id": "agenda", "data": (agenda_gerada or "")[:10] or None,
         "ok": bool(agenda_gerada) and abs((base - date.fromisoformat(agenda_gerada[:10])).days) <= 1},
        {"id": "dfp", "data": str(d["ano_final"]), "ok": d["ano_final"] >= base.year - (1 if base.month > 4 else 2)},
        {"id": "itr", "data": itr_recente.isoformat() if itr_recente else None,
         "ok": bool(datas_itr) and com_itr / len(d["empresas"]) >= 0.8, "n": com_itr, "total": len(d["empresas"])},
    ]
    return linhas


# ---------------------------------------------------------------- montagem

def notas(d, achados, checagens):
    """nota de confiabilidade por empresa: 100 menos as ocorrências (regras da auditoria e cruzamentos novos)"""
    por_t = {t: e["ticker"] for e in d["empresas"] for t in e["tickers"]}
    cont = defaultdict(Counter)
    for a in achados:
        cont[a["ticker"]][a["sev"]] += 1
    for c in checagens:
        sev = PESO_NOVOS.get(c["id"])
        if not sev:
            continue
        for f in c["falhas"]:
            if f.get("t") in por_t:
                cont[por_t[f["t"]]][sev] += 1
    out = []
    for e in d["empresas"]:
        n = cont[e["ticker"]]
        nota = max(0, 100 - sum(PENALIDADE[s] * q for s, q in n.items()))
        out.append({"t": e["ticker"], "nome": R.G.nome_curto(e["nome"]), "nota": nota,
                    "alta": n["alta"], "media": n["média"], "baixa": n["baixa"], "info": n["info"]})
    out.sort(key=lambda x: (-x["nota"], x["alta"] + x["media"] + x["baixa"], x["t"]))
    return out


def gerar(d, achados, cobertura, externo):
    """roda os cruzamentos e escreve data/qualidade.js e o histórico; devolve o resumo do dia"""
    agenda = R.ler_js(AGENDA) if AGENDA.exists() else {"empresas": {}, "gerado_em": None}
    c_lpa, pontos_lpa = lpa(d)
    c_cvm_b3, pontos_acoes = cvm_b3(d)
    checagens = [c.saida() for c in identidades(d) + [c_lpa] + c_cvm_b3 + b3_b3(d, agenda["empresas"]) + ptax(d)]
    testados = sum(c["testados"] for c in checagens)
    ok = sum(c["ok"] for c in checagens)
    sev = Counter(a["sev"] for a in achados)
    dia = {"data": d["cotacoes_em"], "testes": testados, "ok": ok, "alta": sev["alta"], "media": sev["média"],
           "baixa": sev["baixa"], "info": sev["info"], "cobertura": cobertura["cobertura"], "empresas": len(d["empresas"])}
    historico = json.loads(HISTORICO.read_text(encoding="utf-8")) if HISTORICO.exists() else []
    historico = [h for h in historico if h["data"] != dia["data"]] + [dia]
    historico = sorted(historico, key=lambda h: h["data"])[-MAX_HISTORICO:]
    HISTORICO.write_text(json.dumps(historico, ensure_ascii=False, indent=0) + "\n", encoding="utf-8")
    dados = {
        "gerado_em": d["gerado_em"], "cotacoes_em": d["cotacoes_em"], "ano_final": d["ano_final"],
        "resumo": dia, "cobertura": cobertura, "atualizacao": atualizacao(d, agenda.get("gerado_em")),
        "checagens": checagens, "externo": externo,
        "achados": [{"t": a["ticker"], "sev": a["sev"], "regra": a["regra"], "msg": a["msg"]} for a in achados],
        "empresas": notas(d, achados, checagens),
        "pontos": {"lpa": pontos_lpa, "acoes": pontos_acoes},
        "historico": historico,
    }
    js = json.dumps(dados, ensure_ascii=False, separators=(",", ":"))
    SAIDA.write_text("// Gerado por scripts/qualidade.py (chamado por scripts/auditar.py) — não edite à mão.\n"
                     f"window.QUALIDADE={js};\n", encoding="utf-8")
    print(f"qualidade: {len(checagens)} cruzamentos, {ok:,} de {testados:,} casos passaram ({ok / max(testados, 1):.2%}) → {SAIDA.name}")
    return dia
