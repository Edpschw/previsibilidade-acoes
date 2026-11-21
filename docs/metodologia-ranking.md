---
title: Real Terms — metodologia do ranking por fundamentos
status: em uso (aba Ranking, ranking.js)
data: 2026-11-21
tags: [projeto, real-terms, metodologia, analise-fundamentalista]
---

# O que analisar antes de comprar uma ação, setor a setor

> [!summary] Resumo
> - **A nota é um número de 0 a 100 por empresa.** Ela responde quatro perguntas:
>   - **Qualidade:** o negócio cria valor?
>   - **Preço:** quanto se paga por isso?
>   - **Solidez:** o balanço aguenta um ano ruim?
>   - **Futuro:** para onde os números estão indo?
> - **Como é calculada:**
>   - Cada indicador vira um percentil, metade contra os pares do mesmo perfil setorial e metade contra o mercado.
>   - Os pilares são médias ponderadas.
>   - A nota soma os pilares com pesos que mudam por setor.
> - **Setores:** os 59 segmentos da B3 viram 14 perfis setoriais, cada um com a sua lógica econômica, pesos, limite de dívida e lista do que olhar além dos números.
> - **Indicadores futuros:** a nota não usa projeções de analistas, que não são públicas nem padronizadas. Usa sinais dos balanços recentes que antecipam o próximo resultado: momento do lucro e da receita, tendência da margem, crescimento sustentável e desalavancagem. E mostra quanto do preço depende de crescimento.
> - **Travas:** limitam a nota de quem está em recuperação judicial, tem patrimônio negativo, prejuízo ou dívida acima do que o setor suporta.
> - **O que não é:** métrica quantitativa a partir de dados públicos. Não é recomendação de compra ou venda.

Código: `ranking.js` (aba `#/ranking`, com link direto `#/ranking/PETR4`). Todos os parâmetros abaixo estão nesse arquivo; se um mudar, este documento muda junto.

---

## 1. De onde vem o retorno de uma ação

No longo prazo, o retorno de uma ação se decompõe em três partes: **retorno ≈ dividend yield + crescimento do lucro por ação + variação do múltiplo.** Essa decomposição, que vem do modelo de Gordon (1962) e foi popularizada por Bogle, organiza a análise:

| Parte do retorno | Pergunta | Pilar |
|---|---|---|
| Dividend yield | Quanto do lucro volta ao acionista, e quanto se paga por ele hoje? | Preço |
| Crescimento do lucro por ação | O negócio rende acima do custo de capital e consegue reinvestir? | Qualidade e Futuro |
| Variação do múltiplo | O preço já embute otimismo demais? Quem compra caro está exposto à queda do múltiplo | Preço |
| Risco de perda permanente | A empresa sobrevive a um ano ruim sem diluir ou quebrar? | Solidez |

Comprar uma ação é, portanto, responder às quatro perguntas ao mesmo tempo. Uma empresa excelente comprada cara pode render pouco. Uma barata com balanço frágil pode ser uma armadilha de valor (*value trap*). A nota força o equilíbrio entre os quatro lados e trava os casos em que um lado esconde um problema sério.

## 2. Os quatro pilares: teoria e evidência

### 2.1 Qualidade: o negócio cria valor?

**Teoria.** Uma empresa cria valor quando o retorno sobre o capital investido (ROIC) supera o custo desse capital. O valor criado é (ROIC − custo de capital) × capital investido (Koller, Goedhart e Wessels, *Valuation*). Crescer com ROIC abaixo do custo de capital destrói valor.

**Evidência:**
- **Rentabilidade:** empresas mais rentáveis rendem mais que as menos rentáveis, mesmo controlando por preço (Novy-Marx, 2013; Fama e French, 2015, fator RMW).
- **Qualidade como fator:** ações rentáveis, estáveis, que crescem e pagam dividendos têm retorno anormal (*Quality Minus Junk*: Asness, Frazzini e Pedersen, 2019).
- **Caixa:** lucros sustentados por *accruals*, e não por caixa, tendem a decepcionar (Sloan, 1996).

**Indicadores** (pesos padrão dentro do pilar; os perfis podem trocar):

| Indicador | Fórmula | Peso padrão | Observação |
|---|---|---|---|
| ROE | lucro dos controladores ÷ patrimônio dos controladores (12 meses quando há ITR) | 1 | principal para bancos e seguradoras |
| ROIC | EBIT × (1 − 34%) ÷ (patrimônio + dívida líquida) | 1,5 | não se aplica a financeiras |
| Margem EBIT | EBIT ÷ receita | 1 | não se aplica a financeiras |
| Conversão de caixa | Σ caixa operacional ÷ Σ lucro líquido, 3 exercícios | 1 | só com lucro somado positivo; limitado a 3x |
| Previsibilidade | índice de 0 a 100 do Real Terms (lucro, margem, receita, tendência e dividendos em 10 anos) | 1 | entra pelo valor absoluto |

### 2.2 Preço: quanto se paga por isso?

**Teoria.**
- **Margem de segurança:** comprar abaixo do valor protege contra erro de análise (Graham e Dodd, 1934; Graham, 1949).
- **Fator valor:** ações baratas em relação aos fundamentos renderam mais ao longo do tempo (Fama e French, 1992; Lakonishok, Shleifer e Vishny, 1994). O efeito também foi documentado no Brasil, nos fatores de risco calculados pelo NEFIN-USP.

**Por que *yields* e não múltiplos.** A nota usa lucro ÷ preço em vez de P/L, e o mesmo vale para patrimônio, EBITDA e caixa. Com *yields*, prejuízo fica naturalmente no fim da fila; com P/L, um múltiplo negativo pareceria "barato". A tela mostra o múltiplo, que é mais familiar.

**Por que comparar com os pares.** O P/L "normal" de um banco não é o de uma empresa de software. Comparar só com o mercado inteiro favoreceria sempre os setores estruturalmente baratos. Por isso metade da nota vem dos pares do perfil setorial (seção 3).

**Setores cíclicos.** No pico do ciclo o lucro está alto e o P/L parece baixo, justamente na hora mais arriscada. Graham e Dodd já recomendavam usar o lucro médio de vários anos; Campbell e Shiller (1998) aplicaram a mesma ideia ao mercado (CAPE). Aqui o **lucro normalizado** é a receita de 12 meses × a margem líquida mediana dos últimos 7 exercícios. Ele pesa mais que o lucro corrente em commodities e agro.

| Indicador | Fórmula | Peso padrão |
|---|---|---|
| P/L (lucro sobre o preço) | lucro dos controladores 12 meses ÷ valor de mercado | 1,5 |
| P/L normalizado | receita 12 meses × margem mediana de 7 anos ÷ valor de mercado | 0 (só nos cíclicos) |
| P/VP (patrimônio sobre o preço) | patrimônio dos controladores ÷ valor de mercado | 0,5 |
| EV/EBITDA | EBITDA ÷ (valor de mercado + dívida líquida) | 1 (não financeiras) |
| Caixa livre sobre o preço | média de 3 anos de (caixa operacional − investimentos) ÷ valor de mercado | 1 (não financeiras) |
| Dividend yield | proventos com data-com nos últimos 12 meses ÷ valor de mercado | 1 |

### 2.3 Solidez: o balanço aguenta um ano ruim?

**Teoria.** Entre as ações baratas, sinais simples de força financeira separam as que se recuperam das que afundam: alavancagem caindo, caixa operacional maior que o lucro e lucro positivo (F-score de Piotroski, 2000). O índice Z de Altman (1968) usa a mesma intuição para risco de falência. Dívida alta transforma um ano ruim em problema permanente: obriga a vender ativos, emitir ações ou renegociar em condições ruins.

**Quanto de dívida é demais depende do setor.** Uma transmissora de energia, com receita contratada e corrigida pela inflação, aguenta 4 vezes o EBITDA. Uma siderúrgica, cujo EBITDA pode cair pela metade num ano, não aguenta 3 vezes. Por isso cada perfil tem o seu limite.

| Indicador | Fórmula | Peso padrão | Observação |
|---|---|---|---|
| Dívida líquida/EBITDA | dívida líquida ÷ EBITDA (12 meses) | 2 | EBITDA ≤ 0 com dívida = pior caso; caixa líquido = melhor |
| Dívida líquida/patrimônio | dívida líquida ÷ patrimônio dos controladores | 0,5 | principal nas incorporadoras |
| Capital | patrimônio ÷ ativo total | 1 | só bancos e seguradoras, no lugar do índice de Basileia |
| Anos com lucro | % dos últimos 10 exercícios com lucro líquido positivo | 1 | valor absoluto |
| Governança | Novo Mercado 100 · Nível 2 80 · Nível 1 60 · demais 40 | 0,5 | valor absoluto |
| Liquidez | volume médio diário | 0,5 | só contra o mercado |

### 2.4 Futuro: os indicadores que antecipam

Projeções de analistas não são públicas nem padronizadas, e por isso a nota não as usa. Usa sinais dos balanços mais recentes que a pesquisa mostra antecipar o resultado seguinte.

| Indicador | Fórmula | Peso padrão | Por que antecipa |
|---|---|---|---|
| Momento do lucro | lucro de 12 meses ÷ lucro do último exercício − 1 (sem ITR: último exercício ÷ anterior); limitado a ±100%; sair do prejuízo = +100% | 1,5 | Empresas que surpreendem para cima tendem a seguir surpreendendo por alguns trimestres (*post-earnings announcement drift*: Bernard e Thomas, 1989). |
| Momento da receita | receita de 12 meses ÷ receita do último exercício − 1; limitado a ±50% | 0,5 | Mostra se o lucro vem de crescimento ou só de corte de custos. |
| Tendência da margem | margem líquida de 12 meses − mediana dos 5 exercícios anteriores | 1 | Margem subindo indica escala ou poder de preço; caindo, pressão de custos ou concorrência. |
| Crescimento sustentável | ROE × (1 − payout) | 1 | Quanto a empresa cresce só com o lucro retido, sem dívida nova nem emissão de ações (Gordon, 1962; Higgins). |
| Desalavancagem | dívida/EBITDA de um ano atrás − dívida/EBITDA atual | 1 | Balanço melhorando libera caixa e reduz risco; piorando, antecipa aperto. |
| Crescimento da receita em 5 anos | taxa composta anual, na moeda da tela | 0,5 | A tendência longa, com peso pequeno: crescimento passado persiste menos do que parece (Chan, Karceski e Lakonishok, 2003). |

**Dois indicadores informativos**, mostrados na explicação de cada empresa e fora da nota:
- **Quanto do preço depende de crescimento.** Uma empresa que nunca crescesse valeria lucro ÷ custo de capital. Com custo de capital próprio de **15% ao ano em reais** (premissa), a parcela do preço que depende de crescimento é 1 − (lucro/preço) ÷ 15%.
  - É a fração do valor que vem das oportunidades de crescimento (Miller e Modigliani, 1961), a leitura das "expectativas embutidas no preço" de Mauboussin e Rappaport (2001).
  - Se o lucro sobre o preço passa de 15%, o preço está abaixo do valor sem crescimento.
  - A premissa não muda a nota.
- **Proventos aprovados a receber:** dividendos e JCP já declarados e ainda não pagos, segundo a agenda da B3.

## 3. Da conta à nota

1. **Percentil.** Para cada indicador, o percentil é a fração do grupo que fica atrás da empresa, com empates contando metade, de 0 a 100. Nos indicadores em que menor é melhor (dívida), a ordem se inverte. Mais alto é sempre melhor.
2. **Pares e mercado.**
   - **Combinação:** nota do indicador = w × percentil entre os pares + (1 − w) × percentil no mercado.
   - **Peso dos pares:** w = 0,5 com 8 ou mais pares com o dado; 0,25 com 4 a 7; 0 com menos de 4.
   - **Valor absoluto:** previsibilidade, anos com lucro e governança entram pelo próprio valor, de 0 a 100.
   - **Só mercado:** liquidez é comparada só com o mercado.
3. **Pilar.** Média ponderada das notas dos indicadores do pilar, com os pesos do perfil setorial. Indicador sem dado ou que não se aplica fica de fora, e o peso vai para os demais. Pilar sem nenhum indicador fica de fora da nota final, com o peso redistribuído.
4. **Nota.** Σ (peso do pilar × nota do pilar) ÷ Σ pesos dos pilares com dado, arredondada.
5. **Travas.** A nota final é o mínimo entre a nota calculada e o teto de cada trava que dispara:

| Trava | Condição | Teto |
|---|---|---|
| Recuperação judicial | "recuperação judicial" no nome registrado na CVM | 15 |
| Patrimônio negativo | patrimônio dos controladores ≤ 0 | 25 |
| Prejuízo | lucro dos controladores dos últimos 12 meses ≤ 0 | 40 |
| Dívida acima do limite do setor | dívida líquida/EBITDA acima do limite do perfil (incorporadoras: dívida líquida acima do patrimônio); não vale para financeiras | 50 |

6. **Faixas.** 70 ou mais: fundamentos fortes. 50 a 69: intermediários. Abaixo de 50: fracos.
7. **Avisos**, sem efeito na nota:
   - controle estatal (risco de interferência);
   - sem ITR posterior ao último exercício;
   - menos de 5 anos de balanço;
   - menos de 60% dos indicadores previstos com dado.
8. **Moeda.** Quase tudo são razões, que não dependem da moeda. As exceções são a previsibilidade e o crescimento da receita em 5 anos, que seguem o seletor R$ | US$; por isso a nota pode mudar um pouco em dólar.

### Exemplo 1: PETR4 (base de 21/11/2026), nota 77, 1ª de 189

**Perfil commodities, com pesos de 20% para qualidade, 30% para preço, 30% para solidez e 20% para futuro.**

| Pilar | Indicadores (nota de 0 a 100 × peso no perfil) | Nota do pilar |
|---|---|---|
| Qualidade | ROE 27,8% → 93 × 1 · ROIC 16,5% → 85 × 1,5 · margem EBIT 34,2% → 92 × 0,5 · conversão de caixa 2,27x → 67 × 1 · previsibilidade 56 × 0,5 | 80,3 |
| Preço | P/L 4,2x → 95 × 0,5 · P/L normalizado 4,6x → 84 × 1,5 · P/VP 1,18x → 49 × 0,5 · EV/EBITDA 3,1x → 85 × 1,5 · caixa livre 20,8% → 82 × 1 · DY 7,9% → 75 × 0,5 | 80,8 |
| Solidez | dívida/EBITDA 1,0x → 68 × 2,5 · dívida/patrimônio 0,59x → 49 × 1 · lucro em 90% dos anos × 1 · governança Nível 2 = 80 × 0,5 · liquidez → 100 × 0,5 | 72,6 |
| Futuro | lucro +28% → 68 × 1 · receita +19% → 91 × 0,5 · margem +0,2 p.p. → 65 × 0,5 · crescimento sustentável 20,8% → 95 × 0,5 · dívida/EBITDA caiu 0,4x → 73 × 1,5 | 75,7 |

Nota = 0,20 × 80,3 + 0,30 × 80,8 + 0,30 × 72,6 + 0,20 × 75,7 = **77,2 → 77**.

- **Sem travas.** Aviso de controle estatal.
- **Crescimento embutido:** o lucro sobre o preço (23,6%) passa dos 15% de custo de capital, então o preço não embute crescimento algum.

### Exemplo 2: SUZB3, nota 48, 134ª de 189

**Mesmo perfil.** Os pilares ficam em qualidade 55,1, preço 52,0, solidez 45,0 e futuro 39,4. Pesam contra:
- dívida/EBITDA de 3,4x (24 de 100, pior que três quartos dos pares);
- lucro de 12 meses 38% abaixo do exercício;
- margem 10,9 p.p. abaixo da mediana de 5 anos;
- ROIC de 5%.

**Trava de dívida.** A dívida acima de 3x o EBITDA dispara a trava (teto 50). A nota calculada (48) já está abaixo do teto, então a trava não muda o número, mas aparece na explicação.

### Distribuição na base de 21/11/2026

**Notas.** 189 empresas com nota, da mínima de 13 à máxima de 77, com mediana de 57 (quartis em 40 e 64):
- 22 com fundamentos fortes;
- 109 com fundamentos intermediários;
- 58 com fundamentos fracos.

**Travas disparadas.**

| Trava | Empresas |
|---|---|
| Prejuízo nos 12 meses | 38 |
| Dívida acima do limite | 24 |
| Patrimônio negativo | 7 |
| Recuperação judicial | 3 (AMER3, BHIA3, PMAM3, todas com nota 15) |

## 4. Setor a setor

**A tabela-resumo** mostra os pesos dos pilares e o limite de dívida de cada perfil.

| Perfil | Segmentos da B3 | Empresas | Qualidade | Preço | Solidez | Futuro | Trava de dívida |
|---|---|---|---|---|---|---|---|
| Bancos e serviços financeiros | Bancos, Serviços Financeiros Diversos (+ ITSA4) | 14 | 30 | 30 | 15 | 25 | não se aplica a financeiras |
| Seguros e previdência | Seguradoras, Resseguradoras, Corretoras | 5 | 30 | 35 | 10 | 25 | não se aplica a financeiras |
| Energia, saneamento e gás | Energia Elétrica, Água e Saneamento, Gás | 19 | 20 | 35 | 30 | 15 | 5x EBITDA |
| Commodities | Petróleo (exploração, refino, distribuição, serviços), mineração, siderurgia, papel e celulose, embalagens, petroquímica, química, fertilizantes, cobre | 26 | 20 | 30 | 30 | 20 | 3x EBITDA |
| Agronegócio e alimentos | Agricultura, Carnes, Açúcar e Álcool, Alimentos Diversos | 10 | 25 | 30 | 25 | 20 | 3,5x EBITDA |
| Varejo e consumo | Comércio (vestuário, calçados, eletro, alimentos, produtos diversos), bebidas, uso pessoal, turismo, esportes | 23 | 30 | 25 | 20 | 25 | 3x EBITDA |
| Incorporação e construção | Incorporações, Construção Pesada | 17 | 25 | 30 | 25 | 20 | dívida líquida > patrimônio |
| Shoppings e renda imobiliária | Exploração de Imóveis | 6 | 20 | 35 | 30 | 15 | 6x EBITDA |
| Indústria e bens de capital | Material Rodoviário, Máquinas, Motores, Autopeças, Aeronáutico e Defesa, Armas, Serviços Diversos, Madeira, Produtos para Construção | 22 | 30 | 25 | 20 | 25 | 3,5x EBITDA |
| Transporte, logística e concessões | Rodovias, Aluguel de carros, Transporte rodoviário, aéreo, ferroviário e hidroviário (+ SIMH3) | 12 | 20 | 25 | 35 | 20 | 4,5x EBITDA |
| Saúde | Serviços médicos, hospitais e diagnósticos; Medicamentos e outros produtos | 15 | 30 | 25 | 20 | 25 | 3,5x EBITDA |
| Educação | Serviços Educacionais | 7 | 25 | 25 | 25 | 25 | 3,5x EBITDA |
| Tecnologia | Programas e Serviços, Computadores e Equipamentos | 8 | 30 | 20 | 15 | 35 | 3x EBITDA |
| Telecomunicações | Telecomunicações | 5 | 25 | 30 | 25 | 20 | 4x EBITDA |

Abaixo, a análise de cada perfil. "O que analisar" inclui pontos que os dados padronizados da CVM não trazem e que a nota, por isso, não mede.

### Bancos e serviços financeiros
- **Lógica:** um banco vale pelo retorno que tira do patrimônio (ROE) acima do custo de capital, ano após ano. O P/VP justo cresce com o ROE: P/VP ≈ (ROE − g) ÷ (k − g). Banco não tem EBITDA nem dívida no sentido usual: o dinheiro captado é a matéria-prima.
- **O que analisar:**
  - ROE recorrente e sua estabilidade no ciclo de crédito.
  - Qualidade da carteira: inadimplência acima de 90 dias, cobertura de provisões, custo do crédito (releases trimestrais).
  - Capital: Basileia e capital principal.
  - Eficiência e mix de receitas.
  - Custo da captação e sensibilidade à Selic.
  - Payout e JCP.
- **O que acompanhar:**
  - Selic e desemprego.
  - Crescimento da carteira e projeções de provisão.
  - Provisão por perda esperada (Resolução CMN 4.966, em vigor desde 2025).
- **Na nota:**
  - Dívida/EBITDA, ROIC e caixa livre não se aplicam.
  - Pesam mais: ROE (2), previsibilidade (1,5), P/L e P/VP (1,5 cada), capital (2), anos com lucro (2), momento do lucro e crescimento sustentável (1,5 cada).
  - Empresas não financeiras do grupo (B3SA3, CSUD3) recebem também os indicadores gerais.

### Seguros e previdência
- **Lógica:** a seguradora ganha na operação (prêmios menos sinistros e despesas) e na aplicação das reservas, o *float*. A Selic alta infla o resultado financeiro. O setor costuma distribuir quase todo o lucro.
- **O que analisar:**
  - Índice combinado (abaixo de 100%, a operação dá lucro).
  - Peso do resultado financeiro.
  - Acordos de distribuição com bancos e o prazo deles.
  - ROE, payout e solvência (Susep).
- **O que acompanhar:**
  - Selic.
  - Renovação de acordos e crescimento dos prêmios.
  - Eventos climáticos (resseguro e seguro rural).
- **Na nota:** dividend yield (2), ROE (2), capital (1,5) e anos com lucro (2) pesam mais.

### Energia, saneamento e gás
- **Lógica:** receita regulada ou contratada e corrigida pela inflação. O valor está na previsibilidade do caixa e em quanto dele chega ao acionista. O setor se comporta como título longo e tolera mais dívida.
- **O que analisar:**
  - Tipo de negócio:
    - transmissão: receita anual permitida;
    - distribuição: revisão tarifária, perdas e inadimplência;
    - geração: contratos e risco hidrológico;
    - saneamento: metas de universalização.
  - Indexação (IPCA ou IGP-M) e retorno regulatório.
  - Alavancagem (3 a 4x é comum).
  - Investimento obrigatório (metas de 2033 do Marco Legal do Saneamento, Lei 14.026/2020).
  - Risco político das estatais.
- **O que acompanhar:**
  - Revisões tarifárias e renovações de concessão.
  - Juros reais (NTN-B) e inflação.
  - Hidrologia e PLD.
- **Na nota:**
  - Preço e solidez somam 65%.
  - Pesam mais: dividend yield (2), EV/EBITDA (1,5), previsibilidade (2), desalavancagem (1,5) e governança (1).
  - Trava de dívida acima de 5x.

### Commodities: petróleo, mineração, siderurgia, papel e química
- **Lógica:** o lucro segue o preço da commodity e o câmbio. No pico o P/L parece baixo; no vale, caro. O que diferencia as empresas é o custo de produção, um balanço que atravesse o vale e a disciplina com o caixa.
- **O que analisar:**
  - Posição na curva de custo.
  - Lucro normalizado no ciclo.
  - Dívida baixa no pico.
  - Alocação de capital, reservas e vida útil dos ativos.
  - Particularidades de cada atividade:
    - petróleo: política de preços e royalties;
    - siderurgia: spreads e aço importado;
    - celulose: preço e câmbio;
    - química: spread da nafta.
- **O que acompanhar:**
  - China.
  - Brent.
  - Câmbio.
  - Projeções de produção e custo; capacidade nova no mundo.
- **Na nota:**
  - Pesam mais: P/L normalizado (1,5), EV/EBITDA (1,5), caixa livre (1), dívida/EBITDA (2,5), dívida/patrimônio (1) e desalavancagem (1,5).
  - Pesam menos: P/L corrente (0,5) e tendência da margem (0,5); o crescimento de 5 anos fica de fora, porque no ciclo ele só reflete preço.
  - Trava de dívida acima de 3x.

### Agronegócio e alimentos
- **Lógica:** margens dependem de preços agrícolas, clima e câmbio. Os ciclos são mais suaves que os do minério, mas reais. Frigoríficos vivem de spread; produtores, de terra e produtividade; a indústria, de marca e custo de matéria-prima.
- **O que analisar:**
  - Ciclo do boi e acesso a mercados.
  - Açúcar, paridade do etanol com a gasolina e produtividade da cana.
  - Valor das terras.
  - Capital de giro e estoques.
  - Moeda da dívida.
- **O que acompanhar:**
  - Clima e safra.
  - Preços internacionais.
  - Câmbio e política de biocombustíveis.
  - Ciclo pecuário.
- **Na nota:** P/L corrente e normalizado com peso igual (1 cada); dívida/EBITDA (2); trava de dívida acima de 3,5x.

### Varejo e consumo
- **Lógica:** vale quem cresce com retorno, sem perder margem e sem prender caixa em estoques e recebíveis. Juros altos pesam duas vezes.
- **O que analisar:**
  - Vendas nas mesmas lojas e expansão.
  - Margem bruta e despesas; ROIC.
  - Capital de giro.
  - Dívida completa, incluindo antecipação de recebíveis e risco sacado (o caso Americanas, de 2023).
  - Marca e concorrência estrangeira.
- **O que acompanhar:**
  - Juros, renda e emprego.
  - Inflação de alimentos e câmbio.
  - Datas fortes e planos de abertura de lojas.
- **Na nota:**
  - Pesam mais: ROIC (2), conversão de caixa (1,5), momento do lucro (1,5), momento da receita (1) e crescimento de 5 anos (1).
  - Trava de dívida acima de 3x.

### Incorporação e construção
- **Lógica:** a construtora vende na planta e recebe ao longo da obra. O lucro, reconhecido pelo avanço da obra (POC), chega antes do caixa. O setor vale pelo patrimônio e pelo ROE, e sofre com juros altos.
- **O que analisar:**
  - Lançamentos, velocidade de vendas e distratos.
  - Margem bruta e banco de terrenos.
  - Dívida líquida sobre patrimônio (o EBITDA engana com o POC).
  - Segmento: Minha Casa, Minha Vida com recursos do FGTS, ou média e alta renda dependente da poupança.
- **O que acompanhar:**
  - Juros e crédito imobiliário (SBPE, FGTS).
  - INCC.
  - Prévias trimestrais.
- **Na nota:**
  - Pesam mais: ROE (2), P/VP (1,5), P/L (1,5) e dívida/patrimônio (2).
  - EV/EBITDA e desalavancagem ficam de fora.
  - Trava quando a dívida líquida passa do patrimônio.

### Shoppings e renda imobiliária
- **Lógica:** renda de aluguel estável e indexada à inflação. O portfólio vale NOI ÷ cap rate e sobe quando os juros reais caem.
- **O que analisar:**
  - NOI, margem e reajuste nas mesmas lojas.
  - Vacância e inadimplência.
  - Cap rate implícito frente aos juros reais.
  - Venda de ativos acima do valor contábil.
- **O que acompanhar:**
  - Juros reais e índices de reajuste.
  - Vendas do varejo físico e transações de ativos.
- **Na nota:** dividend yield (2), EV/EBITDA (1,5) e margem (1,5) pesam mais; trava de dívida acima de 6x.

### Indústria e bens de capital
- **Lógica:** transformar ciclos de investimento em pedidos com margem. Exportação e câmbio pesam. O ROIC separa quem cria valor de quem só acompanha o ciclo.
- **O que analisar:**
  - Carteira e entrada de pedidos (releases).
  - ROIC e margem no ciclo.
  - Capital de giro.
  - Exposição ao exterior; ciclos de caminhões, máquinas agrícolas e construção.
- **O que acompanhar:**
  - Investimento, produção de veículos e safra.
  - Câmbio e juros.
  - Pedidos trimestrais.
- **Na nota:** pesos equilibrados, com qualidade em 30%; trava de dívida acima de 3,5x.

### Transporte, logística e concessões
- **Lógica:** capital intensivo e financiado com dívida. O valor depende de investir acima do custo da dívida e de manter o balanço de pé.
- **O que analisar:**
  - Alavancagem, custo e prazo da dívida.
  - ROIC contra custo da dívida.
  - Concessões: prazo, reajustes e reequilíbrio.
  - Locadoras: carro usado e depreciação. Aéreas: combustível e câmbio.
- **O que acompanhar:**
  - Selic e CDI.
  - Leilões e renovações; carga e safra.
  - Preço de carros.
- **Na nota:**
  - Solidez pesa 35%.
  - Pesam mais: EV/EBITDA (2), dívida/EBITDA (2,5) e desalavancagem (1,5).
  - Trava de dívida acima de 4,5x.

### Saúde
- **Lógica:** demanda estrutural com pressão de custos. Hospitais e laboratórios dependem das operadoras; operadoras, da sinistralidade; farmácias, de expansão com retorno; farmacêuticas, de portfólio e preços regulados.
- **O que analisar:**
  - Sinistralidade, ocupação e ticket.
  - Crescimento orgânico frente a aquisições, e o ágio.
  - Alavancagem pós-aquisições.
  - Regulação (ANS, CMED).
- **O que acompanhar:**
  - Reajustes de planos e sinistralidade.
  - Integração de aquisições e abertura de lojas.
  - Juros.
- **Na nota:** qualidade 30% e futuro 25%; trava de dívida acima de 3,5x.

### Educação
- **Lógica:** mensalidade recorrente, mas com evasão e inadimplência. O ensino a distância derrubou o ticket. Caixa importa mais que lucro.
- **O que analisar:**
  - Captação, evasão e ticket.
  - Provisão para devedores e recebíveis.
  - Mix (presencial, a distância, medicina).
  - Alavancagem e regulação (FIES, MEC).
- **O que acompanhar:**
  - Captação semestral.
  - Mudanças no MEC e no FIES.
  - Juros e emprego.
- **Na nota:** pesos iguais; conversão de caixa (1,5) pesa mais dentro da qualidade.

### Tecnologia
- **Lógica:** crescimento com margem, receita recorrente e escala. Boa parte do preço depende de crescimento futuro.
- **O que analisar:**
  - Receita recorrente e crescimento orgânico.
  - Regra de 40.
  - Conversão de caixa e remuneração em ações.
  - Concentração de clientes.
- **O que acompanhar:**
  - Receita recorrente e churn.
  - Juros (múltiplos de crescimento são os mais sensíveis).
  - Demanda de TI.
- **Na nota:**
  - Futuro pesa 35% e preço, só 20%.
  - Pesam mais: momento do lucro (1,5), momento da receita (1,5), crescimento de 5 anos (1,5), margem EBIT (1,5) e caixa livre (1,5).
  - Trava de dívida acima de 3x.

### Telecomunicações
- **Lógica:** grandes bases de assinantes, receita estável e investimento alto e contínuo. O valor está no caixa livre e nos dividendos.
- **O que analisar:**
  - ARPU e churn.
  - Investimento sobre receita.
  - Alavancagem com arrendamentos.
  - Competição, consolidação, Anatel e espectro.
- **O que acompanhar:**
  - Reajustes de preço, fibra e 5G.
  - Leilões de espectro e juros.
- **Na nota:** caixa livre (1,5), dividend yield (1,5) e EV/EBITDA (1,5) pesam mais; trava de dívida acima de 4x.

**Como os segmentos são atribuídos.**
- **Regra geral:** cada empresa recebe o perfil do seu segmento na classificação da B3. Sem classificação da B3, vale a da CVM.
- **Exceções:** duas holdings seguem o negócio principal, ITSA4 em financeiro e SIMH3 em transporte.
- **Segmentos novos:** caem em "Holdings e outros", com pesos iguais, até ganharem um perfil.

## 5. O que a nota não faz

- **Só usa dados históricos e padronizados.** Não há projeções de analistas nem indicadores operacionais, como inadimplência de bancos, velocidade de vendas, sinistralidade ou carteira de pedidos. Eles estão listados em cada setor para conferir nos relatórios.
- **É relativa.** Muda quando a empresa, os pares, o mercado ou o preço mudam.
- **Herda os erros de preenchimento.** Os números vêm como as empresas os entregaram à CVM. A auditoria do Real Terms aponta os casos mais graves.
- **Não mede diluição.** O histórico do número de ações já vai para a base de hoje também com eventos que a B3 não lista (LPA reapresentado e inferência pela contagem, como o desdobramento da VIVT3 em 2025 e o 1:30 da CMIN3 em 2021), mas parte desses ajustes é inferida, e há quebras de base sem fator conhecido. A nota ainda não usa a variação de ações. Diluição real, como a de fusões (HAPV3, FLRY3, ALOS3), precisa ser conferida na página da empresa.
- **Usa uma premissa só no indicador informativo.** O custo de capital de 15% vale apenas para "quanto do preço depende de crescimento".
- **Não avalia o que não está nos números padronizados:** gestão, estratégia, governança além do segmento de listagem e eventos futuros. Nem o perfil de quem investe.
- **Não é recomendação de investimento.** Resolução CVM 20: a nota é apresentada como métrica descritiva, com regras públicas, sem indicação de compra, venda ou preço-alvo. Antes de cobrar pelo acesso, ver `docs/arquitetura-comercial.md`, seção 5.

## 6. Referências

- Altman, E. (1968). Financial ratios, discriminant analysis and the prediction of corporate bankruptcy. *Journal of Finance*.
- Asness, C., Frazzini, A. e Pedersen, L. (2019). Quality minus junk. *Review of Accounting Studies*.
- Bernard, V. e Thomas, J. (1989). Post-earnings-announcement drift: delayed price response or risk premium? *Journal of Accounting Research*.
- Campbell, J. e Shiller, R. (1998). Valuation ratios and the long-run stock market outlook. *Journal of Portfolio Management*.
- Chan, L., Karceski, J. e Lakonishok, J. (2003). The level and persistence of growth rates. *Journal of Finance*.
- Damodaran, A. *Investment Valuation* (avaliação por setor: bancos por P/VP e ROE, cíclicas por lucro normalizado).
- Fama, E. e French, K. (1992). The cross-section of expected stock returns. *Journal of Finance*.
- Fama, E. e French, K. (2015). A five-factor asset pricing model. *Journal of Financial Economics*.
- Gordon, M. (1962). *The Investment, Financing, and Valuation of the Corporation*.
- Graham, B. e Dodd, D. (1934). *Security Analysis*. Graham, B. (1949). *The Intelligent Investor*.
- Greenblatt, J. (2005). *The Little Book That Beats the Market* (ROIC e lucro sobre o preço).
- Koller, T., Goedhart, M. e Wessels, D. *Valuation: Measuring and Managing the Value of Companies* (McKinsey).
- Lakonishok, J., Shleifer, A. e Vishny, R. (1994). Contrarian investment, extrapolation, and risk. *Journal of Finance*.
- Mauboussin, M. e Rappaport, A. (2001). *Expectations Investing*.
- Miller, M. e Modigliani, F. (1961). Dividend policy, growth, and the valuation of shares. *Journal of Business*.
- NEFIN-USP: fatores de risco para o mercado brasileiro (valor, momento, tamanho, iliquidez).
- Novy-Marx, R. (2013). The other side of value: the gross profitability premium. *Journal of Financial Economics*.
- Piotroski, J. (2000). Value investing: the use of historical financial statement information to separate winners from losers. *Journal of Accounting Research*.
- Sloan, R. (1996). Do stock prices fully reflect information in accruals and cash flows about future earnings? *The Accounting Review*.
