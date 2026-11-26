"""Gera data/empresas.js a partir dos dados abertos da CVM e da PTAX do BCB.

Fontes (todas públicas):
- DFP (demonstrações anuais): https://dados.cvm.gov.br/dados/CIA_ABERTA/DOC/DFP/DADOS/
- FCA (cadastro: tickers, setor, segmento, controle, ADR):
  https://dados.cvm.gov.br/dados/CIA_ABERTA/DOC/FCA/DADOS/
- PTAX venda diária (BCB SGS série 1), para a visão em dólar.
- Cotações da B3 (COTAHIST): https://bvmf.bmfbovespa.com.br/InstDados/SerHist/
  arquivos diários a partir de 2018 (último pregão de cada ano e o último mês),
  anuais antes disso. Preços sem ajuste por desdobramento: valem para a data, junto
  com as ações em circulação da DFP da mesma data.

Uso, a partir da raiz do projeto:
    python3 scripts/processar.py            # baixa o que faltar e gera
    python3 scripts/processar.py --rebaixar # força novo download (a CVM regera os ZIPs)

Cuidados com a base da CVM, tratados aqui:
- arquivos em Latin-1, separados por ';';
- reapresentações: fica só a maior VERSAO por empresa em cada arquivo;
- escala: a maioria vem em MIL, algumas em UNIDADE; tudo vira R$ mil;
- o código da conta varia (lucro em 3.09, 3.11 ou 3.13; bancos têm outro plano),
  então as contas são localizadas pelo nome, não só pelo código.
"""

import base64
import csv
import io
import json
import math
import re
import statistics
import sys
import time
import urllib.error
import urllib.request
import zipfile
from collections import Counter
from datetime import date, datetime
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
FONTES = RAIZ / "scripts" / "sources"
# composição do capital de cada formulário (DFP e ITR): COMPOSICAO[cnpj][data] = (on, pn, tes_on, tes_pn, fonte)
COMPOSICAO = {}
SAIDA = RAIZ / "data" / "empresas.js"
# agenda de proventos à parte: empresas.js tem a forma que scripts/carregar_base.py confere campo a campo
SAIDA_AGENDA = RAIZ / "data" / "agenda.js"

URL_ITR = "https://dados.cvm.gov.br/dados/CIA_ABERTA/DOC/ITR/DADOS/itr_cia_aberta_{ano}.zip"
URL_DFP = "https://dados.cvm.gov.br/dados/CIA_ABERTA/DOC/DFP/DADOS/dfp_cia_aberta_{ano}.zip"
URL_FCA = "https://dados.cvm.gov.br/dados/CIA_ABERTA/DOC/FCA/DADOS/fca_cia_aberta_{ano}.zip"
CODBDI = (b"02", b"05", b"06", b"07", b"08")
ESPECIE_ACAO = re.compile(r"^(ON|PN|PNA|PNB|PNC|PND|PNE|PNF|PNG|UNT)\b")
URL_B3_EMPRESAS = "https://sistemaswebb3-listados.b3.com.br/listedCompaniesProxy/CompanyCall/GetInitialCompanies/"
URL_B3_SUPLEMENTO = "https://sistemaswebb3-listados.b3.com.br/listedCompaniesProxy/CompanyCall/GetListedSupplementCompany/"
URL_COTA = "https://bvmf.bmfbovespa.com.br/InstDados/SerHist/{nome}"
URL_PTAX = ("https://api.bcb.gov.br/dados/serie/bcdata.sgs.1/dados?formato=json"
            "&dataInicial=01/01/{ano}&dataFinal=31/12/{ano}")

ANO_INICIAL = 2010
ANO_FINAL = date.today().year - 1  # a DFP do ano corrente só sai no ano seguinte
ANOS_SCORE = 10                    # janela do índice de previsibilidade
# Corte de liquidez: só entram empresas com volume médio diário (todas as classes, últimos 21 pregões)
# de R$ 1 mi ou mais. Em nov/2026 ficaram 188 de 345 empresas, com 99,95% do volume e 96,9% do valor
# de mercado da base. Quem já está na base só sai abaixo de R$ 500 mil, para não entrar e sair a cada
# mês por oscilação de volume. Abaixo do corte a empresa fica fora de tudo: processamento, site,
# páginas, auditoria e Postgres (scripts/carregar_base.py expurga o histórico dela).
LIQUIDEZ_MIN = 1_000_000
LIQUIDEZ_SAIDA = 500_000
MIN_ANOS_SCORE = 5

SETORES_FINANCEIROS = ("banco", "segurad", "intermedia", "arrendamento", "previd")

csv.field_size_limit(10_000_000)


# ---------------------------------------------------------------- download

def baixar(url: str, destino: Path, forcar: bool = False, max_dias: float = None) -> Path:
    """Baixa se não existe, se forcar, ou se o arquivo local tem mais de max_dias."""
    velho = max_dias is not None and destino.exists() and (time.time() - destino.stat().st_mtime) / 86400 > max_dias
    if destino.exists() and not forcar and not velho:
        return destino
    destino.parent.mkdir(parents=True, exist_ok=True)
    print(f"  baixando {url}")
    req = urllib.request.Request(url, headers={"User-Agent": "previsibilidade-acoes/0.1"})
    for tentativa in range(3):
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                dados = r.read()
            temp = destino.with_name(destino.name + ".parcial")  # nunca deixa arquivo pela metade
            temp.write_bytes(dados)
            temp.replace(destino)
            return destino
        except urllib.error.HTTPError as e:
            if e.code == 404 or tentativa == 2:
                raise  # 404 é resposta definitiva (arquivo não existe)
        except (urllib.error.URLError, TimeoutError, ConnectionError, OSError):
            if tentativa == 2:
                raise
        time.sleep(3 * (tentativa + 1))  # falha passageira: tenta de novo
    return destino


def ler_csv_zip(zf: zipfile.ZipFile, nome: str):
    with zf.open(nome) as f:
        yield from csv.DictReader(io.TextIOWrapper(f, encoding="latin-1"), delimiter=";")


# ---------------------------------------------------------------- cadastro (FCA + B3)

SEGMENTOS_B3 = {"NM": "Novo Mercado", "N1": "Nível 1 de Governança Corporativa",
                "N2": "Nível 2 de Governança Corporativa", "MA": "Bovespa Mais", "M2": "Bovespa Mais Nível 2",
                "MB": "Balcão Organizado", "": "Básico"}


def so_digitos(cnpj):
    return re.sub(r"\D", "", str(cnpj)).zfill(14)


def carregar_empresas_b3(forcar: bool):
    """Lista de emissores da B3 (CNPJ, código CVM, raiz do ticker). Cache de 7 dias.

    É a fonte do mapeamento CNPJ → ticker: no FCA da CVM várias empresas preenchem o código de
    negociação errado ("000000" no BTG, "4030" na CSN, "ADR" na Marfrig) ou nem o informam (B3 S.A.).
    """
    destino = FONTES / "b3" / "empresas_b3.json"
    idade = (datetime.now().timestamp() - destino.stat().st_mtime) / 86400 if destino.exists() else 999
    if forcar or idade > 7:
        try:
            res, pagina = [], 1
            while True:
                q = base64.b64encode(json.dumps({"language": "pt-br", "pageNumber": pagina, "pageSize": 120}).encode()).decode()
                req = urllib.request.Request(URL_B3_EMPRESAS + q, headers={"User-Agent": "Mozilla/5.0"})
                with urllib.request.urlopen(req, timeout=60) as r:
                    d = json.load(r)
                res += d["results"]
                if pagina >= d["page"]["totalPages"]:
                    break
                pagina += 1
            destino.parent.mkdir(parents=True, exist_ok=True)
            destino.write_text(json.dumps(res, ensure_ascii=False), encoding="utf-8")
            print(f"  lista da B3 atualizada: {len(res)} emissores")
        except Exception as e:  # noqa: BLE001
            print(f"  lista da B3 indisponível ({e}); usando cache" if destino.exists() else f"  lista da B3 indisponível: {e}")
    return json.loads(destino.read_text(encoding="utf-8")) if destino.exists() else []


def carregar_suplementos(raizes, forcar: bool):
    """Ficha de cada emissor na B3: ações ON/PN atuais e proventos com data-com. Cache de 7 dias.

    É a quantidade de ações vigente hoje (a DFP só traz a do fim do exercício, e algumas
    empresas a preenchem errado) e a base do dividend yield de 12 meses.
    """
    pasta = FONTES / "b3" / "suplemento"
    pasta.mkdir(parents=True, exist_ok=True)
    out, baixados, falhas = {}, 0, 0
    for raiz in sorted(raizes):
        arq = pasta / f"{raiz}.json"
        idade = (time.time() - arq.stat().st_mtime) / 86400 if arq.exists() else 999
        if forcar or idade > 7:
            try:
                q = base64.b64encode(json.dumps({"issuingCompany": raiz, "language": "pt-br"}).encode()).decode()
                req = urllib.request.Request(URL_B3_SUPLEMENTO + q, headers={"User-Agent": "Mozilla/5.0"})
                with urllib.request.urlopen(req, timeout=30) as r:
                    arq.write_bytes(r.read())
                baixados += 1
                time.sleep(0.05)
            except Exception:  # noqa: BLE001
                falhas += 1
        if arq.exists():
            try:
                d = json.loads(arq.read_text(encoding="utf-8"))
                if d:
                    out[raiz] = d[0]
            except ValueError:
                pass
    print(f"  fichas da B3: {len(out)} ({baixados} atualizadas, {falhas} falhas)")
    return out


def num_br(x):
    return float(str(x).replace(".", "").replace(",", ".")) if x not in (None, "") else 0.0


def data_br(x):
    try:
        d, m, a = x.split("/")
        return date(int(a), int(m), int(d))
    except (ValueError, AttributeError):
        return None


# eventos que mudam a quantidade de ações sem entrada de dinheiro: multiplicador sobre a quantidade
EVENTOS_ACOES = {
    "DESDOBRAMENTO": ("desdobramento", lambda f: 1 + f / 100),  # fator em %: 100 = cada ação vira 2
    "BONIFICACAO": ("bonificacao", lambda f: 1 + f / 100),      # 10 = 10% a mais em ações
    "GRUPAMENTO": ("grupamento", lambda f: f),                  # 0,1 = cada 10 ações viram 1
}


def eventos_acoes(sup):
    """Desdobramentos, bonificações e grupamentos da ficha da B3, um por data (a ficha repete o
    evento para cada classe). data = último dia "com"; a quantidade muda no dia seguinte."""
    out = {}
    for x in (sup or {}).get("stockDividends") or []:
        tipo = EVENTOS_ACOES.get((x.get("label") or "").strip().upper())
        d, f = data_br(x.get("lastDatePrior")), num_br(x.get("factor"))
        if not tipo or not d or f <= 0:
            continue
        mult = tipo[1](f)
        if mult <= 0 or abs(mult - 1) < 1e-9:
            continue
        out.setdefault((d.isoformat(), tipo[0]), round(mult, 8))
    return [{"data": d, "tipo": t, "fator": m} for (d, t), m in sorted(out.items())]


def contagem_confirma(r, f):
    """A contagem confirma o evento de fator f se o salto r do ano passa por ele, com folga de
    recompra (15%) e de emissão no mesmo ano. Evento pequeno (bonificação de até 25%) fica na
    folga de 15% para cada lado. Nos outros, ou o evento explica o grosso do salto (sobra até
    2,5× de emissão; grupamento 2:1 com a contagem parada não é grupamento mais emissão de 100%),
    ou a contagem andou 2× ou mais no sentido dele: emissão grande no mesmo ano (Americanas,
    2024: grupamento 100:1 e aumento de capital de 22×; a contagem caiu 4,5×)."""
    if not r or r <= 0:
        return False
    x = r / f
    if abs(math.log(f)) < math.log(1.25):
        return 0.85 < x < 1.18
    if x <= 0.85:
        return False
    if x < 2.5 and abs(math.log(x)) < abs(math.log(r)):
        return True
    return math.log(r) * math.log(f) > 0 and abs(math.log(r)) >= LOG_2


def eventos_confirmados(anos, s, eventos):
    """Fica só o evento que a contagem anual da CVM confirma: a quantidade salta pelo fator entre o
    fim do ano anterior e o do ano em que ele vale. Folga de 15% para baixo (recompra) e até 2,5×
    para cima: emissão no mesmo ano (Cosan, 2021: desdobramento e incorporação da controladora).
    Dois eventos no mesmo ano: cada um confere o que sobrou do salto depois do outro.

    Grava "ano" = primeiro exercício cuja contagem já inclui o evento e "ano_preco" = primeiro fim
    de ano cotado na base nova. Os dois diferem quando:
      - o ano é estimado pelo LPA (média do ano): o salto aparece só no exercício seguinte;
      - o evento é do começo do ano (até abril) e a DFP do ano anterior, entregue depois dele, já
        traz a quantidade nova (IRB: grupamento de fevereiro de 2023 já na DFP de 2022)."""
    ac, est = s["acoes"], s.get("acoes_estimadas") or [False] * len(anos)
    ja = [1.0] * len(anos)  # fator dos eventos já confirmados em cada ano
    out = []
    for ev in sorted(eventos, key=lambda x: x["data"]):
        d = ev["data"]
        y = int(d[:4]) + (1 if d[5:] >= "12-31" else 0)  # "com" no último dia do ano: vale no seguinte
        for cand in (y, y + 1, y - 1):
            if cand not in anos or anos.index(cand) == 0:
                continue
            k = anos.index(cand)
            if cand == y + 1 and not est[k - 1] and not est[k]:
                continue
            if cand == y - 1 and d[5:7] > "04":
                continue
            if ac[k] and ac[k - 1] and contagem_confirma(ac[k] / ac[k - 1] / ja[k], ev["fator"]):
                ja[k] *= ev["fator"]
                out.append({**ev, "ano": cand, "ano_preco": y})
                break
    return out


# Fatores de desdobramento e grupamento usuais. A contagem só infere um evento por um destes;
# as bonificações de 20% a 50% só entram pelo LPA reapresentado (emissões desse tamanho são comuns).
FATORES = sorted({float(x) for b in (2, 3, 4, 5, 6, 8, 10, 15, 20, 25, 30, 40, 50, 100, 1000) for x in (b, 1 / b)})
FATORES_LPA = sorted(FATORES + [1.2, 1.25, 1.3, 1.5, 1 / 1.5])
LPA_MIN = 0.1  # abaixo disso, o arredondamento do LPA na DFP já desloca a razão em mais de 1%
LOG_15, LOG_2, LOG_3 = math.log(1.5), math.log(2), math.log(3)


def fator_comum(r, tol, grandes=False, fatores=FATORES):
    """O fator usual mais próximo de r, se a diferença for de no máximo tol (0,03 = 3%).
    grandes=True: só 1:3 ou maior (e 3:1 ou maior), que o preço consegue confirmar."""
    if not r or r <= 0:
        return None
    f = min(fatores, key=lambda x: abs(math.log(r / x)))
    if grandes and abs(math.log(f)) < LOG_3 - 1e-9:
        return None
    return f if abs(r / f - 1) <= tol else None


def fatores_ano(anos, eventos, chave):
    """Por ano, o produto dos fatores dos eventos que valem depois dele: chave "ano" (contagem) ou
    "ano_preco" (cotação; evento sem ano_preco não mexe nela). Na contagem, None antes de uma
    quebra de base."""
    out = []
    for a in anos:
        f = 1.0
        for ev in eventos:
            if ev["tipo"] == "base":
                if chave == "ano" and ev["ano"] > a:
                    f = None
                    break
            elif ev.get(chave) is not None and ev[chave] > a:
                f *= ev["fator"]
        out.append(f)
    return out


def _razoes_contagem(anos, s, eventos):
    """r[k] = ações(k) / ações(k-1), as duas na base de hoje pelos eventos já conhecidos."""
    fa = fatores_ano(anos, eventos, "ano")
    ac = [x * f if x and f else None for x, f in zip(s["acoes"], fa)]
    return [None] + [ac[k] / ac[k - 1] if ac[k] and ac[k - 1] else None for k in range(1, len(anos))]


def _razoes_preco(anos, precos_ano, eventos):
    """q[k] = cotação(k) / cotação(k-1) do primeiro ticker com as duas, na base de hoje."""
    fp = fatores_ano(anos, eventos, "ano_preco")
    q = [None] * len(anos)
    for k in range(1, len(anos)):
        for v in precos_ano.values():
            if v[k - 1] and v[k]:
                q[k] = (v[k] / fp[k]) / (v[k - 1] / fp[k - 1])
                break
    return q


def _ganho(q, f):
    """Quanto o evento de fator f explica a variação q da cotação melhor do que a ausência dele
    (em log): positivo quando a cotação andou como num desdobramento (caiu para ~1/f)."""
    return abs(math.log(q)) - abs(math.log(q * f))


def _ano_do_preco(anos, k, f, q, estimado):
    """Primeiro fim de ano cotado na base nova, para um evento que a contagem põe no ano k.

    A cotação confirma (andou como num desdobramento) ou não diz nada: fica k. Desmente com força
    (a variação sem o evento é bem mais normal) e um vizinho tem o salto que só o evento explica:
    vai para o vizinho (contagem atrasada; Tegma: grupamento no preço de 2023, na contagem só
    em 2025). Fator 2 é confundido com a volatilidade de um ano: só olha o ano seguinte.
    Sem vizinho, ou com a cotação ambígua num ano estimado pelo LPA, devolve None: a contagem é
    ajustada e a cotação, não (erro na estimativa, não evento; Vale, 2009).
    Devolve (ano ou None, aceita): aceita=False quando nada sustenta o evento."""
    if q[k] is None:
        return anos[k], True
    g = _ganho(q[k], f)
    if g > LOG_15:
        return anos[k], True
    if g < -LOG_2:
        grande = abs(math.log(f)) >= LOG_3 - 1e-9
        vizinhos = (k + 1, k - 1, k + 2, k - 2) if grande else (k + 1,)
        melhor = max(((j, _ganho(q[j], f)) for j in vizinhos if 0 < j < len(anos) and q[j] is not None),
                     key=lambda x: x[1], default=None)
        if melhor and melhor[1] > LOG_2:
            return anos[melhor[0]], True
        return None, estimado
    return (None if estimado else anos[k]), True


def eventos_por_lpa(anos, s, precos_ano, eventos):
    """Desdobramento e grupamento que a ficha da B3 não lista, achados pelo LPA reapresentado.

    Cada DFP repete o LPA do ano anterior, e o CPC 41 manda refazê-lo na base nova de ações
    quando há desdobramento, grupamento ou bonificação (inclusive entre o fim do exercício e a
    entrega da DFP); emissão não muda o LPA já divulgado. LPA original / reapresentado a 1% de um
    fator usual, com a contagem saltando pelo fator (folga de emissão como na B3) no ano seguinte
    ou no outro (DFP ainda com a quantidade antiga), vira evento. s["_lpa_seguinte"][i] = LPA de
    anos[i] na DFP do ano seguinte."""
    seg = s.get("_lpa_seguinte")
    if not seg:
        return []
    lpa = s["lpa_declarado"]
    todos, out = list(eventos), []
    for i in range(len(anos)):
        a, b = lpa[i], seg[i]
        if a is None or b is None or abs(a) < LPA_MIN or abs(b) < LPA_MIN or a * b < 0:
            continue
        f = fator_comum(a / b, 0.01, fatores=FATORES_LPA)
        if f is None:
            continue
        for c in (anos[i] + 1, anos[i] + 2):
            if c not in anos:
                continue
            k = anos.index(c)
            if contagem_confirma(_razoes_contagem(anos, s, todos)[k], f):
                # o evento é posterior à DFP de anos[i]: a cotação muda de base no ano da contagem
                # ou, se foi no começo do ano seguinte (antes da entrega da DFP), nele
                ap, q = c, _razoes_preco(anos, precos_ano, todos)
                if (c == anos[i] + 1 and k + 1 < len(anos) and q[k] is not None and q[k + 1] is not None
                        and _ganho(q[k], f) < -LOG_2 and _ganho(q[k + 1], f) > LOG_2):
                    ap = anos[k + 1]
                tipo = "desdobramento" if f >= 2 else "bonificacao" if f > 1 else "grupamento"
                ev = {"tipo": tipo, "fator": round(f, 8),
                      "ano": c, "ano_preco": ap, "origem": "lpa"}
                out.append(ev)
                todos.append(ev)
                break
    return out


def _lpa_nega(anos, s, k):
    """A DFP do ano k repetiu o LPA do ano anterior igual (±2%): não houve desdobramento nem
    grupamento entre as duas DFPs, e o salto da contagem no ano k é emissão (ou cancelamento)."""
    seg = s.get("_lpa_seguinte")
    if not seg or anos[k] - anos[k - 1] != 1:
        return False
    a, b = s["lpa_declarado"][k - 1], seg[k - 1]
    return a is not None and b is not None and abs(a) >= LPA_MIN and abs(b) >= LPA_MIN and 0.98 < a / b < 1.02


def eventos_inferidos(anos, s, precos_ano, eventos):
    """O salto da contagem que sobra depois dos eventos da B3 e do LPA.

    - A 3% de um fator usual, sem a cotação desmentir: "ajuste" de base (desdobramento que a B3
      não lista, como o da Vivo em 2025, ou troca de base antes da abertura de capital, como a da
      CSN Mineração em 2021). Fator de 3× ou mais com a cotação confirmando aceita até 8%:
      desdobramento e emissão no mesmo ano (Magalu, 2019). Na emenda entre ano estimado pelo LPA e
      ano da DFP, até 6% (a estimativa erra uns % quando ON e PN têm direitos diferentes).
    - Salto de 3× ou mais sem explicação, sem cotação para conferir, ou com ano estimado e valor
      de mercado que salta 4×: "base" — os anos anteriores ficam sem valor por ação comparável
      (GPS: 117× na abertura de capital, em 2021).
    - Emissão de verdade, com cotação (Casas Bahia, 2025: conversão de dívida), fica como está.
    Não infere no ano que já tem evento da B3 ou do LPA: a ficha lista todos os do ano, e o que
    sobra do salto é emissão. O LPA reapresentado igual também veta. Ano sem quantidade no meio
    (LPA ausente) só entra na regra da quebra, comparando com o último ano com quantidade."""
    n = len(anos)
    est = s.get("acoes_estimadas") or [False] * n
    todos, out = list(eventos), []
    com_evento = {ev["ano"] for ev in eventos}
    for k in range(1, n):
        if anos[k] in com_evento:
            continue
        fa = fatores_ano(anos, todos, "ano")
        ac = [x * f if x and f else None for x, f in zip(s["acoes"], fa)]
        j = next((i for i in range(k - 1, -1, -1) if ac[i]), None)
        if not ac[k] or j is None:
            continue
        r = ac[k] / ac[j]
        if abs(math.log(r)) < math.log(1.3):
            continue
        q = _razoes_preco(anos, precos_ano, todos)
        estimado = est[k] or est[j]
        if j < k - 1:
            # buraco na série: só a quebra, com a cotação do período inteiro
            qs = [q[i] for i in range(j + 1, k + 1)]
            qk = math.prod(qs) if all(x is not None for x in qs) else None
            if abs(math.log(r)) >= LOG_3 - 1e-9 and (qk is None or (estimado and not 0.25 < r * qk < 4)):
                ev = {"tipo": "base", "ano": anos[k], "origem": "contagem"}
                out.append(ev)
                todos.append(ev)
            continue
        f, exige_preco = fator_comum(r, 0.03), False
        if f is None and est[k] != est[k - 1]:
            f, exige_preco = fator_comum(r, 0.06, grandes=True), True
        if f is None:
            g = fator_comum(r, 0.08, grandes=True)
            if g and q[k] is not None and _ganho(q[k], g) > LOG_15:
                f = g
        if f and not _lpa_nega(anos, s, k):
            ap, aceita = _ano_do_preco(anos, k, f, q, estimado)
            if exige_preco and ap is None:
                aceita = False
            if exige_preco and ap == anos[k] and (q[k] is None or _ganho(q[k], f) <= LOG_15):
                aceita = False  # na emenda, só com a cotação confirmando
            if aceita:
                ev = {"tipo": "ajuste", "fator": f, "ano": anos[k], "ano_preco": ap, "origem": "contagem"}
                out.append(ev)
                todos.append(ev)
                continue
        if abs(math.log(r)) >= LOG_3 - 1e-9 and (q[k] is None or (estimado and not 0.25 < r * q[k] < 4)):
            ev = {"tipo": "base", "ano": anos[k], "origem": "contagem"}
            out.append(ev)
            todos.append(ev)
    return out


def eventos_da_empresa(anos, s, precos_ano, eventos_b3):
    """Eventos que mudam a base de ações, em ordem: ficha da B3, LPA reapresentado e inferidos.
    Antes da última quebra de base, o inferido que não mexe na cotação não muda nada (os anos
    anteriores já ficam sem valor por ação) e sai, como as quebras anteriores."""
    ev = eventos_confirmados(anos, s, eventos_b3)
    ev += eventos_por_lpa(anos, s, precos_ano, ev)
    ev += eventos_inferidos(anos, s, precos_ano, ev)
    quebra = max((x["ano"] for x in ev if x["tipo"] == "base"), default=None)
    if quebra:
        def mexe_no_preco(x):
            ap = x.get("ano_preco")
            return ap is not None and any(v[i] for v in precos_ano.values() for i, a in enumerate(anos) if a < ap)
        ev = [x for x in ev if x["ano"] >= quebra or x.get("origem") != "contagem" or
              (x["tipo"] == "ajuste" and mexe_no_preco(x))]
    return sorted(ev, key=lambda x: (x["ano"], x.get("data") or ""))


def ajustar_valor_mercado(anos, s, eventos):
    """Valor de mercado do fim de cada ano = ações × cotação da mesma data. Quando a contagem já
    está na base nova e a cotação ainda na velha (evento entre o fim do ano e a entrega da DFP,
    ou contagem atrasada), leva as duas para a base de hoje antes de multiplicar. Ajuste sem
    ano_preco (erro de estimativa, não evento) não entra: não se sabe a base da cotação."""
    com_preco = [ev for ev in eventos if ev["tipo"] == "base" or ev.get("ano_preco") is not None]
    fa, fp = fatores_ano(anos, com_preco, "ano"), fatores_ano(anos, com_preco, "ano_preco")
    vm = s["valor_mercado"]
    for k in range(len(anos)):
        if vm[k] and fa[k] and abs(fa[k] / fp[k] - 1) > 1e-9:
            vm[k] = round(vm[k] * fa[k] / fp[k])


# ISIN da B3: BR + raiz + espécie. Ex.: BRPETRACNOR9 (ON), BRPETRACNPR6 (PN), BRBPACCDAM16 (unit)
ISIN_ESPECIE = {"3": "ACNOR", "4": "ACNPR", "5": "ACNPA", "6": "ACNPB", "7": "ACNPC", "8": "ACNPD", "11": "CDAM"}


def proventos_12m(sup, tickers, hoje=None):
    """Proventos em dinheiro com data-com nos últimos 12 meses, em R$ por ação de cada ticker."""
    hoje = hoje or date.today()
    por_ticker = {}
    for t in tickers:
        m = re.match(r"\d+", t[4:])
        esp = ISIN_ESPECIE.get(m.group(0) if m else "")
        if not esp:
            continue
        total = 0.0
        for p in sup.get("cashDividends") or []:
            dc = data_br(p.get("lastDatePrior"))
            isin = p.get("isinCode") or p.get("assetIssued") or ""
            if dc and 0 <= (hoje - dc).days <= 365 and isin[2:6] == t[:4] and isin[6:].startswith(esp):
                total += num_br(p.get("rate"))
        por_ticker[t] = total
    return por_ticker


TIPOS_PROVENTO = {"DIVIDENDO": "dividendo", "JRS CAP PROPRIO": "jcp", "RENDIMENTO": "rendimento",
                  "REST CAP DIN": "restituicao"}


def proventos_agenda(sup, tickers, hoje=None):
    """Proventos em dinheiro ainda por vir: data-com à frente (ainda dá para comprar e receber) ou
    pagamento a fazer. Um item por ticker × evento, ordenado pela data de pagamento."""
    hoje = hoje or date.today()
    especie_de = {}
    for t in tickers:
        m = re.match(r"\d+", t[4:])
        esp = ISIN_ESPECIE.get(m.group(0) if m else "")
        if esp:
            especie_de[t] = esp
    itens = []
    for p in sup.get("cashDividends") or []:
        com, pag = data_br(p.get("lastDatePrior")), data_br(p.get("paymentDate"))
        if not com or not ((pag and pag >= hoje) or com >= hoje):
            continue
        isin = p.get("isinCode") or p.get("assetIssued") or ""
        for t, esp in especie_de.items():
            if isin[2:6] == t[:4] and isin[6:].startswith(esp):
                itens.append({
                    "t": t, "tipo": TIPOS_PROVENTO.get(p.get("label"), (p.get("label") or "").lower()),
                    "valor": round(num_br(p.get("rate")), 8),
                    "com": com.isoformat(), "pag": pag.isoformat() if pag and pag.year < 9999 else None,
                    "ref": p.get("relatedTo") or "",
                })
    return sorted(itens, key=lambda x: (x["pag"] or "9999", x["t"]))


def carregar_cadastro(forcar: bool, negociados=frozenset(), b3=()):
    """Companhias ativas na CVM com ação na B3.

    Dados cadastrais (nome, setor, controle, exterior, composição de units) vêm do FCA mais recente.
    Os tickers são a união de: (a) códigos válidos do FCA e (b) todo papel de ação negociado na B3
    cuja raiz a própria B3 atribui ao CNPJ (ou que divide a raiz com um ticker do FCA, como KLBN3/KLBN4
    junto de KLBN11). Ticker do FCA com raiz que a B3 atribui a outra empresa é descartado.
    """
    for ano in (date.today().year, date.today().year - 1):
        try:
            caminho = baixar(URL_FCA.format(ano=ano), FONTES / "fca" / f"fca_cia_aberta_{ano}.zip", forcar)
            break
        except Exception as e:  # noqa: BLE001
            print(f"  FCA {ano} indisponível: {e}")
    zf = zipfile.ZipFile(caminho)

    def ultima_versao(nome):
        linhas = {}
        for l in ler_csv_zip(zf, nome.format(ano=ano)):
            cnpj = l["CNPJ_Companhia"]
            v = int(l["Versao"] or 0)
            linhas.setdefault(cnpj, []).append((v, l))
        return {c: [l for v, l in ls if v == max(x for x, _ in ls)] for c, ls in linhas.items()}

    geral = ultima_versao("fca_cia_aberta_geral_{ano}.csv")
    valores = ultima_versao("fca_cia_aberta_valor_mobiliario_{ano}.csv")
    exterior = ultima_versao("fca_cia_aberta_pais_estrangeiro_negociacao_{ano}.csv")

    # raízes por CNPJ segundo a B3 (type 1 = emissor de ações)
    # a B3 às vezes cadastra o CNPJ de uma filial (Tupy: …/0003-00): casa também pelo código CVM
    cnpj_por_cvm = {g[0]["Codigo_CVM"].lstrip("0"): so_digitos(c) for c, g in geral.items()}
    b3_por_cnpj, dono_raiz = {}, {}
    for r in b3:
        if r.get("type") != "1":
            continue
        dig = cnpj_por_cvm.get(str(r.get("codeCVM", "")).lstrip("0"))
        if not dig and r.get("cnpj") and r["cnpj"] != "0":
            dig = so_digitos(r["cnpj"])
        if not dig:
            continue
        b3_por_cnpj.setdefault(dig, []).append(r)
        dono_raiz[r["issuingCompany"]] = dig
    negociados_por_raiz = {}
    for t in negociados:
        negociados_por_raiz.setdefault(t[:4], set()).add(t)

    cad, origem = {}, Counter()
    for cnpj, gs in geral.items():
        g = gs[0]
        if g["Situacao_Registro_CVM"] != "Ativo":
            continue
        dig = so_digitos(cnpj)
        tickers, segmento, units = set(), "", {}
        for l in valores.get(cnpj, []):
            cod = (l["Codigo_Negociacao"] or "").strip().upper()
            if (l["Mercado"] == "Bolsa" and not l["Data_Fim_Negociacao"]
                    and l["Valor_Mobiliario"] in ("Ações Ordinárias", "Ações Preferenciais", "Units")
                    and re.fullmatch(r"[A-Z0-9]{4}\d{1,2}", cod)
                    and dono_raiz.get(cod[:4], dig) == dig):
                tickers.add(cod)
                segmento = segmento or l["Segmento"]
                if l["Valor_Mobiliario"] == "Units":
                    comp = composicao_unit(l["Composicao_BDR_Unit"])
                    if comp:
                        units[cod] = comp
        do_fca = set(tickers)
        raizes = {r["issuingCompany"] for r in b3_por_cnpj.get(dig, [])} | {t[:4] for t in tickers}
        for raiz in raizes:
            if dono_raiz.get(raiz, dig) == dig:
                tickers |= negociados_por_raiz.get(raiz, set())
        if not tickers:
            continue
        origem["só FCA" if tickers == do_fca else "só B3" if not do_fca else "FCA + B3"] += 1
        if not segmento and b3_por_cnpj.get(dig):
            segmento = SEGMENTOS_B3.get(b3_por_cnpj[dig][0].get("market", ""), "")
        tickers = sorted(tickers, key=lambda t: (int(t[4:]) if t[4:].isdigit() else 99, t))
        # setor da B3, em português e inglês (a B3 usa ". " onde seria ", ")
        setor_b3 = None
        for r in b3_por_cnpj.get(dig, []):
            if r.get("segment") and not r["segment"].startswith("Não Classificad"):
                setor_b3 = {"pt": r["segment"].replace(". ", ", ").replace(" ,", ","),
                            "en": (r.get("segmentEng") or r["segment"]).replace(". ", ", ").replace(" ,", ",")}
                break
        cad[cnpj] = {
            "cnpj": cnpj,
            "cd_cvm": g["Codigo_CVM"].lstrip("0"),
            "nome": g["Nome_Empresarial"].strip(),
            "tickers": tickers,
            "ticker": ticker_principal(tickers),
            "setor": (g["Setor_Atividade"] or "Não informado").strip(),
            "segmento": segmento or "Não informado",
            "controle": (g["Especie_Controle_Acionario"] or "Não informado").strip(),
            "site": (g["Pagina_Web"] or "").strip(),
            "exterior": sorted({l["Pais"] for l in exterior.get(cnpj, []) if l["Pais"] and l["Pais"] != "Brasil"}),
            "units": units,
            "setor_b3": setor_b3,
        }
    print(f"  {len(cad)} companhias ativas com ação na B3 (tickers: {dict(origem)})")
    return cad


def composicao_unit(texto):
    """'1 ON + 2 PN', '1 KLBN3 + 4 KLBN4', '2 ações preferenciais e 1 ação ordinária' → (on, pn)."""
    t = (texto or "").upper()
    on = re.search(r"(\d+)\s*(?:AÇ(?:ÃO|ÕES)\s+)?(?:ON\b|ORDIN|[A-Z0-9]{4}3\b)", t)
    pn = re.search(r"(\d+)\s*(?:AÇ(?:ÃO|ÕES)\s+)?(?:PN|PREFER|[A-Z0-9]{4}[456]\b)", t)
    if not on and not pn:
        return None
    return [int(on.group(1)) if on else 0, int(pn.group(1)) if pn else 0]


def ticker_principal(tickers, volume=None):
    """O mais negociado; sem dado de liquidez, a convenção do mercado: unit > PN > ON."""
    if volume:
        negociados = [t for t in tickers if volume.get(t)]
        if negociados:
            return max(negociados, key=lambda t: volume[t])
    for sufixo in ("11", "4", "3", "5", "6"):
        for t in tickers:
            if t[4:] == sufixo:  # a raiz tem 4 caracteres e pode ter dígito (B3SA3)
                return t
    return tickers[0]


# ---------------------------------------------------------------- DFP

def num(linha):
    v = float(linha["VL_CONTA"] or 0)
    if linha["ESCALA_MOEDA"].upper() == "UNIDADE":
        v /= 1000.0
    return v


def nivel(codigo):
    return codigo.count(".")


def extrair_ano(zf, ano, cnpjs, base, itr=False):
    """Preenche base[cnpj][periodo][conta] com o que interessa de cada demonstração.

    DFP: periodo = ano do exercício (int). ITR (itr=True): periodo = data de fim 'AAAA-MM-DD' e só
    entram os valores acumulados desde 1º de janeiro (o ITR traz também o trimestre isolado);
    cada arquivo tem o acumulado do ano (ÚLTIMO) e o do mesmo período do ano anterior (PENÚLTIMO).
    """
    nomes = {n.split(f"_{ano}")[0].replace("dfp_cia_aberta_", "").replace("itr_cia_aberta_", ""): n
             for n in zf.namelist()}

    def linhas(tipo):
        nome = nomes.get(tipo)
        if not nome:
            return
        versoes = {}
        cache = []
        for l in ler_csv_zip(zf, nome):
            if l["CNPJ_CIA"] not in cnpjs:
                continue
            chave = (l["CNPJ_CIA"], l["DT_REFER"])  # o ITR tem um documento por trimestre
            versoes[chave] = max(int(l["VERSAO"] or 0), versoes.get(chave, 0))
            cache.append(l)
        for l in cache:
            if int(l["VERSAO"] or 0) != versoes[(l["CNPJ_CIA"], l["DT_REFER"])]:
                continue
            ordem = l["ORDEM_EXERC"]
            if ordem not in ("ÚLTIMO", "PENÚLTIMO"):
                continue
            if itr:
                ini = l.get("DT_INI_EXERC")
                if ini and ini[5:] != "01-01":
                    continue  # trimestre isolado ou exercício que não começa em janeiro
                yield l, l["DT_FIM_EXERC"], ordem == "ÚLTIMO"
            else:
                yield l, int(l["DT_FIM_EXERC"][:4]), ordem == "ÚLTIMO"

    def linhas_pref(*tipos):
        """Consolidado quando existe; senão o individual (empresas sem controladas, ~1/3 da base,
        como a Sanepar, só entregam o individual). A escolha é por empresa, na ordem dada."""
        vistos = set()
        for tipo in tipos:
            por_cnpj = {}
            for l, a, u in linhas(tipo):
                if l["CNPJ_CIA"] not in vistos:
                    por_cnpj.setdefault(l["CNPJ_CIA"], []).append((l, a, u))
            for cnpj, regs in por_cnpj.items():
                # demonstração entregue toda zerada (TIM, 2025, consolidado) conta como ausente
                if not any(float(l["VL_CONTA"] or 0) for l, a, u in regs if u):
                    continue
                vistos.add(cnpj)
                for l, a, u in regs:
                    if tipo.endswith("_ind"):
                        gravar(cnpj, a, u, "_individual", 1)
                    yield l, a, u

    def gravar(cnpj, ano_ex, ultimo, chave, valor, somar=False):
        reg = base.setdefault(cnpj, {}).setdefault(ano_ex, {})
        origem = reg.setdefault("_origem", {})
        # o ano vindo do próprio arquivo (ÚLTIMO) tem prioridade sobre o PENÚLTIMO do ano seguinte
        if chave in reg and origem.get(chave) and not ultimo:
            return
        if chave in reg and ultimo and not origem.get(chave):
            reg.pop(chave)
        if somar and chave in reg:
            reg[chave] += valor
        else:
            reg[chave] = valor
        origem[chave] = ultimo

    # DRE ---------------------------------------------------------------
    for l, a, u in linhas_pref("DRE_con", "DRE_ind"):
        c, ds, cnpj = l["CD_CONTA"], l["DS_CONTA"].lower(), l["CNPJ_CIA"]
        if c == "3.01":
            gravar(cnpj, a, u, "receita", num(l))
            if "intermedia" in ds:
                gravar(cnpj, a, u, "_financeiro", 1)
        elif nivel(c) == 1 and ds.startswith("resultado bruto"):
            gravar(cnpj, a, u, "lucro_bruto", num(l))
        elif nivel(c) == 1 and ds.startswith("resultado antes do resultado financeiro"):
            gravar(cnpj, a, u, "ebit", num(l))
        elif nivel(c) == 1 and ds.startswith("lucro") and re.search(r"do per[ií]odo|do exerc[ií]cio", ds):
            # consolidado: "Lucro/Prejuízo Consolidado do Período"; individual: "Lucro/Prejuízo do Período"
            gravar(cnpj, a, u, "lucro_liquido", num(l))
            gravar(cnpj, a, u, "_cod_lucro", c)
        elif c.startswith("3.99.01.") and nivel(c) == 3 and ds.strip() == "on":
            # LPA básico ON, em R$/ação (não segue ESCALA_MOEDA); serve para conferir a escala das ações
            gravar(cnpj, a, u, "lpa_on", float(l["VL_CONTA"] or 0))
            if not u and not itr:
                # o mesmo LPA repetido na DFP do ano seguinte: desdobramento e grupamento o
                # reapresentam na base nova (CPC 41), emissão não (ver eventos_por_lpa)
                gravar(cnpj, a, True, "_lpa_on_seguinte", float(l["VL_CONTA"] or 0))
        elif nivel(c) == 2 and "controladora" in ds and ("atribu" in ds or "sócios" in ds):
            reg = base.get(cnpj, {}).get(a, {})
            if c.startswith(reg.get("_cod_lucro", "#")) or reg.get("_cod_lucro") is None:
                gravar(cnpj, a, u, "lucro_controladora", num(l))

    # Balanço ativo -------------------------------------------------------
    for l, a, u in linhas_pref("BPA_con", "BPA_ind"):
        c, ds, cnpj = l["CD_CONTA"], l["DS_CONTA"].lower(), l["CNPJ_CIA"]
        if c == "1":
            gravar(cnpj, a, u, "ativo_total", num(l))
        elif c == "1.01.01" and "caixa" in ds:
            gravar(cnpj, a, u, "caixa", num(l))
        elif c == "1.01.02" and "aplica" in ds:
            gravar(cnpj, a, u, "aplicacoes", num(l))

    # Balanço passivo -----------------------------------------------------
    for l, a, u in linhas_pref("BPP_con", "BPP_ind"):
        c, ds, cnpj = l["CD_CONTA"], l["DS_CONTA"].lower(), l["CNPJ_CIA"]
        if nivel(c) == 1 and ds.startswith("patrimônio líquido"):
            gravar(cnpj, a, u, "pl", num(l))
            gravar(cnpj, a, u, "_cod_pl", c)
        elif nivel(c) == 2 and "não controladores" in ds:
            gravar(cnpj, a, u, "pl_minoritarios", num(l))
        elif nivel(c) == 2 and c[:4] in ("2.01", "2.02") and ds.startswith("empréstimos e financiamentos"):
            gravar(cnpj, a, u, f"divida_{c[:4]}", num(l))

    # Fluxo de caixa: indireto; o direto (≈15 empresas) só quando não há o indireto
    for l, a, u in linhas_pref("DFC_MI_con", "DFC_MD_con", "DFC_MI_ind", "DFC_MD_ind"):
        c, ds, cnpj = l["CD_CONTA"], l["DS_CONTA"].lower(), l["CNPJ_CIA"]
        v = num(l)
        if c == "6.01":
            gravar(cnpj, a, u, "fco", v)
        elif c == "6.02":
            gravar(cnpj, a, u, "fci", v)
        elif c == "6.03":
            gravar(cnpj, a, u, "fcf", v)
        elif c == "6.04" and "cambial" in ds:
            gravar(cnpj, a, u, "fx_caixa", v)
        elif c == "6.05" and re.search(r"aumento|redução|reducao|varia", ds):
            gravar(cnpj, a, u, "var_caixa", v)
        elif c == "6.01.01":
            gravar(cnpj, a, u, "fco_operacoes", v)  # caixa gerado antes do capital de giro
        elif c == "6.01.02" and re.search(r"varia", ds):
            gravar(cnpj, a, u, "fco_giro", v)  # capital de giro: explica saltos pontuais do caixa operacional
        elif c.startswith("6.01.01.") and nivel(c) == 3 and re.search(r"deprecia|amortiza|exaust|deple", ds) \
                and "juros" not in ds and "custo" not in ds:
            gravar(cnpj, a, u, "da", abs(v), somar=True)
        elif c.startswith("6.02.") and nivel(c) == 2 and v < 0 and re.search(r"imobiliz|intang", ds) \
                and not re.search(r"venda|alienação|baixa", ds):
            gravar(cnpj, a, u, "capex", abs(v), somar=True)
        elif c.startswith("6.03.") and nivel(c) == 2:
            # só com o financiamento detalhado dá para afirmar que não houve dividendo
            gravar(cnpj, a, u, "_fin_detalhado", 1)
            if v < 0 and re.search(r"dividend|juros sobre (o )?capital|jcp|juros s/|provento|remunera\w* (aos |dos )?acionista|distribui\w* de (lucro|resultado)", ds) \
                    and "não controlador" not in ds and "minorit" not in ds:
                gravar(cnpj, a, u, "dividendos_pagos", abs(v), somar=True)

    # Ações em circulação (séries anuais só da DFP; a quantidade atual vem da B3) ------------
    nome = nomes.get("composicao_capital")
    if nome:
        # o formulário mais recente de cada empresa (DFP ou ITR), na última versão entregue
        versao = {}
        for l in ler_csv_zip(zf, nome):
            if l["CNPJ_CIA"] not in cnpjs or int(float(l["QT_ACAO_TOTAL_CAP_INTEGR"] or 0)) <= 0:
                continue
            chave, v = (l["CNPJ_CIA"], l["DT_REFER"]), int(l.get("VERSAO") or 0)
            if v < versao.get(chave, -1):
                continue
            versao[chave] = v
            q = lambda c: int(float(l[c] or 0))  # noqa: E731
            COMPOSICAO.setdefault(l["CNPJ_CIA"], {})[l["DT_REFER"]] = (
                q("QT_ACAO_ORDIN_CAP_INTEGR"), q("QT_ACAO_PREF_CAP_INTEGR"),
                q("QT_ACAO_ORDIN_TESOURO"), q("QT_ACAO_PREF_TESOURO"), "ITR" if itr else "DFP")
    if nome and not itr:
        for l in ler_csv_zip(zf, nome):
            if l["CNPJ_CIA"] in cnpjs:
                total = int(float(l["QT_ACAO_TOTAL_CAP_INTEGR"] or 0))
                tes = int(float(l["QT_ACAO_TOTAL_TESOURO"] or 0))
                if total > 0:
                    a = int(l["DT_REFER"][:4])
                    gravar(l["CNPJ_CIA"], a, True, "acoes", total - tes)
                    gravar(l["CNPJ_CIA"], a, True, "acoes_on", int(float(l["QT_ACAO_ORDIN_CAP_INTEGR"] or 0))
                           - int(float(l["QT_ACAO_ORDIN_TESOURO"] or 0)))
                    gravar(l["CNPJ_CIA"], a, True, "acoes_pn", int(float(l["QT_ACAO_PREF_CAP_INTEGR"] or 0))
                           - int(float(l["QT_ACAO_PREF_TESOURO"] or 0)))
                    gravar(l["CNPJ_CIA"], a, True, "tesouraria_on", int(float(l["QT_ACAO_ORDIN_TESOURO"] or 0)))
                    gravar(l["CNPJ_CIA"], a, True, "tesouraria_pn", int(float(l["QT_ACAO_PREF_TESOURO"] or 0)))


# ---------------------------------------------------------------- PTAX

def carregar_ptax(forcar: bool):
    ptax = {}
    atual = None
    for ano in range(ANO_INICIAL - 1, date.today().year + 1):
        destino = FONTES / "ptax" / f"ptax_{ano}.json"
        corrente = ano == date.today().year
        baixar(URL_PTAX.format(ano=ano), destino, corrente or (forcar and ano >= ANO_FINAL - 1))
        serie = json.loads(destino.read_text())
        if not serie:
            continue
        valores = [float(x["valor"]) for x in serie]
        ptax[ano] = {"media": round(statistics.mean(valores), 4), "fim": valores[-1]}
        d, m, a = serie[-1]["data"].split("/")
        atual = {"data": f"{a}-{m}-{d}", "valor": valores[-1]}
    return ptax, atual


# ---------------------------------------------------------------- indicadores

def ajustar_escala_acoes(acoes, lucro_mil, lpa):
    """composicao_capital não informa escala: algumas empresas declaram ações em milhares.

    Compara com as ações implícitas no LPA da DRE (lucro / LPA) e multiplica por mil quando
    isso aproxima os dois números. Sem LPA, usa um piso: nenhuma listada tem menos de 1 milhão de ações.
    """
    if not acoes:
        return None
    if lpa and lucro_mil and abs(lpa) >= 0.05:
        implicitas = abs(lucro_mil * 1000 / lpa)
        if implicitas > 0 and abs(math.log(acoes * 1000 / implicitas)) < abs(math.log(acoes / implicitas)):
            return acoes * 1000
        return acoes
    return acoes * 1000 if acoes < 1_000_000 else acoes


def derivar(d):
    """Contas derivadas de um período (mesmas regras de montar_series), em R$ mil."""
    divida = d.get("divida_2.01", 0) + d.get("divida_2.02", 0) if ("divida_2.01" in d or "divida_2.02" in d) else None
    caixa = d["caixa"] + d.get("aplicacoes", 0) if "caixa" in d else None
    lucro_c = d.get("lucro_controladora") or d.get("lucro_liquido")
    return {
        "receita": d.get("receita"), "lucro_liquido": d.get("lucro_liquido"), "lucro_controladora": lucro_c,
        "ebit": d.get("ebit"), "ebitda": d["ebit"] + d.get("da", 0) if "ebit" in d else None,
        "fco": d.get("fco"), "capex": d.get("capex"),
        "dividendos_pagos": d.get("dividendos_pagos", 0 if "_fin_detalhado" in d else None),
        "ativo_total": d.get("ativo_total"), "pl": d.get("pl"),
        "pl_controladora": d["pl"] - d.get("pl_minoritarios", 0) if "pl" in d else None,
        "divida_bruta": divida, "caixa": caixa,
        "divida_liquida": divida - caixa if divida is not None and caixa is not None else None,
    }


FLUXOS_12M = ("receita", "lucro_liquido", "lucro_controladora", "ebit", "ebitda", "fco", "capex", "dividendos_pagos")
SALDOS_ITR = ("ativo_total", "pl", "pl_controladora", "divida_bruta", "caixa", "divida_liquida")


def carregar_itr(cnpjs, forcar):
    """ITR do último exercício fechado e do corrente (acumulados do ano). Renova a cada 7 dias."""
    itr = {}
    for ano in (ANO_FINAL, ANO_FINAL + 1):
        try:
            caminho = baixar(URL_ITR.format(ano=ano), FONTES / "itr" / f"itr_cia_aberta_{ano}.zip", forcar, max_dias=7)
        except Exception as e:  # noqa: BLE001
            print(f"  ITR {ano} indisponível: {e}")
            continue
        print(f"  lendo ITR {ano}")
        extrair_ano(zipfile.ZipFile(caminho), ano, cnpjs, itr, itr=True)
    return itr


def ultimos_12m(anos, s, periodos):
    """Últimos 12 meses = último exercício (DFP) + acumulado do ano corrente − acumulado do ano anterior,
    os dois do mesmo ITR. Saldos de balanço vêm do ITR mais recente. None sem ITR posterior à DFP."""
    datas = sorted(k for k in periodos if isinstance(k, str) and int(k[:4]) == anos[-1] + 1
                   and periodos[k].get("receita") is not None)
    if not datas:
        return None
    fim = datas[-1]
    antes = f"{int(fim[:4]) - 1}{fim[4:]}"
    if antes not in periodos:
        return None
    atual, anterior = derivar(periodos[fim]), derivar(periodos[antes])
    out = {"ate": fim}
    for k in FLUXOS_12M:
        fy = s[k][-1]
        if fy is not None and atual[k] is not None and anterior[k] is not None:
            out[k] = round(fy + atual[k] - anterior[k])
    for k in SALDOS_ITR:
        if atual[k] is not None:
            out[k] = round(atual[k])
    return out if "lucro_controladora" in out else None


def montar_series(anos_dados):
    anos = sorted(a for a in anos_dados if ANO_INICIAL - 1 <= a <= ANO_FINAL and "receita" in anos_dados[a])
    if not anos:
        return None
    s = {k: [] for k in ("receita", "lucro_bruto", "ebit", "lucro_liquido", "lucro_controladora",
                         "ebitda", "ativo_total", "pl", "pl_controladora", "divida_bruta", "caixa",
                         "divida_liquida", "fco", "fci", "fcf", "capex", "dividendos_pagos", "acoes",
                         "acoes_on", "acoes_pn", "lpa_declarado", "fco_operacoes", "fco_giro", "var_caixa", "fx_caixa")}

    def r(v):
        return None if v is None else round(v)

    for a in anos:
        d = anos_dados[a]
        divida = None
        if "divida_2.01" in d or "divida_2.02" in d:
            divida = d.get("divida_2.01", 0) + d.get("divida_2.02", 0)
        caixa = None
        if "caixa" in d:
            caixa = d["caixa"] + d.get("aplicacoes", 0)
        ebitda = d["ebit"] + d.get("da", 0) if "ebit" in d else None
        pl_c = d["pl"] - d.get("pl_minoritarios", 0) if "pl" in d else None
        lucro_c = d.get("lucro_controladora")
        if not lucro_c and d.get("lucro_liquido"):
            lucro_c = d["lucro_liquido"]  # há empresas que deixam a divisão controladora/minoritários zerada
        s["receita"].append(r(d.get("receita")))
        s["lucro_bruto"].append(r(d.get("lucro_bruto")))
        s["ebit"].append(r(d.get("ebit")))
        s["lucro_liquido"].append(r(d.get("lucro_liquido")))
        s["lucro_controladora"].append(r(lucro_c))
        s["ebitda"].append(r(ebitda))
        s["ativo_total"].append(r(d.get("ativo_total")))
        s["pl"].append(r(d.get("pl")))
        s["pl_controladora"].append(r(pl_c))
        s["divida_bruta"].append(r(divida))
        s["caixa"].append(r(caixa))
        s["divida_liquida"].append(r(divida - caixa) if divida is not None and caixa is not None else None)
        s["fco"].append(r(d.get("fco")))
        s["fci"].append(r(d.get("fci")))
        s["fcf"].append(r(d.get("fcf")))
        s["capex"].append(r(d.get("capex")))
        s["fco_operacoes"].append(r(d.get("fco_operacoes")))
        s["fco_giro"].append(r(d.get("fco_giro")))
        s["var_caixa"].append(r(d.get("var_caixa")))
        s["fx_caixa"].append(r(d.get("fx_caixa")))
        s["dividendos_pagos"].append(r(d.get("dividendos_pagos", 0 if "_fin_detalhado" in d else None)))
        acoes = ajustar_escala_acoes(d.get("acoes"), lucro_c, d.get("lpa_on"))
        anterior = next((x for x in reversed(s["acoes"]) if x), None)
        if acoes and anterior and acoes / anterior < 0.01 and 0.5 < acoes * 1000 / anterior < 2:
            acoes *= 1000  # salto de ~1000× sem evento societário: escala trocada naquele ano
        s["acoes"].append(acoes)
        s["lpa_declarado"].append(d.get("lpa_on"))
        # ON e PN seguem a mesma correção de escala do total
        fator = acoes / d["acoes"] if acoes and d.get("acoes") else 1
        s["acoes_on"].append(round(d["acoes_on"] * fator) if d.get("acoes_on") is not None else None)
        s["acoes_pn"].append(round(d["acoes_pn"] * fator) if d.get("acoes_pn") is not None else None)
        tesouraria = [round(d.get("tesouraria_on", 0) * fator), round(d.get("tesouraria_pn", 0) * fator)]
    s["_lpa_seguinte"] = [anos_dados[a].get("_lpa_on_seguinte") if anos_dados[a].get("_origem", {}).get("lpa_on")
                          else None for a in anos]
    estimar_acoes_antigas(anos, anos_dados, s)
    s["_tesouraria"] = tesouraria  # do último exercício; descontada da contagem atual da B3
    s["_fator_acoes"] = fator      # correção de escala do último exercício (vale também para o ITR)
    return anos, s


def estimar_acoes_antigas(anos, anos_dados, s):
    """A DFP só traz composicao_capital a partir de 2020. Antes disso, estima as ações pelo
    LPA ON declarado na DRE (lucro da controladora / LPA), que é a média ponderada do ano.
    Marca esses anos em s["acoes_estimadas"] para a interface avisar."""
    s["acoes_estimadas"] = [False] * len(anos)
    for i, a in enumerate(anos):
        if s["acoes"][i]:
            continue
        lpa, lucro = anos_dados[a].get("lpa_on"), s["lucro_controladora"][i]
        if not lpa or not lucro or abs(lpa) < 0.05:
            continue
        s["acoes"][i] = round(abs(lucro * 1000 / lpa))
        s["acoes_estimadas"][i] = True
    ancorar_estimativas(s)


def ancorar_estimativas(s):
    """LPA declarado por lote de mil ações (acontece): leva cada estimativa à ordem de grandeza do
    ano seguinte com quantidade, de trás para a frente a partir da primeira DFP. Salto de 300× ou
    mais de um ano para o outro é escala, não evento. Roda de novo depois de
    corrigir_escala_por_preco: a quantidade da DFP pode estar em milhares e só ser corrigida pelo
    preço (Portobello e Banrisul em 2020 deixavam as estimativas mil vezes menores)."""
    ac, est = s["acoes"], s["acoes_estimadas"]
    ref = None
    for i in range(len(ac) - 1, -1, -1):
        x = ac[i]
        if not x:
            continue
        if est[i] and ref:
            while x / ref > 300:
                x /= 1000
            while x / ref < 1 / 300:
                x *= 1000
            ac[i] = round(x)
        ref = ac[i]


def descartar_estimativas_isoladas(anos, s):
    """Ano estimado pelo LPA que destoa dos dois vizinhos por 3× ou mais, com os vizinhos de
    acordo entre si (±30%): lucro ou LPA daquele ano em outra escala (Portobello, 2019: 16 mi de
    ações entre 159 mi e 154 mi). A estimativa sai e o ano fica sem quantidade."""
    ac, est = s["acoes"], s["acoes_estimadas"]
    for k in range(1, len(anos) - 1):
        if not est[k] or not (ac[k - 1] and ac[k] and ac[k + 1]):
            continue
        r1, r2 = ac[k] / ac[k - 1], ac[k + 1] / ac[k]
        if abs(math.log(r1)) >= LOG_3 and abs(math.log(r2)) >= LOG_3 and 0.77 < r1 * r2 < 1.3:
            ac[k], est[k] = None, False


def corrigir_ano_pelo_lpa(anos, s):
    """Quantidade da DFP que destoa num ano só: os dois vizinhos e as ações implícitas no LPA do
    ano (lucro / LPA) concordam entre si (±15%) e a quantidade declarada fica a mais de 30% de
    todos (PetroRio, 2022: 491 mi de ações entre 839 mi e 835 mi, com LPA que implica 844 mi).
    Fica a quantidade implícita no LPA; o ano entra em s["acoes_corrigidas"]."""
    ac, est, lpa, luc = s["acoes"], s["acoes_estimadas"], s["lpa_declarado"], s["lucro_controladora"]
    for k in range(1, len(anos) - 1):
        if est[k - 1] or est[k] or est[k + 1] or not (ac[k - 1] and ac[k] and ac[k + 1]):
            continue
        if not lpa[k] or not luc[k] or abs(lpa[k]) < 0.05:
            continue
        impl = abs(luc[k] * 1000 / lpa[k])
        if all(0.87 < impl / ac[j] < 1.15 for j in (k - 1, k + 1)) and not 0.77 < ac[k] / impl < 1.3:
            fator = impl / ac[k]
            for chave in ("acoes", "acoes_on", "acoes_pn"):
                if s[chave][k]:
                    s[chave][k] = round(s[chave][k] * fator)
            s.setdefault("acoes_corrigidas", []).append(anos[k])


def acoes_cvm(comp, s, fator, b3=None):
    """Ações do formulário mais recente entregue à CVM (DFP ou ITR): emitidas ON e PN e em tesouraria.
    A composição do capital não informa escala; usa a correção do último exercício e, se o ITR vier
    em outra escala (milhares), acerta pela ordem de grandeza da série anual."""
    if not comp:
        return None
    data = max(comp)
    on, pn, t_on, t_pn, fonte = comp[data]
    circ, alvo = on + pn - t_on - t_pn, next((x for x in reversed(s["acoes"]) if x), None)
    if circ <= 0:
        return None
    f = fator or 1
    if alvo:
        while circ * f / alvo > 300:
            f /= 1000
        while circ * f / alvo < 1 / 300:
            f *= 1000
        # DFP e B3 concordam e o ITR difere por potência exata de 10: escala trocada no formulário
        # (BGIP4 e FIEI3 em 2026). Grupamento e desdobramento mudariam também a B3, então ficam.
        if b3 and 0.9 < alvo / b3 < 1.1:
            razao = circ * f / b3
            k = round(math.log10(razao))
            if k != 0 and abs(razao / 10 ** k - 1) < 0.01:
                f /= 10 ** k
    r = lambda x: round(x * f)  # noqa: E731
    return {"data": data, "fonte": fonte, "on": r(on), "pn": r(pn), "tesouraria_on": r(t_on), "tesouraria_pn": r(t_pn)}


# ---------------------------------------------------------------- cotações (B3)

def ler_cotahist(caminho, tickers=None):
    """{ticker: (data 'AAAA-MM-DD', fechamento R$, volume R$)} do último pregão de cada ticker no arquivo.

    Layout fixo da B3 (SeriesHistoricas_Layout.pdf): só mercado à vista (010), lote padrão (CODBDI 02) e papéis em regime especial/recuperação (05–08).
    """
    out = {}
    with zipfile.ZipFile(caminho) as zf:
        with zf.open(zf.namelist()[0]) as f:
            for linha in f:
                if linha[:2] != b"01" or linha[24:27] != b"010" or linha[10:12] not in CODBDI:
                    continue
                t = linha[12:24].strip().decode("latin-1")
                if tickers is None:
                    if not ESPECIE_ACAO.match(linha[39:49].decode("latin-1")):
                        continue  # BDR, fundo, recibo, direito…
                elif t not in tickers:
                    continue
                d = linha[2:10].decode()
                fator = int(linha[210:217]) or 1
                preco = int(linha[108:121]) / 100 / fator
                vol = int(linha[170:188]) / 100
                data = f"{d[:4]}-{d[4:6]}-{d[6:]}"
                if t not in out or data >= out[t][0]:
                    out[t] = (data, preco, vol)
    return out


def baixar_dia(dia: date, insistir=False):
    """Arquivo diário da B3; None se não houve pregão (ou a B3 ainda não publicou).

    Um 404 vira marca (.404) e o dia não é pedido de novo depois de uma semana. Com insistir=True a
    marca é ignorada: a B3 às vezes responde 404 para um arquivo que existe, e no fim do ano isso fazia
    a base guardar o fechamento do pregão anterior ao último (achado pelo cruzamento preço de fim de
    exercício × histórico diário, em scripts/qualidade.py: 2020 e 2024)."""
    nome = f"COTAHIST_D{dia:%d%m%Y}.ZIP"
    destino = FONTES / "cotahist" / nome
    marca = destino.with_suffix(".404")
    if destino.exists():
        return destino
    if marca.exists() and (date.today() - dia).days > 7 and not insistir:
        return None
    try:
        return baixar(URL_COTA.format(nome=nome), destino)
    except urllib.error.HTTPError as e:
        if e.code == 404:  # não houve pregão (feriado) ou a B3 ainda não publicou
            marca.parent.mkdir(parents=True, exist_ok=True)
            marca.touch()
        else:
            print(f"  aviso: {nome} falhou com HTTP {e.code}; fica de fora desta execução")
        return None
    except Exception as e:  # noqa: BLE001
        print(f"  aviso: {nome} falhou ({e}); fica de fora desta execução")
        return None


def carregar_cotacoes(tickers):
    """Fechamento no último pregão de cada ano e, para hoje, preço e volume médio do último mês."""
    anuais = {}
    for ano in range(ANO_INICIAL - 1, ANO_FINAL + 1):
        if ano < 2018:  # a B3 só mantém arquivos diários a partir de 2018
            nome = f"COTAHIST_A{ano}.ZIP"
            try:
                caminho = baixar(URL_COTA.format(nome=nome), FONTES / "cotahist" / nome)
            except Exception as e:  # noqa: BLE001
                print(f"  cotações {ano} indisponíveis: {e}")
                continue
            anuais[ano] = ler_cotahist(caminho, tickers)
            continue
        # último pregão do ano: volta a partir de 31/12; pega também o pregão anterior,
        # para não perder ticker pouco negociado naquele dia
        achados = {}
        dia, arquivos = date(ano, 12, 31), 0
        while arquivos < 5 and dia.month == 12 and dia.day > 10:
            if dia.weekday() < 5:
                caminho = baixar_dia(dia, insistir=True)  # o último pregão do ano não pode faltar
                if caminho:
                    for t, v in ler_cotahist(caminho, tickers).items():
                        achados.setdefault(t, v)
                    arquivos += 1
            dia = date.fromordinal(dia.toordinal() - 1)
        anuais[ano] = achados
        print(f"  cotações {ano}: {len(achados)} tickers")

    # recente: até 21 pregões nos últimos 45 dias
    recentes, volumes = {}, {}
    dia, pregoes = date.today(), 0
    while pregoes < 21 and (date.today() - dia).days <= 45:
        if dia.weekday() < 5:
            caminho = baixar_dia(dia)
            if caminho:
                pregoes += 1
                for t, (data, preco, vol) in ler_cotahist(caminho, tickers).items():
                    recentes.setdefault(t, (data, preco))
                    volumes.setdefault(t, []).append(vol)
        dia = date.fromordinal(dia.toordinal() - 1)
    # volume médio por pregão do período (dias sem negócio contam como zero)
    vol_medio = {t: sum(v) / max(pregoes, 1) for t, v in volumes.items()}
    print(f"  cotações recentes: {pregoes} pregões, {len(recentes)} tickers")
    return anuais, recentes, vol_medio


def preco_por_classe(precos, tickers, units):
    """Preço de uma ação ON e de uma PN; units entram divididas pela composição quando a classe não negocia."""
    def classe(t):
        m = re.match(r"\d+", t[4:])  # raiz de 4 caracteres, às vezes com dígito (B3SA3); balcão: "3B"
        suf = m.group(0) if m else ""
        return "on" if suf == "3" else "pn" if suf in ("4", "5", "6", "7", "8") else None

    p = {}
    for t in tickers:
        c = classe(t)
        if c and t in precos and c not in p:
            p[c] = precos[t]
    if ("on" not in p or "pn" not in p):
        for t, (on, pn) in units.items():
            if t in precos and on + pn > 0:
                por_acao = precos[t] / (on + pn)
                p.setdefault("on", por_acao)
                p.setdefault("pn", por_acao)
    if "on" in p and "pn" not in p:
        p["pn"] = p["on"]
    if "pn" in p and "on" not in p:
        p["on"] = p["pn"]
    return p


def corrigir_escala_por_preco(anos, s, precos_ano):
    """Ações que saltam por potência de 10 sem o preço cair na mesma proporção são erro de
    preenchimento (ex.: CSN Mineração declarou 54 bi de ações em 2025, contra 5,4 bi em 2024).

    Desdobramento ou grupamento de verdade mantém o valor de mercado contínuo (ações × preço
    variam em sentidos opostos). Quando não mantém e o salto é potência de 10, corrige o ano cuja
    quantidade mais se afasta das ações implícitas no LPA declarado (lucro / LPA).
    Sem LPA, corrige o ano mais distante da mediana da série. Os anos corrigidos ficam em
    s["acoes_corrigidas"].
    """
    s["acoes_corrigidas"] = []
    for _ in range(3):  # uma correção pode revelar o salto vizinho (Vivo: 2020 e 2021 em milhares)
        antes = len(s["acoes_corrigidas"])
        _corrigir_uma_passada(anos, s, precos_ano)
        if len(s["acoes_corrigidas"]) == antes:
            break


def _corrigir_uma_passada(anos, s, precos_ano):
    for i in range(1, len(anos)):
        a0, a1 = s["acoes"][i - 1], s["acoes"][i]
        if not a0 or not a1 or s["acoes_estimadas"][i] or s["acoes_estimadas"][i - 1]:
            continue
        r = a1 / a0
        if 0.55 < r < 1.8:
            continue
        k = round(math.log10(r))
        potencia_de_10 = k != 0 and abs(math.log10(r) - k) <= 0.05
        q = None
        for v in precos_ano.values():
            if v[i - 1] and v[i]:
                q = v[i] / v[i - 1]
                break
        if q is not None and 0.2 < r * q < 5:
            continue  # valor de mercado não salta 5×: pode ser evento societário real, não mexe

        def distancia(j, acoes):
            lpa, luc = s["lpa_declarado"][j], s["lucro_controladora"][j]
            if not lpa or not luc or abs(lpa) < 0.05:
                return None
            return abs(math.log10(acoes / abs(luc * 1000 / lpa)))

        alvo = None
        if not potencia_de_10:
            # salto qualquer (IMC, 2025: 285 mi → 5,7 bi): só corrige se o LPA do ano confirma
            # a quantidade do ano anterior e desmente a declarada
            d_decl, d_ant = distancia(i, a1), distancia(i, a0)
            if d_decl is not None and d_decl > 0.5 and d_ant < 0.15:
                alvo = (i, a0 / a1)
            if alvo is None:
                continue
        # 1) evidência do LPA: o ano corrigido passa a bater com as ações implícitas (±60%)
        for j, fator in ((i, 10 ** -k), (i - 1, 10 ** k)) if alvo is None else ():
            antes, depois = distancia(j, s["acoes"][j]), distancia(j, s["acoes"][j] * fator)
            if antes is not None and depois < 0.2 < antes:
                alvo = (j, fator)
                break
        # 2) sem LPA: só com valor de mercado saltando mais de 5×; corrige o ano mais distante
        #    da mediana da série da empresa (o erro costuma ser um ano isolado)
        if alvo is None and q is not None and potencia_de_10:
            logs = [math.log10(x) for x, e in zip(s["acoes"], s["acoes_estimadas"]) if x and not e]
            mediana = statistics.median(logs)
            if abs(math.log10(a0) - mediana) > abs(math.log10(a1) - mediana):
                alvo = (i - 1, 10 ** k)
            else:
                alvo = (i, 10 ** -k)
        if alvo is None:
            continue
        j, fator = alvo
        for chave in ("acoes", "acoes_on", "acoes_pn"):
            if s[chave][j]:
                s[chave][j] = round(s[chave][j] * fator)
        s["acoes_corrigidas"].append(anos[j])


def valor_mercado(precos, tickers, units, acoes_on, acoes_pn, acoes_total):
    """Em R$ mil. Soma ON e PN a seus preços; sem a divisão por classe, usa o total ao preço disponível."""
    p = preco_por_classe(precos, tickers, units)
    if not p:
        return None
    if acoes_on is not None and acoes_pn is not None and acoes_on + acoes_pn > 0:
        return round((acoes_on * p["on"] + acoes_pn * p["pn"]) / 1000)
    if acoes_total:
        return round(acoes_total * p["on"] / 1000)
    return None


def clamp(x):
    return max(0.0, min(1.0, x))


def indice_previsibilidade(anos, s, ptax=None):
    """Índice 0–100 nos últimos ANOS_SCORE exercícios. Com ptax, receita e lucro vão para USD (média do ano).

    Componentes (pesos):
      30  lucro positivo        — fração dos anos com lucro líquido > 0
      25  margem estável        — 1 − desvio-padrão da margem líquida / 15 p.p.
      15  receita estável       — 1 − desvio-padrão do crescimento anual da receita / 30 p.p.
      15  crescimento constante — R² da tendência linear da receita (0 se a tendência cai)
      15  dividendos regulares  — fração dos anos com dividendos/JCP pagos (sem dado, o peso
                                  é redistribuído entre os demais)
    """
    pontos = [(a, rec, luc, div) for a, rec, luc, div in
              zip(anos, s["receita"], s["lucro_liquido"], s["dividendos_pagos"])
              if rec is not None and luc is not None][-ANOS_SCORE:]
    if len(pontos) < MIN_ANOS_SCORE:
        return None
    if ptax:
        pontos = [(a, rec / ptax[a]["media"], luc / ptax[a]["media"], div) for a, rec, luc, div in pontos]

    lucros = [p[2] for p in pontos]
    receitas = [p[1] for p in pontos]
    c_lucro = sum(1 for l in lucros if l > 0) / len(lucros)

    margens = [l / r for r, l in zip(receitas, lucros) if r and r > 0]
    margens = [max(-1.0, min(1.0, m)) for m in margens]
    c_margem = clamp(1 - statistics.pstdev(margens) / 0.15) if len(margens) >= 3 else 0.0

    cresc = [receitas[i] / receitas[i - 1] - 1 for i in range(1, len(receitas))
             if receitas[i - 1] and receitas[i - 1] > 0 and receitas[i] is not None]
    cresc = [max(-1.0, min(2.0, g)) for g in cresc]
    c_receita = clamp(1 - statistics.pstdev(cresc) / 0.30) if len(cresc) >= 3 else 0.0

    xs = list(range(len(receitas)))
    mx, my = statistics.mean(xs), statistics.mean(receitas)
    sxx = sum((x - mx) ** 2 for x in xs)
    sxy = sum((x - mx) * (y - my) for x, y in zip(xs, receitas))
    syy = sum((y - my) ** 2 for y in receitas)
    c_tend = (sxy * sxy / (sxx * syy)) if sxy > 0 and syy > 0 else 0.0

    divs = [p[3] for p in pontos if p[3] is not None]
    # sem fluxo de financiamento detalhado não se sabe se houve dividendo: o peso vai para os demais
    c_div = sum(1 for d in divs if d > 0) / len(divs) if len(divs) >= MIN_ANOS_SCORE else None

    comp = {"lucro": c_lucro, "margem": c_margem, "receita": c_receita, "tendencia": c_tend, "dividendos": c_div}
    pesos = {"lucro": 30, "margem": 25, "receita": 15, "tendencia": 15, "dividendos": 15}
    usados = {k: w for k, w in pesos.items() if comp[k] is not None}
    total = sum(comp[k] * w for k, w in usados.items()) * 100 / sum(usados.values())
    return {
        "total": round(total),
        "componentes": {k: None if v is None else round(v * 100) for k, v in comp.items()},
        "anos": [pontos[0][0], pontos[-1][0]],
    }


# ---------------------------------------------------------------- principal

def cnpjs_publicados():
    """CNPJs da base publicada (data/empresas.js): quem já está nela só sai abaixo de LIQUIDEZ_SAIDA."""
    if not SAIDA.exists():
        return set()
    try:
        texto = SAIDA.read_text(encoding="utf-8")
        return {e["cnpj"] for e in json.loads(texto.split("=", 1)[1].rstrip().rstrip(";"))["empresas"]}
    except (ValueError, KeyError, IndexError):
        return set()


def no_corte(volume_dia, ja_publicada):
    """Fica na base: volume médio diário ≥ LIQUIDEZ_MIN, ou ≥ LIQUIDEZ_SAIDA para quem já estava."""
    return volume_dia >= (LIQUIDEZ_SAIDA if ja_publicada else LIQUIDEZ_MIN)


def aplicar_corte(cad, vol_medio, publicadas):
    """Tira do cadastro as empresas abaixo do corte de liquidez, antes de qualquer outro passo."""
    fora = {c for c, info in cad.items()
            if not no_corte(sum(vol_medio.get(t, 0) for t in info["tickers"]), c in publicadas)}
    print(f"  corte de liquidez (R$ {LIQUIDEZ_MIN / 1e6:.1f} mi/dia; R$ {LIQUIDEZ_SAIDA / 1e6:.1f} mi para quem já estava): "
          f"{len(cad) - len(fora)} ficam, {len(fora)} saem")
    return {c: i for c, i in cad.items() if c not in fora}


def main():
    forcar = "--rebaixar" in sys.argv
    print("Cotações (B3)…")
    anuais, recentes, vol_medio = carregar_cotacoes(None)
    # papéis vivos: negociados no último mês ou no fim dos dois últimos exercícios
    negociados = set(recentes) | set(anuais.get(ANO_FINAL, {})) | set(anuais.get(ANO_FINAL - 1, {}))

    print("Cadastro (FCA + lista de emissores da B3)…")
    cad = carregar_cadastro(forcar, negociados, carregar_empresas_b3(forcar))
    # --corte-estrito: ignora a folga de quem já estava (usado na primeira aplicação do corte)
    cad = aplicar_corte(cad, vol_medio, set() if "--corte-estrito" in sys.argv else cnpjs_publicados())
    cnpjs = set(cad)

    print("Fichas dos emissores (B3)…")
    sups = carregar_suplementos({t[:4] for info in cad.values() for t in info["tickers"]}, forcar)

    print("Demonstrações (DFP)…")
    base = {}
    for ano in range(ANO_INICIAL, ANO_FINAL + 1):
        try:
            caminho = baixar(URL_DFP.format(ano=ano), FONTES / "dfp" / f"dfp_cia_aberta_{ano}.zip",
                             forcar and ano >= ANO_FINAL - 3, max_dias=7 if ano >= ANO_FINAL - 1 else None)
        except Exception as e:  # noqa: BLE001
            print(f"  DFP {ano} indisponível: {e}")
            continue
        print(f"  lendo {ano}")
        extrair_ano(zipfile.ZipFile(caminho), ano, cnpjs, base)

    print("Demonstrações trimestrais (ITR)…")
    itr = carregar_itr(cnpjs, forcar)

    print("PTAX (BCB)…")
    ptax, ptax_atual = carregar_ptax(forcar)


    empresas = []
    agenda = {}
    for cnpj, info in cad.items():
        if cnpj not in base:
            continue
        res = montar_series(base[cnpj])
        if not res:
            continue
        anos, s = res
        if anos[-1] < ANO_FINAL - 1:
            continue  # sem demonstração recente (deslistada ou inadimplente com a CVM)
        financeiro = any(base[cnpj][a].get("_financeiro") for a in anos) or \
            any(p in info["setor"].lower() for p in SETORES_FINANCEIROS)

        tk, units = info["tickers"], info["units"]
        # fechamento de cada ticker no fim de cada exercício e valor de mercado na mesma data
        precos_ano = {t: [anuais.get(a, {}).get(t, (None, None))[1] for a in anos] for t in tk}
        corrigir_escala_por_preco(anos, s, precos_ano)
        ancorar_estimativas(s)
        corrigir_ano_pelo_lpa(anos, s)
        descartar_estimativas_isoladas(anos, s)
        s["valor_mercado"] = [
            valor_mercado({t: precos_ano[t][i] for t in tk if precos_ano[t][i]}, tk, units,
                          s["acoes_on"][i], s["acoes_pn"][i], s["acoes"][i])
            for i in range(len(anos))
        ]
        cotacao = {t: {"preco": recentes[t][1], "data": recentes[t][0], "volume": round(vol_medio.get(t, 0))}
                   for t in tk if t in recentes}
        precos_hoje = {t: c["preco"] for t, c in cotacao.items()}
        vm_dfp = valor_mercado(precos_hoje, tk, units, s["acoes_on"][-1], s["acoes_pn"][-1], s["acoes"][-1])
        # quantidade de ações vigente segundo a B3 (prevalece sobre a do último balanço)
        sup = next((sups[r] for r in dict.fromkeys(t[:4] for t in tk) if r in sups), None)
        acoes_b3 = None
        tes_on, tes_pn = s.pop("_tesouraria", [0, 0])
        fator_acoes = s.pop("_fator_acoes", 1)
        if sup and num_br(sup.get("totalNumberShares")) > 0:
            on, pn = num_br(sup.get("numberCommonShares")), num_br(sup.get("numberPreferredShares"))
            # a B3 informa o total emitido; tira a tesouraria do último balanço (mesmo critério do LPA)
            acoes_b3 = {"on": round(on - tes_on if on > tes_on else on),
                        "pn": round(pn - tes_pn if pn > tes_pn else pn),
                        "tesouraria": tes_on + tes_pn}
        cvm = acoes_cvm(COMPOSICAO.get(cnpj), s, fator_acoes, acoes_b3 and acoes_b3["on"] + acoes_b3["pn"])
        eventos = eventos_da_empresa(anos, s, precos_ano, eventos_acoes(sup))
        ajustar_valor_mercado(anos, s, eventos)
        s.pop("_lpa_seguinte", None)
        vm_atual = valor_mercado(precos_hoje, tk, units, acoes_b3["on"], acoes_b3["pn"],
                                 acoes_b3["on"] + acoes_b3["pn"]) if acoes_b3 else vm_dfp
        prov = proventos_12m(sup, tk) if sup else {}
        if sup:
            itens = proventos_agenda(sup, tk)
            if itens:
                agenda[cnpj] = itens
        prov_total = None
        if acoes_b3 and prov:
            r_on = max((v for t, v in prov.items() if t[4:].startswith("3")), default=0)
            r_pn = max((v for t, v in prov.items() if re.match(r"[4-8]", t[4:])), default=0)
            prov_total = round((r_on * acoes_b3["on"] + r_pn * acoes_b3["pn"]) / 1000)
        empresas.append({
            **info,
            "ticker": ticker_principal(tk, vol_medio),
            "financeiro": financeiro,
            "individual": bool(base[cnpj][anos[-1]].get("_individual")),
            "cotacao": cotacao,
            "valor_mercado": vm_atual,
            "ttm": ultimos_12m(anos, s, itr.get(cnpj, {})),
            "valor_mercado_dfp": vm_dfp,
            "acoes_b3": acoes_b3,
            "acoes_cvm": cvm,
            "eventos_acoes": eventos,
            "proventos_12m": prov_total,
            "dy12m": {t: round(v / precos_hoje[t], 4) for t, v in prov.items() if precos_hoje.get(t)},
            "liquidez": round(sum(c["volume"] for c in cotacao.values())),
            "precos_ano": {t: v for t, v in precos_ano.items() if any(v)},
            "anos": anos,
            "series": s,
            "score": {
                "brl": indice_previsibilidade(anos, s),
                "usd": indice_previsibilidade(anos, s, ptax),
            },
        })

    empresas.sort(key=lambda e: e["ticker"])
    dados = {
        "gerado_em": datetime.now().strftime("%Y-%m-%d %H:%M"),
        "ano_final": ANO_FINAL,
        "unidade": "R$ mil",
        "ptax": {str(a): v for a, v in ptax.items()},
        "ptax_atual": ptax_atual,
        "cotacoes_em": max((c["data"] for e in empresas for c in e["cotacao"].values()), default=None),
        "empresas": empresas,
    }
    SAIDA.parent.mkdir(parents=True, exist_ok=True)
    if SAIDA.exists():  # base anterior, para scripts/mudancas.py quando não há git
        (FONTES / "empresas_anterior.js").write_bytes(SAIDA.read_bytes())
    js = json.dumps(dados, ensure_ascii=False, separators=(",", ":"))
    SAIDA.write_text(f"// Gerado por scripts/processar.py — não edite à mão.\nwindow.DADOS = {js};\n", encoding="utf-8")
    ag = json.dumps({"gerado_em": dados["gerado_em"], "empresas": agenda}, ensure_ascii=False, separators=(",", ":"))
    SAIDA_AGENDA.write_text(f"// Gerado por scripts/processar.py — não edite à mão.\nwindow.AGENDA = {ag};\n", encoding="utf-8")
    print(f"{len(empresas)} empresas → {SAIDA.relative_to(RAIZ)} ({SAIDA.stat().st_size / 1e6:.1f} MB)")
    from versionar import versionar
    versionar()  # ?v= dos assets no index.html acompanha o conteúdo


if __name__ == "__main__":
    main()
