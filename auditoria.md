# Auditoria da base

Gerada em 18/11/2026 sobre `data/empresas.js` de 2026-11-18 02:37 (balanços até 2025, cotações até 2026-11-17). Refaça com `python3 scripts/auditar.py --externo`.

## 1. Cobertura

| Etapa | Quantidade |
|---|---|
| Emissores com ação ON/PN/unit negociada na B3 nos últimos 21 pregões (raiz do ticker) | 302 |
| Tickers de ação negociados nesse período | 389 |
| Emissores de ações na lista oficial da B3 (tipo 1) | 566 |
| Companhias ativas na CVM com ação na B3 (FCA + lista da B3) | 345 |
| Empresas na base | 345 |
| … das quais negociaram no período | 301 |
| Emissores negociados na B3 que estão na base | 301 de 302 (100%) |

Referências externas:

- FGV, jan/2026: empresas listadas na B3: **pouco mais de 370**
- Bpmoney, 2026: companhias listadas na B3: **393**
- CVM, Boletim Econômico 111 (3º tri/2026): companhias abertas, estrangeiras e incentivadas com registro ativo: **684**

Leitura: a B3 conta como "listada" toda empresa com registro, inclusive as que quase não negociam e as de balcão organizado; a CVM soma companhias sem ação em bolsa (só dívida), estrangeiras e incentivadas. O número comparável é o de emissores com ação negociada, acima.

### Negociadas na B3 e ausentes da base

Ordenadas por volume médio diário. Cada linha diz em que etapa a empresa caiu.

| Ticker | Nome na B3 | Volume/dia | Motivo |
|---|---|---|---|
| RSID3 | ROSSI RESID | R$ 0.0 mi | ticker não aparece no FCA de nenhuma companhia ativa (ticker novo, mudança de código ou registro cancelado) |

### Na base sem negócio na B3 no período

023175 (IGUA SANEAMENTO), AESO3 (Auren Operações), AHEB3 (SAO PAULO TURISMO), APTI4 (ALIPERTI), B1003 (B100), BBML3 (BBM Logística), BETP3 (BETAPART PARTICIPACOES), BPAR3 (BCO ESTADO DO PARA), BRFS3 (BRF), BRML3 (BR MALLS PARTICIPACOES), CEGR3 (CIA DISTRIB DE GAS DO RIO DE JANEIRO-CEG), CRTE3 (CONC RIO-TERESOPOLIS), CTCA3 (CTC - CENTRO DE TECNOLOGIA CANAVIEIRA), FIGE4 (INVESTIMENTOS BEMGE), FRIO3 (METALFRIO SOLUTIONS), GPAR3 (CIA CELG DE PARTICIPACOES - CELGPAR), HMOB3 (HMOBI Participações), IGTA3 (IGUATEMI EMPRESA DE SHOPPING CENTERS), INNC3 (INC EMPREENDIMENTOS IMOBILIÁRIOS), KLAS3 (KALLAS INCORPORAÇÕES E CONSTRUÇÕES), KRSA3 (Kora Saúde Participações), MERC4 (Mercantil Financeira), MMAQ4 (MINASMAQUINAS), NEMO3 (SUZANO HOLDING), NEOE3 (NEOENERGIA), NGRD3 (NEOGRID PARTICIPAÇÕES), ODER4 (CONSERVAS ODERICH), OIBR4 (OI), OPGM3 (GAMA PARTICIPACOES), OPSE3 (SUDESTE), OPTS3 (SUL 116 PARTICIPAÇÕES), PPAR3 (POLPAR), PRPT3 (PROMPT PARTICIPACOES), PTCA3 (PRÁTICA PRODUTOS), PTNT4 (PETTENATI), QUSW3 (QUALITY SOFTWARE), QVQP3 (524 PARTICIPACOES), SALT4 (Grupo Salta Educação), SHOW3 (T4F ENTRETENIMENTO), SRNA3 (SERENA ENERGIA), STBP3 (SANTOS BRASIL PARTICIPACOES), TKNO4 (TEKNO), VSPT4 (FERROVIA CENTRO-ATLANTICA), ZAMP3 (ZAMP)

## 2. Consistência

| Severidade | Regra | Ocorrências |
|---|---|---|
| alta | LPA divergente | 9 |
| média | ações B3 × DFP | 32 |
| média | margem líquida extrema | 24 |
| média | receita não positiva | 12 |
| média | P/L extremo | 9 |
| média | LPA com sinal trocado na DRE | 8 |
| média | DY acima de 30% | 8 |
| média | cotação parada | 3 |
| média | P/VP extremo | 3 |
| média | buraco no histórico | 1 |
| baixa | salto de ações | 114 |
| baixa | LPA divergente | 59 |
| baixa | receita salta | 55 |
| baixa | LPA com sinal trocado na DRE | 30 |
| baixa | preço mudou de escala | 16 |
| baixa | controladora × consolidado | 11 |
| baixa | LPA declarado por lote de mil | 10 |
| baixa | ITR atrasado | 10 |
| baixa | sem últimos 12 meses | 8 |
| baixa | unit sem composição | 2 |
| baixa | dividendos > 3× lucro | 2 |
| info | DY 12m × DY do exercício | 58 |
| info | só demonstração individual | 50 |
| info | sem cotação | 44 |
| info | PL negativo | 33 |

### Ocorrências de severidade alta e média

| Ticker | Empresa | Sev. | Regra | Detalhe |
|---|---|---|---|---|
| AZUL3 | AZUL | alta | LPA divergente | 2025: calculado R$ 0.04 × declarado R$ 0.16 (razão 0.26) |
| COCE5 | CIA ENERGETICA DO CEARA - COELCE | alta | LPA divergente | 2025: calculado R$ 4.57 × declarado R$ 2.82 (razão 1.62) |
| CTKA4 | KARSTEN | alta | LPA divergente | 2025: calculado R$ 11.37 × declarado R$ 5.27 (razão 2.16) |
| ENEV3 | ENEVA | alta | LPA divergente | 2025: calculado R$ 0.60 × declarado R$ 1.00 (razão 0.60) |
| HBRE3 | HBR Realty Empreendimentos Imobiliários | alta | LPA divergente | 2025: calculado R$ 0.27 × declarado R$ 0.94 (razão 0.28) |
| MAPT4 | CEMEPE INVESTIMENTOS | alta | LPA divergente | 2025: calculado R$ -0.11 × declarado R$ -0.23 (razão 0.49) |
| NEXP3 | Nexpe Participações | alta | LPA divergente | 2025: calculado R$ 40.57 × declarado R$ 124.25 (razão 0.33) |
| PDGR3 | PDG REALTY | alta | LPA divergente | 2025: calculado R$ -0.10 × declarado R$ -0.37 (razão 0.27) |
| TFCO4 | TRACK & FIELD CO | alta | LPA divergente | 2025: calculado R$ 0.15 × declarado R$ 0.09 (razão 1.61) |
| BALM4 | BAUMER | média | DY acima de 30% | 33% (dividendo extraordinário ou valor de mercado subestimado) |
| BMKS3 | BICICLETAS MONARK | média | DY acima de 30% | 37% (dividendo extraordinário ou valor de mercado subestimado) |
| DIRR3 | DIRECIONAL ENGENHARIA | média | DY acima de 30% | 31% (dividendo extraordinário ou valor de mercado subestimado) |
| LPSB3 | LPS BRASIL - CONSULTORIA DE IMOVEIS | média | DY acima de 30% | 31% (dividendo extraordinário ou valor de mercado subestimado) |
| POMO4 | MARCOPOLO | média | DY acima de 30% | 30% (dividendo extraordinário ou valor de mercado subestimado) |
| RIAA3 | GUARARAPES CONFECCOES | média | DY acima de 30% | 37% (dividendo extraordinário ou valor de mercado subestimado) |
| SCAR3 | SAO CARLOS EMPREEND E PARTICIPACOES | média | DY acima de 30% | 77% (dividendo extraordinário ou valor de mercado subestimado) |
| SYNE3 | SYN PROP & TECH | média | DY acima de 30% | 33% (dividendo extraordinário ou valor de mercado subestimado) |
| AERI3 | AERIS IND. E COM. DE EQUIP. PARA GER. DE | média | LPA com sinal trocado na DRE | 2025: lucro -901,213 mas LPA declarado +14.68 (erro de preenchimento da empresa) |
| ECOM3 | ECONOMATICA | média | LPA com sinal trocado na DRE | 2025: lucro 86,707 mas LPA declarado -2.05 (erro de preenchimento da empresa) |
| HBSA3 | HIDROVIAS DO BRASIL | média | LPA com sinal trocado na DRE | 2025: lucro -140,918 mas LPA declarado +0.05 (erro de preenchimento da empresa) |
| NORD3 | NORDON INDUSTRIAS METALURGICAS | média | LPA com sinal trocado na DRE | 2025: lucro -12,234 mas LPA declarado +1.83 (erro de preenchimento da empresa) |
| OBTC3 | ORANJEBTC | média | LPA com sinal trocado na DRE | 2025: lucro -469,986 mas LPA declarado +2.79 (erro de preenchimento da empresa) |
| SHOW3 | T4F ENTRETENIMENTO | média | LPA com sinal trocado na DRE | 2025: lucro -52,219 mas LPA declarado +0.77 (erro de preenchimento da empresa) |
| WEST3 | WESTWING COMÉRCIO VAREJISTA | média | LPA com sinal trocado na DRE | 2025: lucro -9,913 mas LPA declarado +0.89 (erro de preenchimento da empresa) |
| ZAMP3 | ZAMP | média | LPA com sinal trocado na DRE | 2025: lucro 107,137 mas LPA declarado -0.27 (erro de preenchimento da empresa) |
| DXCO3 | DEXCO | média | P/L extremo | 3762.7x |
| ECOM3 | ECONOMATICA | média | P/L extremo | 0.4x |
| ESTR4 | MANUFATURA DE BRINQUEDOS ESTRELA | média | P/L extremo | 0.1x |
| GSHP3 | GENERAL SHOPPING E OUTLETS DO BRASIL BRA | média | P/L extremo | 0.3x |
| MGEL4 | MANGELS INDUSTRIAL | média | P/L extremo | 0.6x |
| MNPR3 | MINUPAR PARTICIPACOES | média | P/L extremo | 0.5x |
| NEXP3 | Nexpe Participações | média | P/L extremo | 0.1x |
| PDTC3 | PADTEC HOLDING | média | P/L extremo | 18505.0x |
| RVEE3 | REVEE | média | P/L extremo | 0.6x |
| GFSA3 | GAFISA | média | P/VP extremo | 0.02x |
| PDTC3 | PADTEC HOLDING | média | P/VP extremo | 959.52x |
| TOKY3 | GRUPO TOKY | média | P/VP extremo | 0.03x |
| AGXY3 | Agrogalaxy Participações | média | ações B3 × DFP | valor de mercado com ações da B3 hoje é 0.07× o calculado com as da DFP de 2024 (emissão, recompra, grupamento depois do balanço, ou DFP errada); prevalece a B3 |
| AMBP3 | AMBIPAR PARTICIP. E EMPREEND. | média | ações B3 × DFP | valor de mercado com ações da B3 hoje é 10.01× o calculado com as da DFP de 2024 (emissão, recompra, grupamento depois do balanço, ou DFP errada); prevalece a B3 |
| AUAU3 | União Pet Participações | média | ações B3 × DFP | valor de mercado com ações da B3 hoje é 2.11× o calculado com as da DFP de 2025 (emissão, recompra, grupamento depois do balanço, ou DFP errada); prevalece a B3 |
| AVLL3 | ALPHAVILLE | média | ações B3 × DFP | valor de mercado com ações da B3 hoje é 0.04× o calculado com as da DFP de 2025 (emissão, recompra, grupamento depois do balanço, ou DFP errada); prevalece a B3 |
| AZEV3 | AZEVEDO E TRAVASSOS | média | ações B3 × DFP | valor de mercado com ações da B3 hoje é 0.19× o calculado com as da DFP de 2025 (emissão, recompra, grupamento depois do balanço, ou DFP errada); prevalece a B3 |
| AZTE3 | Azevedo & Travassos Energia | média | ações B3 × DFP | valor de mercado com ações da B3 hoje é 0.12× o calculado com as da DFP de 2025 (emissão, recompra, grupamento depois do balanço, ou DFP errada); prevalece a B3 |
| AZUL3 | AZUL | média | ações B3 × DFP | valor de mercado com ações da B3 hoje é 0.13× o calculado com as da DFP de 2025 (emissão, recompra, grupamento depois do balanço, ou DFP errada); prevalece a B3 |
| BHIA3 | Grupo Casas Bahia | média | ações B3 × DFP | valor de mercado com ações da B3 hoje é 1.55× o calculado com as da DFP de 2025 (emissão, recompra, grupamento depois do balanço, ou DFP errada); prevalece a B3 |
| CCTY3 | Belora RDVC City Desenvolvimento Imobili | média | ações B3 × DFP | valor de mercado com ações da B3 hoje é 0.00× o calculado com as da DFP de 2025 (emissão, recompra, grupamento depois do balanço, ou DFP errada); prevalece a B3 |
| CTAX3 | CONTAX PARTICIPAÇÕES | média | ações B3 × DFP | valor de mercado com ações da B3 hoje é 0.30× o calculado com as da DFP de 2025 (emissão, recompra, grupamento depois do balanço, ou DFP errada); prevalece a B3 |
| ENJU3 | ENJOEI | média | ações B3 × DFP | valor de mercado com ações da B3 hoje é 0.10× o calculado com as da DFP de 2025 (emissão, recompra, grupamento depois do balanço, ou DFP errada); prevalece a B3 |
| ESPA3 | MPM Corpóreos | média | ações B3 × DFP | valor de mercado com ações da B3 hoje é 0.09× o calculado com as da DFP de 2025 (emissão, recompra, grupamento depois do balanço, ou DFP errada); prevalece a B3 |
| GFSA3 | GAFISA | média | ações B3 × DFP | valor de mercado com ações da B3 hoje é 16.37× o calculado com as da DFP de 2025 (emissão, recompra, grupamento depois do balanço, ou DFP errada); prevalece a B3 |
| HBRE3 | HBR Realty Empreendimentos Imobiliários | média | ações B3 × DFP | valor de mercado com ações da B3 hoje é 1.88× o calculado com as da DFP de 2025 (emissão, recompra, grupamento depois do balanço, ou DFP errada); prevalece a B3 |
| IFCM3 | INFRACOMMERCE CXAAS | média | ações B3 × DFP | valor de mercado com ações da B3 hoje é 0.23× o calculado com as da DFP de 2025 (emissão, recompra, grupamento depois do balanço, ou DFP errada); prevalece a B3 |
| JFEN3 | JOAO FORTES ENGENHARIA | média | ações B3 × DFP | valor de mercado com ações da B3 hoje é 0.20× o calculado com as da DFP de 2025 (emissão, recompra, grupamento depois do balanço, ou DFP errada); prevalece a B3 |
| LIGT3 | LIGHT | média | ações B3 × DFP | valor de mercado com ações da B3 hoje é 4.32× o calculado com as da DFP de 2025 (emissão, recompra, grupamento depois do balanço, ou DFP errada); prevalece a B3 |
| LUPA3 | LUPATECH | média | ações B3 × DFP | valor de mercado com ações da B3 hoje é 0.10× o calculado com as da DFP de 2025 (emissão, recompra, grupamento depois do balanço, ou DFP errada); prevalece a B3 |
| NATU3 | NATURA COSMÉTICOS | média | ações B3 × DFP | valor de mercado com ações da B3 hoje é 0.78× o calculado com as da DFP de 2025 (emissão, recompra, grupamento depois do balanço, ou DFP errada); prevalece a B3 |
| OPCT3 | Oceanpact Serviços Maritimos | média | ações B3 × DFP | valor de mercado com ações da B3 hoje é 2.38× o calculado com as da DFP de 2025 (emissão, recompra, grupamento depois do balanço, ou DFP errada); prevalece a B3 |
| ORVR3 | Orizon Valorização de Resíduos | média | ações B3 × DFP | valor de mercado com ações da B3 hoje é 5.71× o calculado com as da DFP de 2025 (emissão, recompra, grupamento depois do balanço, ou DFP errada); prevalece a B3 |
| PDGR3 | PDG REALTY | média | ações B3 × DFP | valor de mercado com ações da B3 hoje é 0.01× o calculado com as da DFP de 2025 (emissão, recompra, grupamento depois do balanço, ou DFP errada); prevalece a B3 |
| PMAM3 | PARANAPANEMA | média | ações B3 × DFP | valor de mercado com ações da B3 hoje é 34.99× o calculado com as da DFP de 2025 (emissão, recompra, grupamento depois do balanço, ou DFP errada); prevalece a B3 |
| RVEE3 | REVEE | média | ações B3 × DFP | valor de mercado com ações da B3 hoje é 0.08× o calculado com as da DFP de 2025 (emissão, recompra, grupamento depois do balanço, ou DFP errada); prevalece a B3 |
| SAUD3 | BRADSAÚDE | média | ações B3 × DFP | valor de mercado com ações da B3 hoje é 5.36× o calculado com as da DFP de 2025 (emissão, recompra, grupamento depois do balanço, ou DFP errada); prevalece a B3 |
| SBSP3 | CIA SANEAMENTO BASICO EST SAO PAULO | média | ações B3 × DFP | valor de mercado com ações da B3 hoje é 5.04× o calculado com as da DFP de 2025 (emissão, recompra, grupamento depois do balanço, ou DFP errada); prevalece a B3 |
| SEQL3 | SEQUOIA LOGÍSTICA E TRANSPORTES | média | ações B3 × DFP | valor de mercado com ações da B3 hoje é 3.57× o calculado com as da DFP de 2025 (emissão, recompra, grupamento depois do balanço, ou DFP errada); prevalece a B3 |
| SIMH3 | SIMPAR | média | ações B3 × DFP | valor de mercado com ações da B3 hoje é 0.66× o calculado com as da DFP de 2025 (emissão, recompra, grupamento depois do balanço, ou DFP errada); prevalece a B3 |
| TCSA3 | TECNISA | média | ações B3 × DFP | valor de mercado com ações da B3 hoje é 0.10× o calculado com as da DFP de 2025 (emissão, recompra, grupamento depois do balanço, ou DFP errada); prevalece a B3 |
| TOKY3 | GRUPO TOKY | média | ações B3 × DFP | valor de mercado com ações da B3 hoje é 0.01× o calculado com as da DFP de 2025 (emissão, recompra, grupamento depois do balanço, ou DFP errada); prevalece a B3 |
| VIVR3 | VIVER INCORPORADORA E CONSTRUTORA | média | ações B3 × DFP | valor de mercado com ações da B3 hoje é 0.10× o calculado com as da DFP de 2025 (emissão, recompra, grupamento depois do balanço, ou DFP errada); prevalece a B3 |
| VVEO3 | CM Hospitalar | média | ações B3 × DFP | valor de mercado com ações da B3 hoje é 4.05× o calculado com as da DFP de 2025 (emissão, recompra, grupamento depois do balanço, ou DFP errada); prevalece a B3 |
| MLAS3 | GRUPO MULTILASER | média | buraco no histórico | sem DFP em 2018 |
| EMAE4 | EMAE - EMPRESA METROP. DE AGUAS E ENERGI | média | cotação parada | último negócio de EMAE4 há mais de 14 dias |
| FIEI3 | FICA EMPREENDIMENTOS IMOBILIÁRIOS | média | cotação parada | último negócio de FIEI3 há mais de 14 dias |
| MSPA4 | CIA MELHORAMENTOS DE SAO PAULO | média | cotação parada | último negócio de MSPA4 há mais de 14 dias |
| AALR3 | ALLIANÇA SAÚDE E PARTICIPAÇÕES | média | margem líquida extrema | -119% em 2025 (holding, ganho não recorrente ou receita mal identificada) |
| AERI3 | AERIS IND. E COM. DE EQUIP. PARA GER. DE | média | margem líquida extrema | -121% em 2025 (holding, ganho não recorrente ou receita mal identificada) |
| ARND3 | Arandu Investimentos | média | margem líquida extrema | -648% em 2025 (holding, ganho não recorrente ou receita mal identificada) |
| AZEV3 | AZEVEDO E TRAVASSOS | média | margem líquida extrema | -177% em 2025 (holding, ganho não recorrente ou receita mal identificada) |
| AZTE3 | Azevedo & Travassos Energia | média | margem líquida extrema | -343% em 2025 (holding, ganho não recorrente ou receita mal identificada) |
| BMKS3 | BICICLETAS MONARK | média | margem líquida extrema | +407% em 2025 (holding, ganho não recorrente ou receita mal identificada) |
| ECOM3 | ECONOMATICA | média | margem líquida extrema | -385% em 2025 (holding, ganho não recorrente ou receita mal identificada) |
| EPAR3 | EMBPAR PARTICIPAÇÕES | média | margem líquida extrema | -120% em 2025 (holding, ganho não recorrente ou receita mal identificada) |
| GPAR3 | CIA CELG DE PARTICIPACOES - CELGPAR | média | margem líquida extrema | +120% em 2024 (holding, ganho não recorrente ou receita mal identificada) |
| HBTS5 | CIA HABITASUL DE PARTICIPACOES | média | margem líquida extrema | +111% em 2025 (holding, ganho não recorrente ou receita mal identificada) |
| INEP3 | INEPAR | média | margem líquida extrema | -7892% em 2025 (holding, ganho não recorrente ou receita mal identificada) |
| ITSA4 | ITAÚSA | média | margem líquida extrema | +201% em 2025 (holding, ganho não recorrente ou receita mal identificada) |
| JFEN3 | JOAO FORTES ENGENHARIA | média | margem líquida extrema | -128% em 2025 (holding, ganho não recorrente ou receita mal identificada) |
| LOGG3 | LOG COMMERCIAL PROPERTIES E PARTICIPAÇÕE | média | margem líquida extrema | +146% em 2025 (holding, ganho não recorrente ou receita mal identificada) |
| LUPA3 | LUPATECH | média | margem líquida extrema | -116% em 2025 (holding, ganho não recorrente ou receita mal identificada) |
| MNPR3 | MINUPAR PARTICIPACOES | média | margem líquida extrema | +118% em 2025 (holding, ganho não recorrente ou receita mal identificada) |
| NEXP3 | Nexpe Participações | média | margem líquida extrema | +16320% em 2025 (holding, ganho não recorrente ou receita mal identificada) |
| NORD3 | NORDON INDUSTRIAS METALURGICAS | média | margem líquida extrema | -446% em 2025 (holding, ganho não recorrente ou receita mal identificada) |
| OIBR4 | OI | média | margem líquida extrema | -1400% em 2025 (holding, ganho não recorrente ou receita mal identificada) |
| OSXB3 | OSX BRASIL | média | margem líquida extrema | -1339% em 2025 (holding, ganho não recorrente ou receita mal identificada) |
| PDGR3 | PDG REALTY | média | margem líquida extrema | -266% em 2025 (holding, ganho não recorrente ou receita mal identificada) |
| PMAM3 | PARANAPANEMA | média | margem líquida extrema | -237% em 2025 (holding, ganho não recorrente ou receita mal identificada) |
| RCSL4 | RECRUSUL | média | margem líquida extrema | -1077% em 2025 (holding, ganho não recorrente ou receita mal identificada) |
| RVEE3 | REVEE | média | margem líquida extrema | +1062% em 2025 (holding, ganho não recorrente ou receita mal identificada) |
| BETP3 | BETAPART PARTICIPACOES | média | receita não positiva | receita 0 em 2025 |
| BRAP4 | BRADESPAR | média | receita não positiva | receita 0 em 2025 |
| CCTY3 | Belora RDVC City Desenvolvimento Imobili | média | receita não positiva | receita 0 em 2025 |
| CRTE3 | CONC RIO-TERESOPOLIS | média | receita não positiva | receita 0 em 2025 |
| FIEI3 | FICA EMPREENDIMENTOS IMOBILIÁRIOS | média | receita não positiva | receita -29 em 2025 |
| MAPT4 | CEMEPE INVESTIMENTOS | média | receita não positiva | receita 0 em 2025 |
| OBTC3 | ORANJEBTC | média | receita não positiva | receita 0 em 2025 |
| OPGM3 | GAMA PARTICIPACOES | média | receita não positiva | receita 0 em 2025 |
| OPSE3 | SUDESTE | média | receita não positiva | receita 0 em 2025 |
| PPAR3 | POLPAR | média | receita não positiva | receita 0 em 2025 |
| PRPT3 | PROMPT PARTICIPACOES | média | receita não positiva | receita 0 em 2025 |
| QVQP3 | 524 PARTICIPACOES | média | receita não positiva | receita 0 em 2025 |

As de severidade baixa e informativas ficam em `auditoria.json`.

## 3. Conferência externa (brapi.dev)

| Ticker | Cotação base | Cotação brapi | Valor de mercado base | brapi | Diferença |
|---|---|---|---|---|---|
| PETR4 | 43.98 | 43.98 | 613.4 bi | 607.3 bi | +1.0% |
| VALE3 | 60.34 | 60.34 | 251.6 bi | 241.9 bi | +4.0% |
| ITUB4 | 40.89 | 40.89 | 474.4 bi | 477.7 bi | -0.7% |
| MGLU3 | 7.95 | 7.95 | 6.2 bi | 5.3 bi | +16.6% |

A base usa a quantidade de ações atual informada pela B3, menos as ações em tesouraria do último balanço (mesmo critério do LPA). Fontes de mercado variam: algumas usam o total emitido, outras uma contagem defasada. A cotação é o teste mais direto, e deve bater exatamente.
