"""Histórico diário para a aba Simular (#/simular): fechamento de cada ticker desde 2010,
desdobramentos com a data em que valem, proventos em dinheiro (dividendos, JCP, rendimentos) com
data-com e de pagamento, e CDI, IPCA e PTAX do Banco Central.

    python3 scripts/historico.py      # depois de scripts/processar.py (lê data/empresas.js)

Saída (carregada pelo navegador só quando a aba precisa):
    data/historico/<TICKER>.js   um por ticker da base
    data/historico/_indices.js   CDI e PTAX diários, IPCA mensal, CDI e IPCA de hoje

Fontes, todas já usadas por processar.py e guardadas em scripts/sources:
  - cotações: séries históricas da B3 (COTAHIST); arquivo anual para os anos fechados (lido uma vez
    e guardado já resumido) e arquivos diários para o ano corrente;
  - códigos antigos de cada empresa (KROT3 antes de COGN3, BVMF3 antes de B3SA3): FCA de cada ano;
  - desdobramentos, grupamentos e bonificações: ficha da B3 (data "com" e fator), conferidos pelo salto
    do preço no dia; os que a ficha não lista e scripts/processar.py achou pelo LPA ou pela contagem
    (eventos_acoes) ganham a data do salto do preço no ano em que a cotação mudou de base;
  - proventos em dinheiro: ficha da B3, por classe de ação (ISIN);
  - CDI (SGS 12), IPCA (SGS 433) e PTAX (SGS 1): API do Banco Central.
"""

import gzip
import json
import math
import re
import sys
import zipfile
from datetime import date, datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import processar as P  # noqa: E402

RAIZ = Path(__file__).resolve().parent.parent
SAIDA = RAIZ / "data" / "historico"
CACHE = P.FONTES / "historico"
INICIO = date(P.ANO_INICIAL, 1, 1)
URL_SGS = "https://api.bcb.gov.br/dados/serie/bcdata.sgs.{serie}/dados?formato=json&dataInicial={ini}&dataFinal={fim}"
TIPOS_DINHEIRO = {"DIVIDENDO": "dividendo", "JRS CAP PROPRIO": "jcp", "RENDIMENTO": "rendimento",
                  "REST CAP DIN": "restituicao"}


# ---------------------------------------------------------------- cotações

def ler_cotahist_diario(f, codigos=None):
    """{código: [(data 'AAAA-MM-DD', fechamento R$)]} de todos os pregões de um arquivo COTAHIST
    (aberto, em bytes). Mesmos filtros de processar.ler_cotahist: mercado à vista, lote padrão e
    regimes especiais; sem lista de códigos, só ações (ON, PN, units)."""
    out = {}
    for linha in f:
        if linha[:2] != b"01" or linha[24:27] != b"010" or linha[10:12] not in P.CODBDI:
            continue
        t = linha[12:24].strip().decode("latin-1")
        if codigos is None:
            if not P.ESPECIE_ACAO.match(linha[39:49].decode("latin-1")):
                continue
        elif t not in codigos:
            continue
        d = linha[2:10].decode()
        fator = int(linha[210:217]) or 1
        preco = int(linha[108:121]) / 100 / fator
        if preco > 0:
            out.setdefault(t, []).append((f"{d[:4]}-{d[4:6]}-{d[6:]}", preco))
    return out


def _abrir_zip(caminho):
    zf = zipfile.ZipFile(caminho)
    return zf, zf.open(zf.namelist()[0])


def precos_do_ano(ano):
    """Todos os pregões de todas as ações num ano fechado. O arquivo anual da B3 (dezenas de MB) é
    lido uma vez e guardado resumido em scripts/sources/historico; o original de 2018 em diante sai
    do cache (processar.py só usa os anteriores)."""
    resumo = CACHE / f"cotacoes_{ano}.json.gz"
    if resumo.exists():
        return json.loads(gzip.decompress(resumo.read_bytes()))
    nome = f"COTAHIST_A{ano}.ZIP"
    destino = P.FONTES / "cotahist" / nome
    # baixado ainda durante o ano (como arquivo do ano corrente): falta o fim do ano, baixa de novo
    velho = destino.exists() and datetime.fromtimestamp(destino.stat().st_mtime) < datetime(ano + 1, 1, 2)
    caminho = P.baixar(P.URL_COTA.format(nome=nome), destino, velho)
    zf, f = _abrir_zip(caminho)
    with zf, f:
        dados = ler_cotahist_diario(f)
    CACHE.mkdir(parents=True, exist_ok=True)
    resumo.write_bytes(gzip.compress(json.dumps(dados, separators=(",", ":")).encode()))
    if ano >= 2018:
        caminho.unlink(missing_ok=True)
    print(f"  cotações {ano}: {len(dados)} ações (arquivo anual)")
    return dados


def precos_do_ano_corrente(hoje):
    """Pregões do ano corrente: arquivo anual da B3 (refeito por ela a cada pregão; baixado de novo
    a cada dia) e, por cima, os arquivos diários dos últimos 45 dias que processar.py já baixou."""
    dados = {}
    nome = f"COTAHIST_A{hoje.year}.ZIP"
    try:
        caminho = P.baixar(P.URL_COTA.format(nome=nome), P.FONTES / "cotahist" / nome, max_dias=0.5)
        zf, f = _abrir_zip(caminho)
        with zf, f:
            dados = {t: dict(v) for t, v in ler_cotahist_diario(f).items()}
    except Exception as e:  # noqa: BLE001
        print(f"  arquivo anual de {hoje.year} indisponível: {e}")
    dia, arquivos = hoje - timedelta(days=45), 0
    while dia <= hoje:
        if dia.weekday() < 5 and dia.year == hoje.year:
            caminho = P.baixar_dia(dia)
            if caminho:
                arquivos += 1
                zf, f = _abrir_zip(caminho)
                with zf, f:
                    for t, v in ler_cotahist_diario(f).items():
                        dados.setdefault(t, {}).update(dict(v))
        dia += timedelta(days=1)
    print(f"  cotações {hoje.year}: {len(dados)} ações (arquivo anual e {arquivos} pregões diários)")
    return {t: sorted(v.items()) for t, v in dados.items()}


def todas_as_cotacoes(hoje, codigos):
    """{código: {data: fechamento}} de 2010 até hoje, só dos códigos pedidos."""
    out = {}
    for ano in range(INICIO.year, hoje.year):
        try:
            dados = precos_do_ano(ano)
        except Exception as e:  # noqa: BLE001
            print(f"  cotações {ano} indisponíveis: {e}")
            continue
        for t in codigos & set(dados):
            out.setdefault(t, {}).update(dict(dados[t]))
    for t, v in precos_do_ano_corrente(hoje).items():
        if t in codigos:
            out.setdefault(t, {}).update(dict(v))
    return out


# ---------------------------------------------------------------- códigos antigos

def codigos_por_cnpj(anos):
    """{cnpj (só dígitos): {código: (primeiro ano, último ano em que o FCA o lista)}} pelos FCAs de
    cada ano: o código muda quando a empresa troca de nome ou de raiz (KROT3 → COGN3)."""
    out = {}
    for ano in anos:
        try:
            caminho = P.baixar(P.URL_FCA.format(ano=ano), P.FONTES / "fca" / f"fca_cia_aberta_{ano}.zip")
            zf = zipfile.ZipFile(caminho)
            linhas = list(P.ler_csv_zip(zf, f"fca_cia_aberta_valor_mobiliario_{ano}.csv"))
        except Exception as e:  # noqa: BLE001
            print(f"  FCA {ano} indisponível: {e}")
            continue
        for l in linhas:
            cod = (l.get("Codigo_Negociacao") or "").strip().upper()
            if l.get("Mercado") != "Bolsa" or not re.fullmatch(r"[A-Z0-9]{4}\d{1,2}", cod):
                continue
            if l.get("Valor_Mobiliario") not in ("Ações Ordinárias", "Ações Preferenciais", "Units"):
                continue
            anos_cod = out.setdefault(P.so_digitos(l["CNPJ_Companhia"]), {})
            a0, a1 = anos_cod.get(cod, (ano, ano))
            anos_cod[cod] = (min(a0, ano), max(a1, ano))
    return out


def classe(codigo):
    """Classe pelo sufixo numérico: "3" ON, "4" PN, "11" unit (raiz com dígito, como B3SA3)."""
    m = re.match(r"\d+", codigo[4:])
    return m.group(0) if m else ""


def costurar(atual, antigas):
    """Série do ticker atual precedida pelas dos códigos antigos da mesma classe, até o primeiro
    pregão do atual. Só costura quando o preço continua (±40% entre o último pregão do código
    antigo e o primeiro do novo, com no máximo 30 dias entre eles): troca de código, não de papel.
    atual, antigas[i]: {data: preço}. Devolve ({data: preço}, [(código, primeira data)])."""
    if not atual:
        return {}, []
    serie, origem = dict(atual), []
    inicio = min(atual)
    for cod, s in sorted(antigas.items(), key=lambda x: max(x[1]) if x[1] else "", reverse=True):
        antes = {d: p for d, p in s.items() if d < inicio}
        if not antes:
            continue
        ult = max(antes)
        dias = (date.fromisoformat(inicio) - date.fromisoformat(ult)).days
        if dias > 30 or abs(math.log(serie[inicio] / antes[ult])) > math.log(1.4):
            continue
        serie.update(antes)
        origem.append((cod, min(antes)))
        inicio = min(antes)
    return serie, sorted(origem, key=lambda x: x[1])


# ---------------------------------------------------------------- eventos e proventos

def _do_ticker(item, raizes, especies):
    isin = item.get("isinCode") or item.get("assetIssued") or ""
    return isin[2:6] in raizes and any(isin[6:].startswith(e) for e in especies)


def _indice(datas, d):
    """Posição do último pregão até a data d (inclusive); -1 se antes do primeiro."""
    lo, hi = 0, len(datas)
    while lo < hi:
        m = (lo + hi) // 2
        if datas[m] <= d:
            lo = m + 1
        else:
            hi = m
    return lo - 1


def _ganho(q, f):
    """Quanto o fator f explica a variação q do preço (log): positivo quando o preço andou como no evento."""
    return abs(math.log(q)) - abs(math.log(q * f))


def eventos_com_data(datas, precos, sup, raizes, especies, anuais):
    """Desdobramentos, grupamentos e bonificações com a data do primeiro pregão na base nova:
    [(data ex, fator, tipo, origem)].

    - Ficha da B3 (data "com" e fator, por classe): evento de 25% ou mais só entra se o preço do
      pregão seguinte andou como ele; desmentido por mais de 1,5× (o grupamento 100:1 que a ficha
      do Itaú lista em 2011 e o preço não mostra), fica de fora.
    - Evento anual que não veio da ficha (LPA reapresentado ou inferido da contagem, em
      e["eventos_acoes"] com ano_preco): data do pregão daquele ano em que o preço saltou como o
      fator (o salto explica pelo menos metade dele); sem salto assim, fica de fora."""
    out, usados, vistos = [], [], set()
    for x in (sup or {}).get("stockDividends") or []:
        tipo = P.EVENTOS_ACOES.get((x.get("label") or "").strip().upper())
        d, bruto = P.data_br(x.get("lastDatePrior")), P.num_br(x.get("factor"))
        if not tipo or not d or bruto <= 0 or not _do_ticker(x, raizes, especies):
            continue
        f = round(tipo[1](bruto), 8)
        if f <= 0 or abs(f - 1) < 1e-9 or (d, tipo[0]) in vistos:
            continue
        vistos.add((d, tipo[0]))
        i = _indice(datas, d.isoformat())
        if i < 0 or i + 1 >= len(datas):
            continue
        q = precos[i + 1] / precos[i]
        if abs(math.log(f)) >= math.log(1.25) and abs(math.log(q * f)) > math.log(1.5):
            continue
        out.append((datas[i + 1], f, tipo[0], "b3"))
        usados.append((int(datas[i + 1][:4]), f))
    for ev in anuais:
        f, ap = ev.get("fator"), ev.get("ano_preco")
        if not ev.get("origem") or f is None or ap is None or ev["tipo"] == "base":
            continue
        if any(abs(a - ap) <= 1 and abs(math.log(g / f)) < 0.02 for a, g in usados):
            continue
        melhor = None
        for i in range(1, len(datas)):
            if datas[i][:4] != str(ap):
                continue
            g = _ganho(precos[i] / precos[i - 1], f)
            if melhor is None or g > melhor[1]:
                melhor = (i, g)
        if melhor and melhor[1] >= 0.5 * abs(math.log(f)):
            out.append((datas[melhor[0]], f, ev["tipo"], ev["origem"]))
    return sorted(out)


def proventos(sup, raizes, especie, composicao=None):
    """Proventos em dinheiro da classe: [(data-com, R$ por ação na base daquela data, tipo, pagamento)].
    Valor bruto, como a B3 divulga (o JCP tem 15% de IR retido na fonte). Unit sem provento próprio
    na ficha (BPAC11): soma os das ações que a compõem, composicao = {espécie: quantidade}."""
    def da_classe(esp):
        vistos, out = set(), []
        for x in (sup or {}).get("cashDividends") or []:
            tipo = TIPOS_DINHEIRO.get((x.get("label") or "").strip().upper())
            com, pag = P.data_br(x.get("lastDatePrior")), P.data_br(x.get("paymentDate"))
            valor = P.num_br(x.get("rate"))
            if not tipo or not com or valor <= 0 or com < INICIO or not _do_ticker(x, raizes, (esp,)):
                continue
            chave = (com, round(valor, 8), tipo)
            if chave in vistos:
                continue
            vistos.add(chave)
            out.append((com.isoformat(), round(valor, 8), tipo,
                        pag.isoformat() if pag and pag.year < 9999 else None))
        return sorted(out)

    proprios = da_classe(especie)
    if proprios or not composicao:
        return proprios
    somados = {}
    for esp, n in composicao.items():
        for com, valor, tipo, pag in da_classe(esp):
            k = (com, tipo, pag)
            somados[k] = somados.get(k, 0) + valor * n
    return sorted((com, round(v, 8), tipo, pag) for (com, tipo, pag), v in somados.items())


def composicao_unit(e, t):
    """{espécie: quantidade} de uma unit, pela composição do cadastro ([ON, PN]); a PN é a classe
    preferencial que a empresa negocia (BPAC5 no BTG, PN nas demais)."""
    comp = (e.get("units") or {}).get(t)
    if not comp and len(e.get("units") or {}) == 1:
        comp = next(iter(e["units"].values()))
    if not comp:
        return None
    pns = [P.ISIN_ESPECIE[classe(x)] for x in e["tickers"] if classe(x) in ("4", "5", "6", "7", "8")]
    return {"ACNOR": comp[0], (pns[0] if pns else "ACNPR"): comp[1]}


# ---------------------------------------------------------------- Banco Central

def serie_sgs(serie, ano, hoje, refazer):
    """Valores de uma série do SGS num ano, guardados por ano (o corrente é baixado de novo)."""
    destino = CACHE / f"sgs{serie}_{ano}.json"
    ini, fim = f"01/01/{ano}", f"31/12/{ano}"
    try:
        P.baixar(URL_SGS.format(serie=serie, ini=ini, fim=fim), destino, refazer or ano == hoje.year)
        return [(datetime.strptime(x["data"], "%d/%m/%Y").date(), float(x["valor"]))
                for x in json.loads(destino.read_text())]
    except Exception as e:  # noqa: BLE001
        print(f"  SGS {serie} {ano} indisponível: {e}")
        return []


def indices(hoje):
    """CDI acumulado por dia, IPCA acumulado por mês e PTAX por dia, desde 2010."""
    cdi, ipca, ptax = [], [], []
    for ano in range(INICIO.year, hoje.year + 1):
        cdi += serie_sgs(12, ano, hoje, False)       # CDI, % ao dia
        ipca += serie_sgs(433, ano, hoje, False)     # IPCA, % no mês
        destino = P.FONTES / "ptax" / f"ptax_{ano}.json"   # baixada por processar.py
        try:
            P.baixar(P.URL_PTAX.format(ano=ano), destino, ano == hoje.year)
            ptax += [(datetime.strptime(x["data"], "%d/%m/%Y").date(), float(x["valor"]))
                     for x in json.loads(destino.read_text())]
        except Exception as e:  # noqa: BLE001
            print(f"  PTAX {ano} indisponível: {e}")
    out = {"gerado_em": datetime.now().strftime("%Y-%m-%d %H:%M")}
    if cdi:
        acc, datas, valores = 1.0, [], []
        for d, r in sorted(cdi):
            datas.append(d.isoformat())
            valores.append(round(acc, 8))   # índice no começo do dia: o CDI do dia rende até o próximo
            acc *= 1 + r / 100
        out["cdi"] = {**compactar_datas(datas), "i": valores}
        out["cdi_aa"] = round((1 + sorted(cdi)[-1][1] / 100) ** 252 - 1, 4)
    if ipca:
        acc, meses = 1.0, []
        for d, r in sorted(ipca):
            acc *= 1 + r / 100
            meses.append(round(acc, 6))     # índice no fim do mês
        out["ipca"] = {"m0": sorted(ipca)[0][0].strftime("%Y-%m"), "i": meses}
        doze = sorted(ipca)[-12:]
        out["ipca_12m"] = round(math.prod(1 + r / 100 for _, r in doze) - 1, 4)
        out["ipca_ate"] = doze[-1][0].strftime("%Y-%m")
    if ptax:
        datas = [d.isoformat() for d, _ in sorted(ptax)]
        out["ptax"] = {**compactar_datas(datas), "v": [v for _, v in sorted(ptax)]}
    return out


# ---------------------------------------------------------------- saída

def compactar_datas(datas):
    """Datas como a primeira e os saltos em dias (1 no meio da semana, 3 depois do fim de semana)."""
    d0 = date.fromisoformat(datas[0])
    dd, ant = [], d0
    for s in datas[1:]:
        d = date.fromisoformat(s)
        dd.append((d - ant).days)
        ant = d
    return {"d0": datas[0], "dd": dd}


def compactar_precos(precos):
    """Preços como inteiros (centavos; décimos de milésimo para quem negocia abaixo de R$ 0,50) e
    diferenças entre pregões: o arquivo fica pequeno e comprime bem."""
    esc = 10000 if min(precos) < 0.5 else 100
    ints = [round(p * esc) for p in precos]
    return {"esc": esc, "p0": ints[0], "dp": [b - a for a, b in zip(ints, ints[1:])]}


def escrever(t, serie, eventos, provs, origem, hoje):
    datas = sorted(serie)
    precos = [serie[d] for d in datas]
    corpo = {"t": t, "ate": hoje.isoformat(), **compactar_datas(datas), **compactar_precos(precos),
             "ev": [[d, round(f, 8), tipo, orig] for d, f, tipo, orig in eventos],
             "pv": [list(p) for p in provs]}
    if origem:
        corpo["cod"] = [list(x) for x in origem]
    js = json.dumps(corpo, ensure_ascii=False, separators=(",", ":"))
    (SAIDA / f"{t}.js").write_text(f"// Gerado por scripts/historico.py — não edite à mão.\n"
                                   f"(window.HIST=window.HIST||{{}})[{json.dumps(t)}]={js};\n", encoding="utf-8")


def ler_base():
    txt = (RAIZ / "data" / "empresas.js").read_text(encoding="utf-8")
    ini = txt.index("window.DADOS = ") + len("window.DADOS = ")
    return json.loads(txt[ini:txt.rindex(";")])


def main():
    hoje = date.today()
    base = ler_base()
    empresas = base["empresas"]
    print("Códigos antigos (FCA)…")
    codigos = codigos_por_cnpj(range(INICIO.year, hoje.year + 1))
    print("Cotações diárias (B3)…")
    precisa = {t for e in empresas for t in e["tickers"]}
    precisa |= {c for e in empresas for c in codigos.get(P.so_digitos(e["cnpj"]), {})}
    cot = todas_as_cotacoes(hoje, precisa)
    print("Fichas dos emissores (B3)…")
    sups = P.carregar_suplementos({t[:4] for e in empresas for t in e["tickers"]}, False)

    SAIDA.mkdir(parents=True, exist_ok=True)
    feitos, costurados, sem_cotacao, n_ev, n_pv = set(), [], [], 0, 0
    for e in empresas:
        cods = codigos.get(P.so_digitos(e["cnpj"]), {})
        for t in e["tickers"]:
            antigas = {c: cot.get(c, {}) for c in cods if c != t and classe(c) == classe(t) and cot.get(c)}
            serie, origem = costurar(cot.get(t, {}), antigas)
            if len(serie) < 2:
                sem_cotacao.append(t)
                continue
            raizes = {t[:4]} | {c[:4] for c, _ in origem}
            especie = P.ISIN_ESPECIE.get(classe(t), "")
            unit = classe(t) == "11"
            comp = composicao_unit(e, t) if unit else None
            # unit: a ficha pode listar o evento só nas ações que a compõem; o preço da unit confere
            especies = (especie,) + tuple(comp or ()) if unit else (especie,)
            sup = sups.get(t[:4]) or {}
            datas = sorted(serie)
            eventos = eventos_com_data(datas, [serie[d] for d in datas], sup, raizes, especies, e.get("eventos_acoes") or [])
            provs = proventos(sup, raizes, especie, comp) if especie else []
            escrever(t, serie, eventos, provs, origem, hoje)
            feitos.add(t)
            n_ev += len(eventos)
            n_pv += len(provs)
            if origem:
                costurados.append(f"{t} ← {', '.join(c for c, _ in origem)}")
    for velho in SAIDA.glob("*.js"):
        if velho.stem != "_indices" and velho.stem not in feitos:
            velho.unlink()
    print(f"  {len(feitos)} tickers → {SAIDA.relative_to(RAIZ)} ({n_ev} eventos, {n_pv} proventos)")
    if costurados:
        print(f"  códigos antigos costurados: {'; '.join(costurados)}")
    if sem_cotacao:
        print(f"  sem cotação: {', '.join(sem_cotacao)}")

    print("CDI, IPCA e PTAX (BCB)…")
    ind = indices(hoje)
    js = json.dumps(ind, separators=(",", ":"))
    (SAIDA / "_indices.js").write_text(f"// Gerado por scripts/historico.py — não edite à mão.\nwindow.INDICES={js};\n",
                                       encoding="utf-8")
    print(f"  CDI hoje {ind.get('cdi_aa')}, IPCA 12m {ind.get('ipca_12m')} (até {ind.get('ipca_ate')})")


if __name__ == "__main__":
    main()
