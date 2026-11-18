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
SAIDA = RAIZ / "data" / "empresas.js"

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

    # Ações em circulação (só DFP; a quantidade atual vem da B3) ------------
    nome = nomes.get("composicao_capital")
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
    estimar_acoes_antigas(anos, anos_dados, s)
    s["_tesouraria"] = tesouraria  # do último exercício; descontada da contagem atual da B3
    return anos, s


def estimar_acoes_antigas(anos, anos_dados, s):
    """A DFP só traz composicao_capital a partir de 2020. Antes disso, estima as ações pelo
    LPA ON declarado na DRE (lucro da controladora / LPA), que é a média ponderada do ano.
    Marca esses anos em s["acoes_estimadas"] para a interface avisar."""
    s["acoes_estimadas"] = [False] * len(anos)
    conhecidas = next((x for x in s["acoes"] if x), None)
    for i, a in enumerate(anos):
        if s["acoes"][i]:
            continue
        lpa, lucro = anos_dados[a].get("lpa_on"), s["lucro_controladora"][i]
        if not lpa or not lucro or abs(lpa) < 0.05:
            continue
        estimada = abs(lucro * 1000 / lpa)
        if conhecidas:
            # LPA declarado por lote de mil ações (acontece): corrige pela ordem de grandeza
            while estimada / conhecidas > 300:
                estimada /= 1000
            while estimada / conhecidas < 1 / 300:
                estimada *= 1000
        s["acoes"][i] = round(estimada)
        s["acoes_estimadas"][i] = True


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


def baixar_dia(dia: date):
    """Arquivo diário da B3; None se não houve pregão (ou a B3 ainda não publicou)."""
    nome = f"COTAHIST_D{dia:%d%m%Y}.ZIP"
    destino = FONTES / "cotahist" / nome
    marca = destino.with_suffix(".404")
    if destino.exists():
        return destino
    if marca.exists() and (date.today() - dia).days > 7:
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
                caminho = baixar_dia(dia)
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

def main():
    forcar = "--rebaixar" in sys.argv
    print("Cotações (B3)…")
    anuais, recentes, vol_medio = carregar_cotacoes(None)
    # papéis vivos: negociados no último mês ou no fim dos dois últimos exercícios
    negociados = set(recentes) | set(anuais.get(ANO_FINAL, {})) | set(anuais.get(ANO_FINAL - 1, {}))

    print("Cadastro (FCA + lista de emissores da B3)…")
    cad = carregar_cadastro(forcar, negociados, carregar_empresas_b3(forcar))
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
        if sup and num_br(sup.get("totalNumberShares")) > 0:
            on, pn = num_br(sup.get("numberCommonShares")), num_br(sup.get("numberPreferredShares"))
            # a B3 informa o total emitido; tira a tesouraria do último balanço (mesmo critério do LPA)
            acoes_b3 = {"on": round(on - tes_on if on > tes_on else on),
                        "pn": round(pn - tes_pn if pn > tes_pn else pn),
                        "tesouraria": tes_on + tes_pn}
        vm_atual = valor_mercado(precos_hoje, tk, units, acoes_b3["on"], acoes_b3["pn"],
                                 acoes_b3["on"] + acoes_b3["pn"]) if acoes_b3 else vm_dfp
        prov = proventos_12m(sup, tk) if sup else {}
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
    print(f"{len(empresas)} empresas → {SAIDA.relative_to(RAIZ)} ({SAIDA.stat().st_size / 1e6:.1f} MB)")
    from versionar import versionar
    versionar()  # ?v= dos assets no index.html acompanha o conteúdo


if __name__ == "__main__":
    main()
