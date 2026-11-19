"""Audita data/empresas.js contra as próprias fontes e contra a B3, e gera auditoria.md.

Uso, a partir da raiz do projeto (depois de scripts/processar.py):
    python3 scripts/auditar.py            # só fontes locais
    python3 scripts/auditar.py --externo  # também confere cotação e valor de mercado na brapi.dev
    python3 scripts/auditar.py --trava    # sai com código 2 se a base piorou em relação à última aprovada

A lógica tem três camadas:

1. Cobertura (funil). Parte do que a B3 de fato negocia: todo emissor com ação ON/PN/unit
   negociada nos últimos pregões deveria estar na base. Cada ausência ganha um motivo
   (sem ticker no FCA, sem DFP, histórico curto, demonstração antiga…). O caminho inverso
   também: empresa da base que não negocia.
2. Consistência interna. Cada empresa passa por regras que comparam números entre si
   (LPA calculado × LPA declarado na DRE, PL × ativo, saltos na quantidade de ações,
   margens e múltiplos fora de faixa plausível, cotação parada…).
3. Referência externa. Contagem de empresas listadas divulgada pela imprensa/B3/CVM e,
   com --externo, preço e valor de mercado de uma amostra na brapi.dev.
"""

import json
import re
import statistics
import sys
import urllib.request
import zipfile
from collections import Counter, defaultdict
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import processar as P  # noqa: E402

RAIZ = P.RAIZ
RELATORIO = RAIZ / "auditoria.md"
RESUMO = RAIZ / "auditoria_resumo.json"  # último resumo aprovado; base da --trava

# Referências públicas consultadas em nov/2026 (ver auditoria.md)
REFERENCIAS = [
    ("FGV, jan/2026: empresas listadas na B3", "pouco mais de 370"),
    ("Bpmoney, 2026: companhias listadas na B3", "393"),
    ("CVM, Boletim Econômico 111 (3º tri/2026): companhias abertas, estrangeiras e incentivadas com registro ativo", "684"),
]

ESPECIE_ACAO = re.compile(r"^(ON|PN|PNA|PNB|PNC|PND|PNE|PNF|PNG|UNT)\b")


def carregar_base():
    texto = P.SAIDA.read_text(encoding="utf-8")
    return json.loads(texto.split("=", 1)[1].rstrip().rstrip(";"))


# ---------------------------------------------------------------- 1. cobertura

def negociados_b3(pregoes=21):
    """Ações (ON/PN/units) com negócio nos últimos pregões baixados: {ticker: {nome, volume, dias}}."""
    arquivos = sorted(P.FONTES.glob("cotahist/COTAHIST_D*.ZIP"),
                      key=lambda p: (p.stem[-4:], p.stem[-6:-4], p.stem[-8:-6]))[-pregoes:]
    out = {}
    for arq in arquivos:
        with zipfile.ZipFile(arq) as zf, zf.open(zf.namelist()[0]) as f:
            for linha in f:
                if linha[:2] != b"01" or linha[24:27] != b"010" or linha[10:12] not in P.CODBDI:
                    continue
                especie = linha[39:49].decode("latin-1").strip()
                if not ESPECIE_ACAO.match(especie):
                    continue  # BDR, fundos, recibos, direitos…
                t = linha[12:24].strip().decode("latin-1")
                r = out.setdefault(t, {"nome": linha[27:39].decode("latin-1").strip(), "especie": especie,
                                       "volume": 0.0, "dias": 0})
                r["volume"] += int(linha[170:188]) / 100
                r["dias"] += 1
    for r in out.values():
        r["volume"] /= max(len(arquivos), 1)
    return out, len(arquivos)


def motivo_ausencia(cnpj, info, base_dfp):
    """Repete os filtros de processar.main() para dizer por que uma empresa do FCA ficou de fora."""
    if cnpj not in base_dfp:
        return "sem nenhuma DFP (nem consolidada nem individual) nos arquivos de 2010 em diante"
    res = P.montar_series(base_dfp[cnpj])
    if not res:
        return "DFP sem receita identificada (plano de contas fora do padrão)"
    anos, _ = res
    if anos[-1] < P.ANO_FINAL - 1:
        return f"última DFP é de {anos[-1]}"
    return "filtro desconhecido"


# ---------------------------------------------------------------- 2. consistência

def checar_empresa(e, d):
    s, anos, achados = e["series"], e["anos"], []

    def add(sev, regra, msg):
        achados.append({"ticker": e["ticker"], "nome": e["nome"], "sev": sev, "regra": regra, "msg": msg})

    n = len(anos)
    ult = n - 1

    # buracos no histórico
    faltam = [a for a in range(anos[0], anos[-1] + 1) if a not in anos]
    if faltam:
        add("média", "buraco no histórico", f"sem DFP em {', '.join(map(str, faltam))}")

    # LPA calculado (lucro controladora / ações) × LPA ON declarado na DRE
    for i in range(n):
        lpa_d, ac, luc = s["lpa_declarado"][i], s["acoes"][i], s["lucro_controladora"][i]
        if s.get("acoes_estimadas", [False] * n)[i] or not (lpa_d and ac and luc) or abs(lpa_d) < 0.05:
            continue
        lpa_c = luc * 1000 / ac
        razao = lpa_c / lpa_d
        media = (ac + s["acoes"][i - 1]) / 2 if i and s["acoes"][i - 1] else ac
        razao_media = luc * 1000 / media / lpa_d
        if razao < 0 and lpa_d * luc < 0:
            add("baixa" if i < ult else "média", "LPA com sinal trocado na DRE",
                f"{anos[i]}: lucro {luc:,} mas LPA declarado {lpa_d:+.2f} (erro de preenchimento da empresa)")
            continue
        if 0.0007 < abs(razao) < 0.0015:
            add("baixa", "LPA declarado por lote de mil", f"{anos[i]}: declarado R$ {lpa_d:.2f} ≈ 1000 × calculado R$ {lpa_c:.2f} (erro de preenchimento da empresa)")
            continue
        if not 0.67 < razao < 1.5 and not 0.67 < razao_media < 1.5:
            sev = "alta" if i == ult else "baixa"
            add(sev, "LPA divergente", f"{anos[i]}: calculado R$ {lpa_c:.2f} × declarado R$ {lpa_d:.2f} (razão {razao:.2f})")

    # saltos na quantidade de ações sem estimativa (desdobramento, grupamento ou escala trocada)
    for i in range(1, n):
        a0, a1 = s["acoes"][i - 1], s["acoes"][i]
        if a0 and a1 and not s["acoes_estimadas"][i] and not s["acoes_estimadas"][i - 1]:
            r = a1 / a0
            if r > 2.5 or r < 0.4:
                add("baixa", "salto de ações", f"{anos[i-1]}→{anos[i]}: ×{r:.2f} (desdobramento, grupamento, emissão ou escala)")

    # balanço
    at, pl = s["ativo_total"][ult], s["pl"][ult]
    if at is not None and at <= 0:
        add("alta", "ativo não positivo", f"ativo total {at} em {anos[ult]}")
    if at and pl and pl > at * 1.01:
        add("alta", "PL maior que o ativo", f"PL {pl:,} > ativo {at:,} em {anos[ult]}")
    if pl is not None and pl < 0:
        add("info", "PL negativo", f"patrimônio líquido negativo em {anos[ult]} (P/VP e ROE não se aplicam)")

    # resultado
    rec, luc = s["receita"][ult], s["lucro_liquido"][ult]
    if not e["financeiro"] and rec is not None and rec <= 0:
        add("média", "receita não positiva", f"receita {rec} em {anos[ult]}")
    if rec and rec > 0 and luc is not None and abs(luc / rec) > 1.0:
        add("média", "margem líquida extrema", f"{luc / rec:+.0%} em {anos[ult]} (holding, ganho não recorrente ou receita mal identificada)")
    if s["lucro_bruto"][ult] and rec and s["lucro_bruto"][ult] > rec * 1.01 and not e["financeiro"]:
        add("alta", "lucro bruto > receita", f"em {anos[ult]}")
    lc = s["lucro_controladora"][ult]
    if luc and lc and luc > 0 and abs(lc - luc) > abs(luc) * 0.5 and abs(lc - luc) > 50_000:
        add("baixa", "controladora × consolidado", f"lucro da controladora {lc:,} × consolidado {luc:,} em {anos[ult]}")

    # receita: variação anual extrema
    for i in range(1, n):
        r0, r1 = s["receita"][i - 1], s["receita"][i]
        if r0 and r1 and r0 > 0 and r1 > 0 and (r1 / r0 > 5 or r1 / r0 < 0.2):
            add("baixa", "receita salta", f"{anos[i-1]}→{anos[i]}: ×{r1 / r0:.1f}")

    # dividendos
    dv = s["dividendos_pagos"][ult]
    if dv and luc and luc > 0 and dv > 3 * luc:
        add("baixa", "dividendos > 3× lucro", f"pagou {dv:,} com lucro {luc:,} em {anos[ult]}")

    # mercado
    vm = e["valor_mercado"]
    if not e["cotacao"]:
        add("info", "sem cotação", "nenhum negócio nos últimos pregões")
    else:
        for t, c in e["cotacao"].items():
            if c["data"] < d["cotacoes_em"][:8] + "01" and c["data"] < str(date.fromisoformat(d["cotacoes_em"]).replace(day=1)):
                pass
        velhas = [t for t, c in e["cotacao"].items() if (date.fromisoformat(d["cotacoes_em"]) - date.fromisoformat(c["data"])).days > 14]
        if velhas and len(velhas) == len(e["cotacao"]):
            add("média", "cotação parada", f"último negócio de {', '.join(velhas)} há mais de 14 dias")
    if e["cotacao"] and not vm:
        add("alta", "valor de mercado ausente", "há cotação mas não há quantidade de ações")
    if vm:
        lcu, plc = s["lucro_controladora"][ult], s["pl_controladora"][ult]
        if lcu and lcu > 0:
            pe = vm / lcu
            if pe < 1 or pe > 300:
                add("média", "P/L extremo", f"{pe:.1f}x")
        if plc and plc > 0:
            pvp = vm / plc
            if pvp < 0.05 or pvp > 40:
                add("média", "P/VP extremo", f"{pvp:.2f}x")
        if dv and dv / vm > 0.30:
            add("média", "DY acima de 30%", f"{dv / vm:.0%} (dividendo extraordinário ou valor de mercado subestimado)")
    # fluxo de caixa: operacional + investimento + financiamento + câmbio = variação do caixa
    for k in range(n):
        fco, fci, fcf, vc = s["fco"][k], s["fci"][k], s["fcf"][k], s["var_caixa"][k]
        if None in (fco, fci, fcf, vc):
            continue
        soma = fco + fci + fcf + (s["fx_caixa"][k] or 0)
        escala = max(abs(fco), abs(fci), abs(fcf), 1)
        if abs(soma - vc) > max(0.02 * escala, 1000):
            add("alta" if k == ult else "baixa", "fluxo de caixa não fecha",
                f"{anos[k]}: operacional + investimento + financiamento = {soma:,} × variação do caixa declarada {vc:,} "
                "(erro de extração ou de preenchimento)")
    # caixa operacional muito acima do EBITDA: de onde vem a diferença?
    fco, eb = s["fco"][ult], s["ebitda"][ult]
    if not e["financeiro"] and fco and eb and eb > 0 and fco > 2 * eb:
        gap = fco - eb
        giro = s["fco_giro"][ult] or 0
        nao_caixa = (s["fco_operacoes"][ult] or eb) - eb
        if giro >= 0.5 * gap:
            add("info", "caixa operacional > 2× EBITDA", f"{anos[ult]}: {fco:,} × EBITDA {eb:,}; explicado por capital de giro ({giro:,})")
        elif nao_caixa >= 0.5 * gap:
            add("info", "caixa operacional > 2× EBITDA", f"{anos[ult]}: {fco:,} × EBITDA {eb:,}; explicado por itens que não mexem no caixa "
                f"(impairment, provisões: {nao_caixa:,}) — o EBITDA contábil fica abaixo do 'ajustado' que a empresa divulga")
        else:
            add("média", "caixa operacional > 2× EBITDA sem explicação",
                f"{anos[ult]}: {fco:,} × EBITDA {eb:,}; nem capital de giro ({giro:,}) nem ajustes ({nao_caixa:,}) explicam")
    # B3 × DFP: quantidade de ações e valor de mercado
    vd, ab = e.get("valor_mercado_dfp"), e.get("acoes_b3")
    if vm and vd and vd > 0:
        r = vm / vd
        if not 0.8 < r < 1.25:
            add("média", "ações B3 × DFP", f"valor de mercado com ações da B3 hoje é {r:.2f}× o calculado com as da DFP de "
                f"{anos[ult]} (emissão, recompra, grupamento depois do balanço, ou DFP errada); prevalece a B3")
    if e["cotacao"] and not ab:
        add("baixa", "sem ficha na B3", "quantidade de ações vem só da DFP")
    # DY de 12 meses (B3, data-com) × dividendos pagos no exercício (DFP, caixa)
    pv = e.get("proventos_12m")
    if vm and pv is not None and dv is not None and max(pv, dv) > 0.02 * vm:
        if not 0.33 < (pv + 1) / (dv + 1) < 3:
            add("info", "DY 12m × DY do exercício", f"proventos 12m (B3) {pv / vm:.1%} × pagos em {anos[ult]} (DFP) {dv / vm:.1%}")
    # preço atual × fim do último exercício: grupamento ou desdobramento depois do balanço
    for t, c in e["cotacao"].items():
        pa = e["precos_ano"].get(t, [None])[-1]
        if pa and c["preco"] and not 0.25 < c["preco"] / pa < 4:
            add("baixa", "preço mudou de escala", f"{t}: {pa:.2f} no fim de {anos[ult]} → {c['preco']:.2f} hoje (evento societário ou movimento forte)")
    # últimos 12 meses (ITR)
    t12 = e.get("ttm")
    if e["cotacao"] and not t12:
        add("baixa", "sem últimos 12 meses", "sem ITR posterior ao último balanço anual (atraso, exercício fora de jan–dez ou plano de contas)")
    elif t12 and (date.fromisoformat(d["cotacoes_em"]) - date.fromisoformat(t12["ate"])).days > 200:
        add("baixa", "ITR atrasado", f"último ITR é de {t12['ate']}")
    units = [t for t in e["tickers"] if t.endswith("11")]
    for t in units:
        if t not in e.get("units", {}):
            add("baixa", "unit sem composição", f"{t}: composição não reconhecida no FCA")
    if e["individual"]:
        add("info", "só demonstração individual", "a empresa não publica consolidado")
    return achados


# ---------------------------------------------------------------- 3. externo

def conferir_brapi(base, tickers=("PETR4", "VALE3", "ITUB4", "MGLU3")):
    """A brapi.dev libera estes quatro tickers sem chave."""
    url = "https://brapi.dev/api/quote/" + ",".join(tickers)
    req = urllib.request.Request(url, headers={"User-Agent": "previsibilidade-acoes/0.1"})
    with urllib.request.urlopen(req, timeout=30) as r:
        dados = json.load(r)["results"]
    por_t = {t: e for e in base["empresas"] for t in e["tickers"]}
    linhas = []
    for q in dados:
        e = por_t.get(q["symbol"])
        if not e:
            linhas.append((q["symbol"], "ausente na base", "", "", "", ""))
            continue
        nosso_p = e["cotacao"].get(q["symbol"], {}).get("preco")
        nosso_vm = e["valor_mercado"] * 1000 if e["valor_mercado"] else None
        ext_vm = q.get("marketCap")
        dif = f"{nosso_vm / ext_vm - 1:+.1%}" if nosso_vm and ext_vm else "–"
        linhas.append((q["symbol"], f"{nosso_p}", f"{q.get('regularMarketPrice')}",
                       f"{nosso_vm / 1e9:.1f} bi" if nosso_vm else "–", f"{ext_vm / 1e9:.1f} bi" if ext_vm else "–", dif))
    return linhas


# ---------------------------------------------------------------- principal

def main():
    d = carregar_base()
    empresas = d["empresas"]
    na_base = {t: e for e in empresas for t in e["tickers"]}

    print("Releitura de cotações, cadastro e DFP para o funil…")
    anuais, recentes, _ = P.carregar_cotacoes(None)
    negociados = set(recentes) | set(anuais.get(P.ANO_FINAL, {})) | set(anuais.get(P.ANO_FINAL - 1, {}))
    lista_b3 = P.carregar_empresas_b3(False)
    cad = P.carregar_cadastro(False, negociados, lista_b3)
    base_dfp = {}
    for ano in range(P.ANO_INICIAL, P.ANO_FINAL + 1):
        caminho = P.FONTES / "dfp" / f"dfp_cia_aberta_{ano}.zip"
        if caminho.exists():
            P.extrair_ano(zipfile.ZipFile(caminho), ano, set(cad), base_dfp)
    cnpj_por_ticker = {t: c for c, i in cad.items() for t in i["tickers"]}

    print("Lendo pregões recentes da B3…")
    b3, n_pregoes = negociados_b3()
    raizes_b3 = {t[:4] for t in b3}
    # escopo do site: emissores com volume acima do corte de liquidez (processar.LIQUIDEZ_MIN)
    vol_raiz = Counter()
    for t, r in b3.items():
        vol_raiz[t[:4]] += r["volume"]
    raizes_liq = {r for r, v in vol_raiz.items() if v >= P.LIQUIDEZ_MIN}

    # B3 → base
    fora = []
    for t, r in sorted(b3.items(), key=lambda kv: -kv[1]["volume"]):
        if t in na_base or t[:4] not in raizes_liq:
            continue  # na base, ou emissor abaixo do corte de liquidez (fora do escopo)
        cnpj = cnpj_por_ticker.get(t)
        if cnpj:
            motivo = motivo_ausencia(cnpj, cad[cnpj], base_dfp)
        else:
            irmaos = [x for x in na_base if x[:4] == t[:4]]
            motivo = (f"ticker fora do FCA, mas a empresa está na base como {irmaos[0]}" if irmaos
                      else "ticker não aparece no FCA de nenhuma companhia ativa (ticker novo, mudança de código ou registro cancelado)")
        fora.append((t, r, motivo))

    # base → B3
    sem_negocio = [e for e in empresas if not e["cotacao"]]

    # consistência
    achados = [a for e in empresas for a in checar_empresa(e, d)]

    externo = []
    if "--externo" in sys.argv:
        try:
            externo = conferir_brapi(d)
        except Exception as ex:  # noqa: BLE001
            externo = [("erro", str(ex), "", "", "", "")]

    escrever(d, empresas, b3, raizes_b3, n_pregoes, cad, fora, sem_negocio, achados, externo,
             sum(1 for r in lista_b3 if r.get("type") == "1"))

    raizes_base = {t[:4] for e in empresas for t in e["tickers"] if t in b3}
    resumo = {
        "gerado_em": d["gerado_em"],
        "empresas": len(empresas),
        # dos emissores acima do corte de liquidez, quantos estão na base
        "cobertura": round(len(raizes_base & raizes_liq) / max(len(raizes_liq), 1), 4),
        "emissores_negociados": len(raizes_b3),
        "cotacoes_em": d["cotacoes_em"],
        "graves": sorted(f"{a['ticker']}|{a['regra']}" for a in achados if a["sev"] == "alta"),
        "por_severidade": dict(Counter(a["sev"] for a in achados)),
    }
    anterior = json.loads(RESUMO.read_text(encoding="utf-8")) if RESUMO.exists() else None
    problemas = trava(resumo, anterior) if "--trava" in sys.argv else []
    if not problemas:
        RESUMO.write_text(json.dumps(resumo, ensure_ascii=False, indent=1), encoding="utf-8")
    if problemas:
        print("TRAVA DE QUALIDADE: a base nova não deve ser publicada")
        for p in problemas:
            print(f"  - {p}")
        sys.exit(2)


def trava(novo, anterior):
    """Regras para não publicar uma base que piorou. Compara com o último resumo aprovado."""
    problemas = []
    if novo["emissores_negociados"] < 200:
        problemas.append(f"só {novo['emissores_negociados']} emissores negociados: pregões da B3 não foram lidos direito")
    if novo["cobertura"] < 0.97:
        problemas.append(f"cobertura de {novo['cobertura']:.1%} (mínimo 97%)")
    if anterior:
        if anterior.get("cotacoes_em") and novo["cotacoes_em"] < anterior["cotacoes_em"]:
            problemas.append(f"cotações recuaram de {anterior['cotacoes_em']} para {novo['cotacoes_em']} "
                             "(pregão mais recente não foi baixado)")
        if novo["empresas"] < anterior["empresas"] * 0.95:
            problemas.append(f"base encolheu de {anterior['empresas']} para {novo['empresas']} empresas")
        novas = sorted(set(novo["graves"]) - set(anterior["graves"]))
        if len(novas) > 5:
            problemas.append(f"{len(novas)} ocorrências graves novas: {', '.join(novas[:10])}")
    return problemas


def escrever(d, empresas, b3, raizes_b3, n_pregoes, cad, fora, sem_negocio, achados, externo, n_lista_b3):
    sev_ordem = {"alta": 0, "média": 1, "baixa": 2, "info": 3}
    contagem = Counter((a["sev"], a["regra"]) for a in achados)
    raizes_base = {t[:4] for e in empresas for t in e["tickers"] if t in b3}
    linhas = [
        "# Auditoria da base",
        "",
        f"Gerada em {date.today():%d/%m/%Y} sobre `data/empresas.js` de {d['gerado_em']} (balanços até {d['ano_final']}, "
        f"cotações até {d['cotacoes_em']}). Refaça com `python3 scripts/auditar.py --externo`.",
        "",
        "## 1. Cobertura",
        "",
        "| Etapa | Quantidade |",
        "|---|---|",
        f"| Emissores com ação ON/PN/unit negociada na B3 nos últimos {n_pregoes} pregões (raiz do ticker) | {len(raizes_b3)} |",
        f"| Tickers de ação negociados nesse período | {len(b3)} |",
        f"| Emissores de ações na lista oficial da B3 (tipo 1) | {n_lista_b3} |",
        f"| Companhias ativas na CVM com ação na B3 (FCA + lista da B3) | {len(cad)} |",
        f"| Empresas na base | {len(empresas)} |",
        f"| … das quais negociaram no período | {len(empresas) - len(sem_negocio)} |",
        f"| Emissores negociados na B3 que estão na base | {len(raizes_base)} de {len(raizes_b3)} ({len(raizes_base) / len(raizes_b3):.0%}) |",
        "",
        "Referências externas:",
        "",
    ] + [f"- {r[0]}: **{r[1]}**" for r in P_REFS()] + [
        "",
        "Leitura: a B3 conta como \"listada\" toda empresa com registro, inclusive as que quase não negociam e as "
        "de balcão organizado; a CVM soma companhias sem ação em bolsa (só dívida), estrangeiras e incentivadas. "
        "O número comparável é o de emissores com ação negociada, acima.",
        "",
        "### Negociadas na B3 e ausentes da base",
        "",
        "Ordenadas por volume médio diário. Cada linha diz em que etapa a empresa caiu.",
        "",
        "| Ticker | Nome na B3 | Volume/dia | Motivo |",
        "|---|---|---|---|",
    ] + [f"| {t} | {r['nome']} | R$ {r['volume'] / 1e6:,.1f} mi | {m} |" for t, r, m in fora] + [
        "",
        "### Na base sem negócio na B3 no período",
        "",
        ", ".join(f"{e['ticker']} ({P_nome(e['nome'])})" for e in sem_negocio) or "nenhuma",
        "",
        "## 2. Consistência",
        "",
        "| Severidade | Regra | Ocorrências |",
        "|---|---|---|",
    ] + [f"| {s} | {r} | {n} |" for (s, r), n in sorted(contagem.items(), key=lambda kv: (sev_ordem[kv[0][0]], -kv[1]))] + [
        "",
        "### Ocorrências de severidade alta e média",
        "",
        "| Ticker | Empresa | Sev. | Regra | Detalhe |",
        "|---|---|---|---|---|",
    ] + [f"| {a['ticker']} | {P_nome(a['nome'])} | {a['sev']} | {a['regra']} | {a['msg']} |"
         for a in sorted(achados, key=lambda a: (sev_ordem[a["sev"]], a["regra"], a["ticker"])) if a["sev"] in ("alta", "média")] + [
        "",
        "As de severidade baixa e informativas ficam em `auditoria.json`.",
        "",
    ]
    if externo:
        linhas += [
            "## 3. Conferência externa (brapi.dev)",
            "",
            "| Ticker | Cotação base | Cotação brapi | Valor de mercado base | brapi | Diferença |",
            "|---|---|---|---|---|---|",
        ] + [f"| {' | '.join(x)} |" for x in externo] + [
            "",
            "A base usa a quantidade de ações atual informada pela B3, menos as ações em tesouraria do último "
            "balanço (mesmo critério do LPA). Fontes de mercado variam: algumas usam o total emitido, outras "
            "uma contagem defasada. A cotação é o teste mais direto, e deve bater exatamente.",
            "",
        ]
    RELATORIO.write_text("\n".join(linhas), encoding="utf-8")
    (RAIZ / "auditoria.json").write_text(json.dumps(achados, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"{len(fora)} negociadas fora da base · {len(sem_negocio)} na base sem negócio · {len(achados)} achados "
          f"({dict(Counter(a['sev'] for a in achados))}) → {RELATORIO.name}")


def P_REFS():
    return REFERENCIAS


def P_nome(n):
    return re.sub(r"\s+(S\.?/?A\.?|S/A)\b.*$", "", n, flags=re.I)[:40]


if __name__ == "__main__":
    main()
