# Metodologia do simulador (#/simular)

O simulador responde duas perguntas:

1. **Quanto rendeu?** Se eu tivesse comprado estas ações neste dia (ou no começo deste ano), quanto teria hoje, contando valorização, dividendos e JCP? Quanto isso é perto do CDI e da inflação do mesmo período?
2. **Quanto pode render?** Daqui a 5 anos, entre o que é razoável esperar, onde a carteira de hoje pode estar? O resultado vem em três cenários (pessimista, referência e otimista), com os pressupostos à mostra.

É uma conta a partir de dados públicos. Não é recomendação de investimento.

## 1. Dados

`scripts/historico.py` roda todo dia depois de `scripts/processar.py` e grava um arquivo por ticker em `data/historico/<TICKER>.js`. O navegador só baixa o arquivo quando a ação entra na simulação.

| Dado | Fonte | Tratamento |
|---|---|---|
| Fechamento diário desde 2010 | Séries históricas da B3 (COTAHIST): arquivo anual para os anos fechados, mais o arquivo anual do ano corrente e os diários dos últimos 45 dias | Mercado à vista, lote padrão e regimes especiais (os mesmos filtros de `processar.py`). Preço como negociado, sem ajuste |
| Códigos antigos | FCA de cada ano (CVM): os códigos de negociação que a empresa (CNPJ) teve | A série do código antigo da mesma classe é colada antes da do atual (KROT3 antes de COGN3, BVMF3 antes de B3SA3). Só cola quando o preço continua, com até 40% de diferença e até 30 dias entre os dois pregões. Um salto maior indica papel diferente, por exemplo uma incorporação com relação de troca |
| Desdobramentos, grupamentos e bonificações | Ficha da B3 (último dia "com" e fator, por classe de ação) | Evento de 25% ou mais só entra se o preço do pregão seguinte andou como ele. Se o preço desmente por mais de 1,5×, o evento fica de fora: a ficha do Itaú lista um grupamento 100:1 em 2011 que o preço não mostra. Os eventos que a ficha não lista, mas que `processar.py` achou pelo LPA reapresentado ou pela contagem de ações (`eventos_acoes`), ganham a data do pregão em que o preço saltou como o fator, dentro do ano em que a cotação mudou de base |
| Proventos em dinheiro | Ficha da B3 (data-com, valor por ação na base daquela data, tipo, data de pagamento) | Dividendos, JCP, rendimentos e restituições de capital da classe do ticker (pelo ISIN). Valor bruto. Unit sem provento próprio na ficha soma os das ações que a compõem (BPAC11 = 1 ON + 2 PNA) |
| CDI | Banco Central, SGS 12 (% ao dia) | Índice acumulado dia a dia |
| IPCA | Banco Central, SGS 433 (% no mês) | Índice acumulado mês a mês; IPCA de 12 meses |
| PTAX | Banco Central, SGS 1 | Conversão para US$ quando a tela está em dólar |

Como os preços ficam sem ajuste e os eventos e proventos vêm à parte, a simulação acompanha a posição como ela aconteceu: quantas ações, quanto dinheiro entrou e quando. Não usa uma série "ajustada" pronta.

## 2. Do dia da compra até hoje

- **Compra:** no fechamento do dia escolhido. Se não houve pregão nesse dia (fim de semana, feriado ou papel sem negócio), no fechamento do primeiro pregão depois. Ao escolher um ano, a compra é no primeiro pregão do ano. Frações de ação são aceitas, porque a conta é sobre o valor, não sobre lotes.
- **Carteira:** o valor é dividido em partes iguais entre as ações escolhidas, no máximo 8. A ação que ainda não negociava na data é comprada no seu primeiro pregão, e a parte dela fica em dinheiro, sem render, até lá.
- **Eventos de ações:** a quantidade é multiplicada pelo fator no primeiro pregão na base nova, quando esse pregão é depois do dia da compra.
- **Proventos:** recebe quem tem a ação no fechamento da data-com, ou seja, quem comprou até ela. O valor é a quantidade nessa data vezes o valor por ação. O JCP sai com 15% de IR retido na fonte, a opção que vem marcada. Os dividendos são isentos para pessoa física no período coberto. A retenção de 10% sobre dividendos acima de R$ 50 mil por mês da mesma empresa, criada pela Lei 15.270/2025, não é simulada.
- **Reinvestimento**, que vem marcado: cada provento compra ações no fechamento do dia do pagamento, ou do primeiro pregão depois dele. Sem reinvestimento, o provento vira dinheiro parado. O provento com data-com já passada e pagamento ainda por vir conta como a receber, nos dois modos.
- **Resultado:**
  - Valor de hoje = ações × último fechamento + dinheiro + a receber.
  - Retorno total = valor de hoje ÷ investido − 1.
  - Retorno ao ano = (1 + total)^(1/anos) − 1.
  - Valorização = ações × preço de hoje − investido, sem reinvestir.
  - Proventos = soma do que foi recebido.
- **Comparações:** o mesmo valor aplicado no CDI desde o dia da compra. O retorno acima da inflação é (1 + total) ÷ (1 + IPCA do período) − 1. O IPCA vai do começo do mês da compra ao último mês publicado.
- **Em US$:** o valor digitado é convertido em reais pela PTAX do dia da compra, e cada valor volta para dólar pela PTAX da sua data. O IPCA não aparece em dólar, porque é inflação em reais.
- **Fora da conta:** corretagem, emolumentos e IR sobre o ganho de capital na venda.

## 3. De hoje a 5 anos: projeção

### 3.1 O centro: retorno de referência por ação

O retorno esperado de uma ação no longo prazo se decompõe em três blocos:

> retorno ≈ dividend yield + crescimento do lucro por ação + mudança do múltiplo (reprecificação)

É o modelo de blocos de Bogle (1991) e Grinold e Kroner (2002), a mesma lógica do modelo de Gordon (1962) quando o múltiplo não muda. A conta usa a forma multiplicativa: (1 + DY) × (1 + g) × (1 + v) − 1. O resultado é tratado como a mediana do retorno anual, a "referência". O retorno passado da ação **não** entra: retornos médios históricos de uma ação só são ruído demais para servir de previsão (Merton, 1980).

**Dividend yield (DY).** Proventos com data-com nos últimos 12 meses, pela ficha da B3, sobre o preço de hoje. O que não se sustenta é cortado:

| Situação | DY usado |
|---|---|
| Prejuízo nos últimos 12 meses | Zero. Empresa sem lucro tende a cortar proventos |
| Proventos acima do lucro (payout acima de 100%) | O lucro sobre o valor de mercado (earnings yield). O excedente costuma ser extraordinário |
| Demais casos | O DY de 12 meses, com teto de 15% ao ano |

Com a opção de IR do JCP marcada, a parte do DY que foi JCP nos últimos 12 meses sai líquida de 15%.

**Crescimento do lucro por ação (g).** É a média ponderada de três estimativas:

| Estimativa | Conta | Peso |
|---|---|---|
| Histórico | Crescimento anual do lucro por ação em 5 anos, na base de ações de hoje (já com desdobramentos e bonificações), limitado a −10% e +20% | 40% × índice de previsibilidade da empresa ÷ 100. Lucro previsível merece mais crédito ao passado |
| Sustentável | ROE × fração do lucro retida (1 − payout), limitado a 0% e 20%. É o quanto a empresa cresce reinvestindo o que não distribui sem mudar a rentabilidade | 30% |
| Longo prazo | IPCA de 12 meses mais 2% reais ao ano, perto do crescimento nominal de longo prazo da economia | O resto, e o peso de qualquer estimativa que falte |

O peso do longo prazo é a âncora, porque o crescimento alto ou baixo do lucro tende a voltar à média (Chan, Karceski e Lakonishok, 2003).

**Reprecificação (v).** P/L de hoje (valor de mercado ÷ lucro de 12 meses) contra a mediana do P/L da própria empresa nos últimos 10 fins de ano com lucro. A conta exige pelo menos 5 anos com lucro. Supõe que metade da distância se fecha em 5 anos: v = (P/L mediano ÷ P/L de hoje)^(0,5/5) − 1, limitado a ±4% ao ano. Múltiplos voltam à média devagar e com muita incerteza (Campbell e Shiller, 1988 e 1998), daí metade e não tudo. Sem lucro ou sem histórico suficiente, v = 0.

O retorno de referência fica entre −15% e +35% ao ano.

### 3.2 A dispersão: volatilidade e correlações

- **Volatilidade de cada ação:** desvio-padrão dos retornos semanais (log) das últimas 156 semanas, anualizado por √52. Os retornos são totais: o índice soma desdobramentos e proventos, para o dia "ex" não parecer uma queda. Com pouco histórico, a estimativa é puxada para 35% ao ano, com o peso de meio ano de observações: σ = (n·σ_hist + 26·35%) ÷ (n + 26). O resultado fica limitado a 12% e 90%.
- **Correlações:** retornos semanais das semanas em comum, com pelo menos 52 delas. Cada correlação é puxada um quarto do caminho para 0,45, a correlação típica entre ações brasileiras. É um encolhimento em direção à correlação constante (Ledoit e Wolf, 2004), que corrige o excesso de confiança de matrizes estimadas com poucos dados. Sem semanas suficientes, vale 0,45.
- **Carteira:** pesos = valor de cada ação hoje, depois da simulação do passado. O retorno de referência da carteira é a soma dos retornos de referência pelos pesos. A volatilidade é σₚ = √(wᵀ Σ w).

### 3.3 Cenários e probabilidades

O logaritmo do patrimônio em τ anos segue uma normal com média τ·ln(1 + r) e desvio σₚ·√τ, ou seja, o patrimônio é lognormal (passeio aleatório com tendência):

- **Referência**, percentil 50: W₀ × (1 + r)^τ. Metade dos cenários fica acima, metade abaixo.
- **Pessimista**, percentil 10, e **otimista**, percentil 90: a referência × exp(∓1,2816 · σₚ · √τ). Há 1 chance em 10 de ficar abaixo do pessimista e 1 em 10 de ficar acima do otimista.
- **Faixa interna do gráfico:** percentis 25 a 75.
- **Probabilidades em 5 anos:**
  - de ter menos que hoje;
  - de bater o CDI de hoje mantido por 5 anos;
  - de bater a inflação, pelo IPCA de 12 meses mantido.

  Cada uma é a probabilidade de o retorno anual composto passar da taxa, pela mesma distribuição.

O CDI e o IPCA de hoje só servem de régua. Os dois vão mudar, e a régua mostra o custo de oportunidade com os números de hoje.

## 4. Limitações

- **Pontas da distribuição:** a curva normal subestima as pontas. Crises, recuperações judiciais e saltos de preço deixam as perdas grandes mais frequentes do que o cenário pessimista sugere.
- **Retorno de referência:** depende de lucro, proventos e preço de hoje. Lucro extraordinário, ou prejuízo que não se repete, distorce o DY e o P/L.
- **Ficha da B3:** é a fonte dos proventos e dos eventos. Se ela não listar um provento antigo, o retorno do passado sai menor do que foi.
- **Ticker que mudou de código:** só tem a série inteira quando o FCA registra o código antigo da mesma classe e o preço continua na troca.
- **Fechamento diário:** a compra é sempre no fechamento. Quem comprou ao longo do dia pagou outro preço.
- **Custos e impostos:** não entram corretagem, emolumentos nem IR sobre o ganho de capital.

## Referências

- Bogle, J. C. (1991). Investing in the 1990s: Occam's razor revisited. *Journal of Portfolio Management*, 18(1).
- Campbell, J. Y., e Shiller, R. J. (1988). Stock prices, earnings, and expected dividends. *Journal of Finance*, 43(3).
- Campbell, J. Y., e Shiller, R. J. (1998). Valuation ratios and the long-run stock market outlook. *Journal of Portfolio Management*, 24(2).
- Chan, L. K. C., Karceski, J., e Lakonishok, J. (2003). The level and persistence of growth rates. *Journal of Finance*, 58(2).
- Gordon, M. J. (1962). *The Investment, Financing, and Valuation of the Corporation*. Irwin.
- Grinold, R. C., e Kroner, K. F. (2002). The equity risk premium: analyzing the long-run prospects for the stock market. *Investment Insights*, Barclays Global Investors, 5(3).
- Ledoit, O., e Wolf, M. (2004). Honey, I shrunk the sample covariance matrix. *Journal of Portfolio Management*, 30(4).
- Merton, R. C. (1980). On estimating the expected return on the market. *Journal of Financial Economics*, 8(4).
