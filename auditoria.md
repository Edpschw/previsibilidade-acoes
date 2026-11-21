# Auditoria da base

Gerada em 21/11/2026 sobre `data/empresas.js` de 2026-11-21 04:03 (balanços até 2025, cotações até 2026-11-19). Refaça com `python3 scripts/auditar.py --externo`.

## 1. Cobertura

| Etapa | Quantidade |
|---|---|
| Emissores com ação ON/PN/unit negociada na B3 nos últimos 21 pregões (raiz do ticker) | 302 |
| Tickers de ação negociados nesse período | 389 |
| Emissores de ações na lista oficial da B3 (tipo 1) | 566 |
| Companhias ativas na CVM com ação na B3 (FCA + lista da B3) | 345 |
| Empresas na base | 189 |
| … das quais negociaram no período | 189 |
| Emissores negociados na B3 que estão na base | 189 de 302 (63%) |

Referências externas:

- FGV, jan/2026: empresas listadas na B3: **pouco mais de 370**
- Bpmoney, 2026: companhias listadas na B3: **393**
- CVM, Boletim Econômico 111 (3º tri/2026): companhias abertas, estrangeiras e incentivadas com registro ativo: **684**

Leitura: a B3 conta como "listada" toda empresa com registro, inclusive as que quase não negociam e as de balcão organizado; a CVM soma companhias sem ação em bolsa (só dívida), estrangeiras e incentivadas. O número comparável é o de emissores com ação negociada, acima.

### Negociadas na B3 e ausentes da base

Ordenadas por volume médio diário. Cada linha diz em que etapa a empresa caiu.

| Ticker | Nome na B3 | Volume/dia | Motivo |
|---|---|---|---|

### Na base sem negócio na B3 no período

nenhuma

## 2. Consistência

| Severidade | Regra | Ocorrências |
|---|---|---|
| alta | LPA divergente | 4 |
| média | ações B3 × DFP | 16 |
| média | margem líquida extrema | 5 |
| média | DY acima de 30% | 5 |
| média | receita não positiva | 2 |
| média | LPA com sinal trocado na DRE | 2 |
| média | P/L extremo | 1 |
| média | P/VP extremo | 1 |
| média | buraco no histórico | 1 |
| baixa | salto de ações | 50 |
| baixa | LPA divergente | 25 |
| baixa | receita salta | 16 |
| baixa | LPA com sinal trocado na DRE | 9 |
| baixa | controladora × consolidado | 9 |
| baixa | preço mudou de escala | 6 |
| baixa | sem últimos 12 meses | 4 |
| baixa | ITR atrasado | 3 |
| baixa | fluxo de caixa não fecha | 3 |
| baixa | LPA declarado por lote de mil | 3 |
| baixa | dividendos > 3× lucro | 2 |
| baixa | unit sem composição | 1 |
| info | DY 12m × DY do exercício | 44 |
| info | caixa operacional > 2× EBITDA | 8 |
| info | só demonstração individual | 5 |
| info | PL negativo | 4 |

### Ocorrências de severidade alta e média

| Ticker | Empresa | Sev. | Regra | Detalhe |
|---|---|---|---|---|
| AZUL3 | AZUL | alta | LPA divergente | 2025: calculado R$ 0.04 × declarado R$ 0.16 (razão 0.26) |
| ENEV3 | ENEVA | alta | LPA divergente | 2025: calculado R$ 0.60 × declarado R$ 1.00 (razão 0.60) |
| HBRE3 | HBR Realty Empreendimentos Imobiliários | alta | LPA divergente | 2025: calculado R$ 0.27 × declarado R$ 0.94 (razão 0.28) |
| TFCO4 | TRACK & FIELD CO | alta | LPA divergente | 2025: calculado R$ 0.15 × declarado R$ 0.09 (razão 1.61) |
| DIRR3 | DIRECIONAL ENGENHARIA | média | DY acima de 30% | 32% (dividendo extraordinário ou valor de mercado subestimado) |
| LAVV3 | Lavvi Empreendimentos Imobiliários | média | DY acima de 30% | 30% (dividendo extraordinário ou valor de mercado subestimado) |
| POMO4 | MARCOPOLO | média | DY acima de 30% | 32% (dividendo extraordinário ou valor de mercado subestimado) |
| RIAA3 | GUARARAPES CONFECCOES | média | DY acima de 30% | 39% (dividendo extraordinário ou valor de mercado subestimado) |
| SYNE3 | SYN PROP & TECH | média | DY acima de 30% | 32% (dividendo extraordinário ou valor de mercado subestimado) |
| HBSA3 | HIDROVIAS DO BRASIL | média | LPA com sinal trocado na DRE | 2025: lucro -140,918 mas LPA declarado +0.05 (erro de preenchimento da empresa) |
| OBTC3 | ORANJEBTC | média | LPA com sinal trocado na DRE | 2025: lucro -469,986 mas LPA declarado +2.79 (erro de preenchimento da empresa) |
| DXCO3 | DEXCO | média | P/L extremo | 3586.1x |
| GFSA3 | GAFISA | média | P/VP extremo | 0.02x |
| AUAU3 | União Pet Participações | média | ações B3 × DFP | valor de mercado com ações da B3 hoje é 2.11× o calculado com as da DFP de 2025 (emissão, recompra, grupamento depois do balanço, ou DFP errada); prevalece a B3 |
| AZEV3 | AZEVEDO E TRAVASSOS | média | ações B3 × DFP | valor de mercado com ações da B3 hoje é 0.19× o calculado com as da DFP de 2025 (emissão, recompra, grupamento depois do balanço, ou DFP errada); prevalece a B3 |
| AZUL3 | AZUL | média | ações B3 × DFP | valor de mercado com ações da B3 hoje é 0.13× o calculado com as da DFP de 2025 (emissão, recompra, grupamento depois do balanço, ou DFP errada); prevalece a B3 |
| BHIA3 | Grupo Casas Bahia | média | ações B3 × DFP | valor de mercado com ações da B3 hoje é 1.55× o calculado com as da DFP de 2025 (emissão, recompra, grupamento depois do balanço, ou DFP errada); prevalece a B3 |
| ENJU3 | ENJOEI | média | ações B3 × DFP | valor de mercado com ações da B3 hoje é 0.10× o calculado com as da DFP de 2025 (emissão, recompra, grupamento depois do balanço, ou DFP errada); prevalece a B3 |
| GFSA3 | GAFISA | média | ações B3 × DFP | valor de mercado com ações da B3 hoje é 16.37× o calculado com as da DFP de 2025 (emissão, recompra, grupamento depois do balanço, ou DFP errada); prevalece a B3 |
| HBRE3 | HBR Realty Empreendimentos Imobiliários | média | ações B3 × DFP | valor de mercado com ações da B3 hoje é 1.88× o calculado com as da DFP de 2025 (emissão, recompra, grupamento depois do balanço, ou DFP errada); prevalece a B3 |
| LIGT3 | LIGHT | média | ações B3 × DFP | valor de mercado com ações da B3 hoje é 4.32× o calculado com as da DFP de 2025 (emissão, recompra, grupamento depois do balanço, ou DFP errada); prevalece a B3 |
| NATU3 | NATURA COSMÉTICOS | média | ações B3 × DFP | valor de mercado com ações da B3 hoje é 0.78× o calculado com as da DFP de 2025 (emissão, recompra, grupamento depois do balanço, ou DFP errada); prevalece a B3 |
| OPCT3 | Oceanpact Serviços Maritimos | média | ações B3 × DFP | valor de mercado com ações da B3 hoje é 2.38× o calculado com as da DFP de 2025 (emissão, recompra, grupamento depois do balanço, ou DFP errada); prevalece a B3 |
| ORVR3 | Orizon Valorização de Resíduos | média | ações B3 × DFP | valor de mercado com ações da B3 hoje é 5.71× o calculado com as da DFP de 2025 (emissão, recompra, grupamento depois do balanço, ou DFP errada); prevalece a B3 |
| PMAM3 | PARANAPANEMA | média | ações B3 × DFP | valor de mercado com ações da B3 hoje é 34.99× o calculado com as da DFP de 2025 (emissão, recompra, grupamento depois do balanço, ou DFP errada); prevalece a B3 |
| SAUD3 | BRADSAÚDE | média | ações B3 × DFP | valor de mercado com ações da B3 hoje é 5.36× o calculado com as da DFP de 2025 (emissão, recompra, grupamento depois do balanço, ou DFP errada); prevalece a B3 |
| SBSP3 | CIA SANEAMENTO BASICO EST SAO PAULO | média | ações B3 × DFP | valor de mercado com ações da B3 hoje é 5.04× o calculado com as da DFP de 2025 (emissão, recompra, grupamento depois do balanço, ou DFP errada); prevalece a B3 |
| SIMH3 | SIMPAR | média | ações B3 × DFP | valor de mercado com ações da B3 hoje é 0.66× o calculado com as da DFP de 2025 (emissão, recompra, grupamento depois do balanço, ou DFP errada); prevalece a B3 |
| VVEO3 | CM Hospitalar | média | ações B3 × DFP | valor de mercado com ações da B3 hoje é 4.05× o calculado com as da DFP de 2025 (emissão, recompra, grupamento depois do balanço, ou DFP errada); prevalece a B3 |
| MLAS3 | GRUPO MULTILASER | média | buraco no histórico | sem DFP em 2018 |
| AZEV3 | AZEVEDO E TRAVASSOS | média | margem líquida extrema | -177% em 2025 (holding, ganho não recorrente ou receita mal identificada) |
| ITSA4 | ITAÚSA | média | margem líquida extrema | +201% em 2025 (holding, ganho não recorrente ou receita mal identificada) |
| LOGG3 | LOG COMMERCIAL PROPERTIES E PARTICIPAÇÕE | média | margem líquida extrema | +146% em 2025 (holding, ganho não recorrente ou receita mal identificada) |
| PMAM3 | PARANAPANEMA | média | margem líquida extrema | -237% em 2025 (holding, ganho não recorrente ou receita mal identificada) |
| RCSL4 | RECRUSUL | média | margem líquida extrema | -1077% em 2025 (holding, ganho não recorrente ou receita mal identificada) |
| BRAP4 | BRADESPAR | média | receita não positiva | receita 0 em 2025 |
| OBTC3 | ORANJEBTC | média | receita não positiva | receita 0 em 2025 |

As de severidade baixa e informativas ficam em `auditoria.json`.

## 3. Conferência externa (brapi.dev)

| Ticker | Cotação base | Cotação brapi | Valor de mercado base | brapi | Diferença |
|---|---|---|---|---|---|
| PETR4 | 42.67 | 42.67 | 594.3 bi | 588.5 bi | +1.0% |
| VALE3 | 58.48 | 58.48 | 243.8 bi | 233.1 bi | +4.6% |
| ITUB4 | 40.07 | 40.07 | 466.3 bi | 465.3 bi | +0.2% |
| MGLU3 | 8.2 | 8.2 | 6.4 bi | 5.8 bi | +9.9% |

A base usa a quantidade de ações atual informada pela B3, menos as ações em tesouraria do último balanço (mesmo critério do LPA). Fontes de mercado variam: algumas usam o total emitido, outras uma contagem defasada. A cotação é o teste mais direto, e deve bater exatamente.
