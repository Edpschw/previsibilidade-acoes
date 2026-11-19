/* Real Terms · dicas de termos.
 * Ao passar o mouse (ou focar, ou tocar no celular) sobre um termo, mostra o que ele é, como ler
 * e exemplos de valores bons e ruins, mais a mediana atual das ações líquidas quando faz sentido.
 * Os termos são achados pelo texto depois de cada renderização: nenhuma tela precisa marcá-los. */
(function () {
  "use strict";

  /** [id, nomes (PT e EN, comparados sem acento e sem sufixo "12m"/"TTM"), pt, en, mediana?]
   *  pt/en = [título, o que é, como ler, bom, ruim]; mediana = [função (e, i) → valor, formato] */
  var LISTA = [
    ["pl", ["P/L", "P/E"],
      ["P/L (preço/lucro)", "Quanto o mercado paga por cada R$ 1 de lucro anual da empresa. Também lido como o número de anos de lucro atual necessários para \"devolver\" o preço.",
        "Menor costuma ser mais barato, mas compare com o próprio setor e com o crescimento: empresa que cresce rápido merece P/L maior. Lucro extraordinário num ano distorce.",
        "5x a 12x com lucro estável (ex.: banco grande a 7x, elétrica a 9x).",
        "Acima de 25x sem crescimento forte que justifique; negativo = a empresa teve prejuízo."],
      ["P/E (price/earnings)", "How much the market pays for each R$ 1 of the company's annual earnings. Also read as the years of current earnings needed to \"pay back\" the price.",
        "Lower is usually cheaper, but compare within the sector and against growth: fast growers deserve a higher P/E. One-off earnings distort it.",
        "5x to 12x with steady earnings (e.g. a large bank at 7x, a utility at 9x).",
        "Above 25x with no strong growth to justify it; negative = the company lost money."],
      [function (e, i) { return i.pl > 0 ? i.pl : null; }, "x"]],
    ["pvp", ["P/VP", "P/B"],
      ["P/VP (preço/valor patrimonial)", "Valor de mercado dividido pelo patrimônio contábil: quanto se paga por cada R$ 1 que a empresa tem de patrimônio no balanço.",
        "Abaixo de 1x, a bolsa avalia a empresa por menos que o patrimônio: pode ser pechincha ou sinal de retorno baixo. Leia sempre junto com o ROE.",
        "0,8x a 2x com ROE acima de 15%.",
        "Acima de 4x com ROE baixo (caro); abaixo de 0,5x costuma indicar problema sério ou ativos que valem menos que o balanço."],
      ["P/B (price/book)", "Market cap divided by book equity: how much you pay for each R$ 1 of equity on the balance sheet.",
        "Below 1x the market values the company at less than its equity: a bargain or a sign of poor returns. Always read it with ROE.",
        "0.8x to 2x with ROE above 15%.",
        "Above 4x with low ROE (expensive); below 0.5x usually signals serious trouble or assets worth less than the books say."],
      [function (e, i) { return i.pvp > 0 ? i.pvp : null; }, "x"]],
    ["dy", ["DY", "Dividend yield", "Yield", "DY do exercício", "Yield, fiscal year"],
      ["Dividend yield (DY)", "Dividendos e JCP dos últimos 12 meses divididos pelo valor de mercado: o rendimento em dinheiro de quem tem a ação, como o \"aluguel\" de um imóvel.",
        "Quanto maior, mais renda, desde que seja recorrente. Confira se veio de lucro do ano ou de um pagamento extraordinário, e se o preço não caiu por um motivo ruim.",
        "5% a 10% ao ano, pago todo ano (ex.: bancos, elétricas, saneamento).",
        "Abaixo de 2% para quem busca renda; acima de 15% quase sempre é pagamento pontual ou preço em queda forte, e não se repete."],
      ["Dividend yield", "Dividends and interest on equity over the last 12 months divided by market cap: the cash return to shareholders, like the rent on a property.",
        "Higher means more income, as long as it recurs. Check whether it came from the year's earnings or a one-off payout, and whether the price fell for a bad reason.",
        "5% to 10% a year, paid every year (e.g. banks, utilities, water companies).",
        "Below 2% if you want income; above 15% is almost always a one-off payment or a collapsing price, and won't repeat."],
      [function (e, i) { return i.dy; }, "%"]],
    ["evebitda", ["EV/EBITDA"],
      ["EV/EBITDA", "Valor da firma (valor de mercado + dívida líquida) dividido pela geração operacional de caixa (EBITDA). Compara empresas com níveis de dívida diferentes.",
        "Menor é mais barato. Melhor que o P/L para empresas endividadas ou com muita depreciação. Não se aplica a bancos e seguradoras.",
        "4x a 8x para empresas maduras.",
        "Acima de 12x sem crescimento alto; negativo = EBITDA negativo."],
      ["EV/EBITDA", "Enterprise value (market cap + net debt) divided by operating cash generation (EBITDA). Lets you compare companies with different debt levels.",
        "Lower is cheaper. Better than P/E for indebted or capital-heavy companies. Not meaningful for banks and insurers.",
        "4x to 8x for mature companies.",
        "Above 12x without high growth; negative = negative EBITDA."],
      [function (e, i) { return i.evEbitda > 0 ? i.evEbitda : null; }, "x"]],
    ["psr", ["P/Receita", "P/Sales", "PSR"],
      ["P/Receita (PSR)", "Valor de mercado dividido pela receita anual. Útil quando o lucro é pequeno ou negativo.",
        "Leia junto com a margem: margem alta justifica P/Receita alto. Varejo e indústria negociam baixo; software e marcas, alto.",
        "Abaixo de 1x para margens apertadas (varejo, construção); até 3x com margem líquida acima de 20%.",
        "Acima de 5x com margem baixa ou sem lucro."],
      ["P/Sales", "Market cap divided by annual revenue. Useful when earnings are small or negative.",
        "Read it with the margin: high margins justify a high P/Sales. Retail and industry trade low; software and brands, high.",
        "Below 1x for thin margins (retail, construction); up to 3x with net margin above 20%.",
        "Above 5x with low margins or no profit."],
      [function (e, i) { return i.psr > 0 ? i.psr : null; }, "x"]],
    ["vm", ["Valor de mercado", "Market cap"],
      ["Valor de mercado", "Número de ações (ON e PN, sem tesouraria) multiplicado pela cotação de cada classe: quanto a bolsa diz que a empresa inteira vale.",
        "Mede tamanho, não qualidade. Empresas grandes tendem a ser mais estáveis e líquidas; as pequenas, mais voláteis e com mais espaço para crescer.",
        "Acima de R$ 10 bi: mais cobertura de analistas e mais fácil de comprar e vender.",
        "Abaixo de R$ 1 bi: preço oscila mais e pode faltar comprador na hora de vender."],
      ["Market cap", "Number of shares (common and preferred, ex-treasury) times each class's price: what the market says the whole company is worth.",
        "It measures size, not quality. Large companies tend to be steadier and more liquid; small ones more volatile, with more room to grow.",
        "Above R$ 10 bn: more analyst coverage and easier to trade.",
        "Below R$ 1 bn: the price swings more and buyers can be scarce when you sell."],
      [function (e, i) { return i.vm; }, "$"]],
    ["liquidez", ["Liquidez", "Liquidez/dia", "Liquidez média", "Volume negociado por dia", "Daily volume", "Avg. daily volume", "Daily traded volume"],
      ["Liquidez média diária", "Volume financeiro médio negociado por dia na B3 no último mês, somando todas as classes de ação.",
        "Indica se dá para comprar e vender sem mexer no preço. Para investidor estrangeiro e posições grandes, é o primeiro filtro.",
        "Acima de R$ 10 mi por dia; as maiores passam de R$ 500 mi.",
        "Abaixo de R$ 1 mi por dia: ordens grandes movem o preço e pode levar dias para sair."],
      ["Average daily volume", "Average value traded per day on B3 over the last month, across all share classes.",
        "Tells you whether you can buy and sell without moving the price. For foreign investors and large positions, it is the first filter.",
        "Above R$ 10 m a day; the largest names trade over R$ 500 m.",
        "Below R$ 1 m a day: large orders move the price and exiting can take days."],
      [function (e) { return e.liquidez == null ? null : e.liquidez / 1000; }, "$"]],
    ["score", ["Previsibilidade", "Predictability", "Índice de previsibilidade", "Predictability score"],
      ["Índice de previsibilidade", "Nota de 0 a 100 do Real Terms que mede quão regulares foram lucro, margem, receita, crescimento e dividendos nos últimos 10 anos. Não mede preço.",
        "Quanto maior, mais o passado da empresa foi constante, o que torna o futuro mais fácil de estimar. Não é recomendação: empresa previsível também pode estar cara.",
        "75 ou mais (alta): lucro todo ano, margens estáveis e dividendos regulares.",
        "Abaixo de 50 (baixa): prejuízos, receita aos saltos ou dividendos irregulares."],
      ["Predictability score", "Real Terms' 0–100 score of how steady earnings, margins, revenue, growth and dividends were over the last 10 years. It does not measure price.",
        "The higher it is, the more consistent the company's past, which makes its future easier to estimate. Not a recommendation: a predictable company can still be expensive.",
        "75 or more (high): profit every year, stable margins and regular dividends.",
        "Below 50 (low): losses, erratic revenue or irregular dividends."],
      [function (e) { return (e.score[window.RealTerms.estado.moeda] || {}).total; }, "n"]],
    ["receita", ["Receita", "Revenue", "Receita líquida", "Net revenue"],
      ["Receita líquida", "Tudo o que a empresa faturou com vendas e serviços no período, já sem impostos sobre vendas e devoluções.",
        "Mostra o tamanho do negócio. O que importa é a tendência: crescer acima da inflação, ano após ano.",
        "Crescendo acima de 10% ao ano de forma constante.",
        "Caindo vários anos seguidos ou crescendo abaixo da inflação (cerca de 4% a 5% ao ano)."],
      ["Net revenue", "Everything the company billed for goods and services in the period, net of sales taxes and returns.",
        "Shows the size of the business. What matters is the trend: growing faster than inflation, year after year.",
        "Growing above 10% a year, steadily.",
        "Falling several years in a row, or growing below inflation (around 4–5% a year in Brazil)."]],
    ["lucro", ["Lucro líquido", "Net income", "Lucro", "Earnings"],
      ["Lucro líquido", "O que sobra da receita depois de todos os custos, despesas, juros e impostos. Aqui é o consolidado, incluindo a parte de minoritários.",
        "Mais importante que o valor de um ano é a regularidade: lucro todo ano e crescendo.",
        "Positivo todos os anos e crescendo acima da inflação.",
        "Prejuízo, ou lucro que alterna entre anos muito bons e muito ruins."],
      ["Net income", "What's left of revenue after all costs, expenses, interest and taxes. Shown here on a consolidated basis, including minority interests.",
        "Consistency matters more than any single year: profit every year, and growing.",
        "Positive every year and growing faster than inflation.",
        "Losses, or earnings that swing between very good and very bad years."]],
    ["lpa", ["LPA", "EPS"],
      ["LPA (lucro por ação)", "Lucro da controladora dividido pelo número de ações em circulação.",
        "Compare ao longo dos anos: LPA crescendo significa que cada ação tem direito a mais lucro. Preço ÷ LPA = P/L.",
        "Subindo ano após ano, sem saltos.",
        "Negativo ou caindo; também cai quando a empresa emite muitas ações novas."],
      ["EPS (earnings per share)", "Net income attributable to shareholders divided by shares outstanding.",
        "Compare across years: rising EPS means each share is entitled to more profit. Price ÷ EPS = P/E.",
        "Rising year after year, without jumps.",
        "Negative or falling; it also falls when the company issues many new shares."]],
    ["vpa", ["VPA", "Book value/share"],
      ["VPA (valor patrimonial por ação)", "Patrimônio da controladora dividido pelo número de ações: a parte do patrimônio contábil que cabe a cada ação.",
        "Preço ÷ VPA = P/VP. VPA crescendo mostra que a empresa retém lucro e aumenta o patrimônio.",
        "Crescendo de forma constante.",
        "Caindo, o que indica prejuízos ou distribuição acima do lucro."],
      ["Book value per share", "Shareholders' equity divided by shares outstanding: each share's slice of book equity.",
        "Price ÷ book value per share = P/B. A rising figure shows the company retains earnings and builds equity.",
        "Growing steadily.",
        "Falling, which points to losses or payouts above earnings."]],
    ["roe", ["ROE"],
      ["ROE (retorno sobre o patrimônio)", "Lucro da controladora dividido pelo patrimônio da controladora: quanto a empresa ganha por ano com cada R$ 1 dos acionistas.",
        "É a medida-chave de qualidade. Deve superar o custo de oportunidade (a renda fixa no Brasil rende 10% a 15% ao ano). Patrimônio muito pequeno infla o número.",
        "Acima de 15% de forma constante (ex.: bancos grandes perto de 20%).",
        "Abaixo de 8%: perde para a renda fixa; negativo = prejuízo."],
      ["ROE (return on equity)", "Net income to shareholders divided by shareholders' equity: what the company earns each year on each R$ 1 of shareholder money.",
        "The key quality measure. It should beat the opportunity cost (Brazilian fixed income pays 10–15% a year). A tiny equity base inflates it.",
        "Above 15%, consistently (e.g. large banks near 20%).",
        "Below 8%: loses to fixed income; negative = a loss."],
      [function (e, i) { return i.d12 ? i.roe12 : i.roe; }, "%"]],
    ["roa", ["ROA"],
      ["ROA (retorno sobre o ativo)", "Lucro líquido dividido pelo ativo total: quanto a empresa ganha com tudo o que possui, independentemente de como se financia.",
        "Bancos têm ROA naturalmente baixo, porque trabalham com muito ativo e pouco patrimônio. Compare dentro do setor.",
        "Acima de 8% em empresas não financeiras; acima de 1,5% em bancos.",
        "Abaixo de 3% em empresas não financeiras; abaixo de 0,8% em bancos."],
      ["ROA (return on assets)", "Net income divided by total assets: what the company earns on everything it owns, regardless of how it is financed.",
        "Banks naturally have a low ROA, since they run large assets on thin equity. Compare within the sector.",
        "Above 8% for non-financials; above 1.5% for banks.",
        "Below 3% for non-financials; below 0.8% for banks."]],
    ["mbruta", ["Margem bruta", "Gross margin"],
      ["Margem bruta", "Resultado bruto (receita menos custo dos produtos ou serviços) dividido pela receita.",
        "Mostra o poder de preço. Varia muito por setor: compare com concorrentes.",
        "Acima de 40%: marca forte ou produto com pouca concorrência.",
        "Abaixo de 15%: negócio de volume, sensível a qualquer alta de custo."],
      ["Gross margin", "Gross profit (revenue minus cost of goods or services) divided by revenue.",
        "Shows pricing power. It varies a lot by sector: compare with peers.",
        "Above 40%: a strong brand or a product with little competition.",
        "Below 15%: a volume business, sensitive to any cost increase."]],
    ["mebit", ["Margem EBIT", "EBIT margin"],
      ["Margem EBIT (operacional)", "Resultado antes de juros e impostos dividido pela receita: quanto da receita vira lucro da operação.",
        "Isola a eficiência do negócio, sem o efeito da dívida. Compare com o setor e ao longo dos anos.",
        "Acima de 15%.", "Abaixo de 5% ou negativa."],
      ["EBIT margin (operating)", "Earnings before interest and taxes divided by revenue: how much of revenue becomes operating profit.",
        "Isolates business efficiency from the effect of debt. Compare with the sector and over time.",
        "Above 15%.", "Below 5% or negative."]],
    ["mebitda", ["Margem EBITDA", "EBITDA margin", "EBITDA"],
      ["EBITDA e margem EBITDA", "EBITDA é o resultado operacional antes de depreciação e amortização, uma aproximação da geração de caixa da operação. A margem o divide pela receita.",
        "Bom para comparar empresas com muitos ativos (energia, mineração, telecom). Ignora o investimento necessário para manter os ativos.",
        "Margem acima de 25% (elétricas, saneamento e mineradoras chegam a 40% ou mais).",
        "Margem abaixo de 10%, ou EBITDA negativo."],
      ["EBITDA and EBITDA margin", "EBITDA is operating income before depreciation and amortization, a proxy for operating cash generation. The margin divides it by revenue.",
        "Good for comparing asset-heavy companies (power, mining, telecom). It ignores the investment needed to maintain the assets.",
        "Margin above 25% (utilities, water and miners reach 40% or more).",
        "Margin below 10%, or negative EBITDA."]],
    ["mliq", ["Margem líquida", "Marg. líq.", "Net margin"],
      ["Margem líquida", "Lucro líquido dividido pela receita: quantos centavos de lucro sobram de cada R$ 1 vendido.",
        "Margem alta e estável é sinal de vantagem competitiva. Varejo trabalha com margem baixa por natureza.",
        "Acima de 10% e estável.",
        "Abaixo de 3%, negativa, ou oscilando muito de um ano para outro."],
      ["Net margin", "Net income divided by revenue: how many cents of profit remain from each R$ 1 sold.",
        "A high, stable margin signals a competitive advantage. Retail runs on thin margins by nature.",
        "Above 10% and stable.",
        "Below 3%, negative, or swinging a lot from year to year."],
      [function (e, i) { return i.d12 ? i.mLiq12 : i.mLiq; }, "%"]],
    ["divliq", ["Dív. líquida", "Dívida líquida", "Net debt"],
      ["Dívida líquida", "Empréstimos e financiamentos menos caixa e aplicações financeiras.",
        "Negativa significa caixa líquido: a empresa tem mais dinheiro do que deve. Sozinha diz pouco; compare com o EBITDA.",
        "Negativa (caixa líquido) ou pequena perto do EBITDA.",
        "Crescendo mais rápido que o EBITDA por vários anos."],
      ["Net debt", "Loans and financing minus cash and financial investments.",
        "Negative means net cash: the company holds more cash than it owes. On its own it says little; compare it with EBITDA.",
        "Negative (net cash) or small relative to EBITDA.",
        "Growing faster than EBITDA for several years."]],
    ["dlebitda", ["Dív. líq./EBITDA", "Dív.líq./EBITDA", "Net debt/EBITDA"],
      ["Dívida líquida / EBITDA", "Quantos anos da geração operacional de caixa seriam necessários para pagar toda a dívida líquida.",
        "Menor é mais seguro. Setores com receita previsível (energia, saneamento) aguentam mais dívida. Não se aplica a bancos.",
        "Abaixo de 1,5x; negativo = caixa líquido, ainda melhor.",
        "Acima de 3x: juros pesam no lucro e o risco cresce se a receita cair; acima de 4x é alerta."],
      ["Net debt / EBITDA", "How many years of operating cash generation it would take to repay all net debt.",
        "Lower is safer. Sectors with predictable revenue (power, water) can carry more debt. Not meaningful for banks.",
        "Below 1.5x; negative = net cash, even better.",
        "Above 3x: interest weighs on earnings and risk rises if revenue falls; above 4x is a red flag."],
      [function (e, i) { return i.d12 ? i.dlEbitda12 : i.dlEbitda; }, "x"]],
    ["dlpl", ["Dív. líq./PL", "Net debt/equity"],
      ["Dívida líquida / patrimônio", "Dívida líquida dividida pelo patrimônio da controladora: quanto do negócio é financiado por credores em vez de acionistas.",
        "Menor é mais conservador. Complementa a Dív. líq./EBITDA quando o EBITDA está deprimido.",
        "Abaixo de 0,5x.", "Acima de 1,5x."],
      ["Net debt / equity", "Net debt divided by shareholders' equity: how much of the business is financed by lenders rather than shareholders.",
        "Lower is more conservative. Complements net debt/EBITDA when EBITDA is depressed.",
        "Below 0.5x.", "Above 1.5x."]],
    ["dividendos", ["Dividendos pagos", "Dividends paid", "Dividendo", "Dividend", "Dividendos", "Dividends"],
      ["Dividendos", "Parte do lucro distribuída em dinheiro aos acionistas. No Brasil, a lei obriga a distribuir ao menos 25% do lucro ajustado, salvo exceções.",
        "O valor em si importa menos que a regularidade e a relação com o lucro (payout).",
        "Pagos todos os anos, crescendo junto com o lucro.",
        "Irregulares, cortados com frequência ou maiores que o lucro por vários anos."],
      ["Dividends", "The part of earnings paid out in cash to shareholders. Brazilian law requires paying at least 25% of adjusted earnings, with some exceptions.",
        "The amount matters less than its regularity and its relation to earnings (payout).",
        "Paid every year, growing with earnings.",
        "Irregular, often cut, or above earnings for several years."]],
    ["dpa", ["Dividendo/ação", "Dividend/share", "Por ação", "Per share", "por ação", "per share"],
      ["Dividendo por ação", "Valor em dinheiro pago por ação. Dividido pela cotação, dá o yield do pagamento.",
        "Compare com o preço da ação e com os pagamentos dos anos anteriores.",
        "Estável ou crescendo ano a ano.", "Caindo ou pago só em anos isolados."],
      ["Dividend per share", "Cash paid per share. Divided by the share price, it gives the payment's yield.",
        "Compare with the share price and with previous years' payments.",
        "Stable or growing year over year.", "Falling, or paid only in isolated years."]],
    ["payout", ["Payout", "Payout (caixa)", "Payout (cash)"],
      ["Payout", "Fração do lucro distribuída como dividendos e JCP.",
        "Payout alto dá renda hoje; baixo deixa dinheiro para crescer. O mínimo legal no Brasil é 25%.",
        "25% a 70%, compatível com o caixa gerado.",
        "Acima de 100% (paga mais do que lucra, não se sustenta) ou zero por anos seguidos."],
      ["Payout", "Share of earnings paid out as dividends and interest on equity.",
        "A high payout gives income now; a low one funds growth. Brazil's legal minimum is 25%.",
        "25% to 70%, in line with the cash generated.",
        "Above 100% (paying more than it earns, unsustainable) or zero for years."]],
    ["fcl", ["Fluxo de caixa livre", "Free cash flow"],
      ["Fluxo de caixa livre", "Caixa gerado pela operação menos o investimento em imobilizado e intangível (capex): o dinheiro que sobra para pagar dívida e acionistas.",
        "Mais difícil de maquiar que o lucro. Deve acompanhar o lucro ao longo dos anos. Não se aplica a bancos.",
        "Positivo todo ano e próximo do lucro líquido.",
        "Negativo por vários anos seguidos, financiado com dívida."],
      ["Free cash flow", "Operating cash flow minus capital expenditure: the cash left over to pay down debt and reward shareholders.",
        "Harder to dress up than earnings. Over the years it should track net income. Not meaningful for banks.",
        "Positive every year and close to net income.",
        "Negative several years running, funded with debt."]],
    ["cagrrec", ["CAGR receita 5a", "Revenue CAGR 5y", "Crescimento da receita (5 anos)", "Revenue growth (5y)", "Receita, 5 anos (a.a.)", "Revenue, 5y CAGR"],
      ["Crescimento anual da receita (CAGR, 5 anos)", "Taxa média de crescimento composto da receita nos últimos 5 anos.",
        "Compare com a inflação (cerca de 4% a 5% ao ano): abaixo dela, a empresa encolhe em termos reais. Em US$, o câmbio pesa.",
        "Acima de 10% ao ano.", "Abaixo da inflação ou negativo."],
      ["Revenue growth (CAGR, 5 years)", "Compound average annual revenue growth over the last 5 years.",
        "Compare with inflation (around 4–5% a year in Brazil): below it, the company shrinks in real terms. In US$, the currency weighs in.",
        "Above 10% a year.", "Below inflation, or negative."],
      [function (e, i) { return i.cagrRec; }, "%"]],
    ["cagrluc", ["CAGR lucro 5a", "Earnings CAGR 5y"],
      ["Crescimento anual do lucro (CAGR, 5 anos)", "Taxa média de crescimento composto do lucro da controladora nos últimos 5 anos.",
        "Sensível ao ano de partida: se o primeiro ano foi ruim, o número sai inflado.",
        "Acima de 10% ao ano, com lucro positivo em todos os anos.", "Negativo, ou alto só porque partiu de um ano de lucro baixo."],
      ["Earnings growth (CAGR, 5 years)", "Compound average annual growth of earnings to shareholders over the last 5 years.",
        "Sensitive to the starting year: if the first year was weak, the figure is inflated.",
        "Above 10% a year, with profit in every year.", "Negative, or high only because it started from a weak year."]],
    ["comp_lucro", ["Lucro positivo", "Positive earnings"],
      ["Lucro positivo (30% do índice)", "Fração dos anos da janela em que a empresa teve lucro líquido.",
        "Nota de 0 a 100: 100 significa lucro em todos os anos.", "100: lucro todo ano.", "Abaixo de 70: prejuízo em 3 ou mais anos de 10."],
      ["Positive earnings (30% of the score)", "Share of years in the window with positive net income.",
        "0–100 score: 100 means profit in every year.", "100: profit every year.", "Below 70: losses in 3 or more years out of 10."]],
    ["comp_margem", ["Margem estável", "Stable margin"],
      ["Margem estável (25% do índice)", "Mede quanto a margem líquida oscila de um ano para outro (desvio-padrão).",
        "Nota de 0 a 100: quanto menos a margem varia, maior a nota. Desvio de 15 pontos percentuais ou mais zera.",
        "80 ou mais: margem quase constante.", "Abaixo de 40: margem aos saltos."],
      ["Stable margin (25% of the score)", "Measures how much the net margin swings from year to year (standard deviation).",
        "0–100 score: the less the margin varies, the higher the score. A 15-point deviation or more scores zero.",
        "80 or more: an almost constant margin.", "Below 40: an erratic margin."]],
    ["comp_receita", ["Receita estável", "Stable revenue"],
      ["Receita estável (15% do índice)", "Mede a oscilação do crescimento anual da receita.",
        "Nota de 0 a 100. Desvio de 30 pontos percentuais ou mais no crescimento zera.",
        "80 ou mais: receita cresce num ritmo parecido todo ano.", "Abaixo de 40: anos de salto alternados com quedas (típico de commodities)."],
      ["Stable revenue (15% of the score)", "Measures the volatility of annual revenue growth.",
        "0–100 score. A 30-point deviation or more in growth scores zero.",
        "80 or more: revenue grows at a similar pace every year.", "Below 40: boom years alternating with drops (typical of commodities)."]],
    ["comp_tendencia", ["Crescimento constante", "Steady growth"],
      ["Crescimento constante (15% do índice)", "Mede o quanto a receita segue uma reta ascendente (R² da tendência).",
        "Nota de 0 a 100. Receita em queda na janela zera.",
        "80 ou mais: crescimento quase linear.", "Abaixo de 40: sem tendência clara ou em queda."],
      ["Steady growth (15% of the score)", "Measures how closely revenue follows a rising straight line (trend R²).",
        "0–100 score. Falling revenue over the window scores zero.",
        "80 or more: near-linear growth.", "Below 40: no clear trend, or falling."]],
    ["comp_dividendos", ["Dividendos regulares", "Regular dividends"],
      ["Dividendos regulares (15% do índice)", "Fração dos anos da janela com dividendos ou JCP pagos.",
        "Nota de 0 a 100: 100 significa pagamento em todos os anos.", "100: pagou todo ano.", "Abaixo de 50: pagou em menos da metade dos anos."],
      ["Regular dividends (15% of the score)", "Share of years in the window with dividends or interest on equity paid.",
        "0–100 score: 100 means a payment every year.", "100: paid every year.", "Below 50: paid in fewer than half the years."]],
    ["jcp", ["JCP", "Interest on equity"],
      ["JCP (juros sobre capital próprio)", "Forma brasileira de remunerar o acionista que a empresa pode deduzir do imposto. Funciona como um dividendo, mas com 15% de imposto retido na fonte.",
        "Some ao dividendo para calcular o yield. Para estrangeiros, a retenção pode variar conforme o país.",
        "Pago todo ano, junto com os dividendos.", "Usado de forma irregular para inflar um ano isolado."],
      ["Interest on equity (JCP)", "A Brazilian way of paying shareholders that is tax-deductible for the company. It works like a dividend, with 15% withheld at source.",
        "Add it to dividends to compute the yield. For foreigners, withholding may vary by country.",
        "Paid every year, alongside dividends.", "Used irregularly to boost a single year."]],
    ["datacom", ["Data-com", "Record date"],
      ["Data-com", "Último dia em que é preciso ter a ação para receber o provento anunciado. No dia seguinte (ex), a ação passa a ser negociada sem o direito.",
        "Comprar depois da data-com não dá direito ao pagamento. No dia ex, o preço costuma cair perto do valor do provento.",
        "Comprar antes da data-com quando o yield do evento compensa.", "Comprar no dia ex achando que ainda recebe."],
      ["Record date", "The last day you must hold the share to receive the announced payment. The next day (ex-date) the share trades without the right.",
        "Buying after the record date does not entitle you to the payment. On the ex-date the price usually drops by about the payment amount.",
        "Buying before the record date when the event yield is worth it.", "Buying on the ex-date thinking you'll still be paid."]],
    ["pagamento", ["Pagamento", "Payment", "Data de pagamento", "Payment date"],
      ["Data de pagamento", "Dia em que o dinheiro do provento cai na conta de quem tinha a ação na data-com.",
        "Pode vir semanas ou meses depois da data-com. Pagamentos sem data definida ainda não aparecem na agenda.",
        "Data definida e próxima.", "Sem data (\"a definir\") por muito tempo."],
      ["Payment date", "The day the cash reaches the accounts of those who held the share on the record date.",
        "It can come weeks or months after the record date. Payments without a set date don't appear in the calendar yet.",
        "A set, near date.", "No date (\"to be defined\") for a long time."]],
    ["adr", ["ADR"],
      ["ADR", "Recibo negociado em bolsa americana (NYSE, Nasdaq) que representa ações brasileiras.",
        "Empresas com ADR seguem também as regras da SEC, com mais exigência de transparência.",
        "Nível 2 ou 3 (listado em bolsa, auditoria nos padrões americanos).", "Nível 1 (balcão), com exigências menores."],
      ["ADR", "A receipt traded on a US exchange (NYSE, Nasdaq) that represents Brazilian shares.",
        "Companies with ADRs also follow SEC rules, with stricter disclosure.",
        "Level 2 or 3 (exchange-listed, US-standard audit).", "Level 1 (over the counter), with lighter requirements."]],
    ["estatal", ["Estatal", "State-owned"],
      ["Estatal", "Empresa controlada pelo governo federal ou estadual.",
        "Costuma ter custo baixo de capital, mas sofre risco político: preços, investimentos e dividendos podem seguir objetivos do governo.",
        "Regras de dividendos e de preços definidas em estatuto.", "Troca frequente de diretoria ou intervenção em preços."],
      ["State-owned", "A company controlled by the federal or a state government.",
        "Usually enjoys cheap capital but carries political risk: prices, investment and dividends may follow government goals.",
        "Dividend and pricing rules written into the bylaws.", "Frequent management changes or price intervention."]],
    ["estrangeiro", ["Controle estrangeiro", "Foreign-controlled"],
      ["Controle estrangeiro", "O acionista controlador é uma empresa ou grupo de fora do Brasil.",
        "Decisões seguem a estratégia global do grupo. Pode haver fechamento de capital ou fluxo de royalties para a matriz.",
        "Matriz forte que investe no negócio local.", "Histórico de ofertas de fechamento de capital a preço baixo."],
      ["Foreign-controlled", "The controlling shareholder is a company or group based outside Brazil.",
        "Decisions follow the group's global strategy. There may be take-private offers or royalties paid to the parent.",
        "A strong parent investing in the local business.", "A history of low-priced take-private offers."]],
    ["novomercado", ["Novo Mercado", "Novo Mercado (highest governance)"],
      ["Novo Mercado", "Segmento da B3 com as regras de governança mais exigentes: só ações ordinárias (todas votam), conselho com independentes e tag along de 100%.",
        "Protege o acionista minoritário. Para investidor estrangeiro, é o segmento mais próximo do padrão internacional.",
        "Novo Mercado.", "Segmento básico, com ações PN sem voto e menos proteção."],
      ["Novo Mercado", "B3's listing segment with the strictest governance: common (voting) shares only, independent directors and 100% tag-along rights.",
        "Protects minority shareholders. For foreign investors, it is the closest to international standards.",
        "Novo Mercado.", "The basic segment, with non-voting preferred shares and less protection."]],
    ["nivel", [/^(nivel [12]|level [12])\b/],
      ["Nível 1 e Nível 2 de governança", "Segmentos intermediários da B3. O Nível 2 aceita ações PN, mas dá a elas tag along e direitos próximos aos do Novo Mercado; o Nível 1 exige sobretudo mais transparência.",
        "Em ordem de proteção ao minoritário: Novo Mercado > Nível 2 > Nível 1 > Básico.",
        "Nível 2: boa proteção mesmo com ações PN.", "Nível 1: menos direitos para quem tem PN."],
      ["Level 1 and Level 2 governance", "B3's intermediate segments. Level 2 allows preferred shares but gives them tag-along and rights close to Novo Mercado; Level 1 mainly requires more disclosure.",
        "In order of minority protection: Novo Mercado > Level 2 > Level 1 > Basic.",
        "Level 2: good protection even with preferred shares.", "Level 1: fewer rights for preferred holders."]],
    ["percentil", ["Percentil", "Percentile"],
      ["Percentil", "Posição de um valor entre as ações líquidas: p80 significa melhor que 80% delas no indicador.",
        "Já leva em conta o sentido: em P/L, percentil alto é P/L baixo.",
        "p75 ou mais.", "p25 ou menos."],
      ["Percentile", "A value's position among liquid stocks: p80 means better than 80% of them on that metric.",
        "Direction is already accounted for: for P/E, a high percentile means a low P/E.",
        "p75 or above.", "p25 or below."]],
    ["mediana", ["Mediana", "Median"],
      ["Mediana", "O valor do meio: metade das ações líquidas está acima e metade abaixo.",
        "Serve de régua do \"normal\" do mercado. Diferente da média, não é distorcida por casos extremos.",
        "Melhor que a mediana no indicador.", "Pior que a mediana em quase todos os indicadores."],
      ["Median", "The middle value: half of liquid stocks are above and half below.",
        "A yardstick for what's \"normal\" in the market. Unlike the average, extremes don't distort it.",
        "Better than the median on the metric.", "Worse than the median on almost every metric."]],
  ];

  // ---------------------------------------------------------------- busca pelo texto

  function norm(s) {
    return String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/[↓▲↗→]/g, "").replace(/\s+/g, " ").trim()
      .replace(/\s*(\(12 meses\)|\(ttm\)|12m|12 meses|ttm|, 12 months|, trailing 12 months)$/, "")
      .replace(/[:·]$/, "").trim();
  }
  var PORNOME = {}, REGEX = [], PORID = {};
  LISTA.forEach(function (t) {
    PORID[t[0]] = t;
    t[1].forEach(function (n) { if (n instanceof RegExp) REGEX.push([n, t[0]]); else PORNOME[norm(n)] = t[0]; });
  });
  function achar(txt) {
    if (!txt || txt.length > 48) return null;
    var n = norm(txt);
    if (PORNOME[n]) return PORNOME[n];
    var adr = /^adr( .*)?$/.test(n) ? "adr" : null;
    if (adr) return adr;
    for (var k = 0; k < REGEX.length; k++) if (REGEX[k][0].test(n)) return REGEX[k][1];
    return null;
  }

  var FORA = "button, select, option, input, nav, .secoes, .pilulas, svg, .dica, .termo-dica, .tickers, .busca";
  /** marca os termos de `raiz`: o elemento mais interno cujo texto inteiro é um termo */
  function marcar(raiz) {
    var els = raiz.querySelectorAll("th, td, dt, abbr, span, b, h3, label, small, div, a");
    for (var k = els.length - 1; k >= 0; k--) {
      var el = els[k];
      if (el.hasAttribute("data-termo") || el.children.length > 3) continue;
      var txt = el.textContent;
      if (!txt || txt.length > 48) continue;
      var id = achar(txt);
      if (!id || el.querySelector("[data-termo]") || el.closest(FORA)) continue;
      if (el.tagName === "A" && el.getAttribute("href")) continue;
      el.setAttribute("data-termo", id);
      if (el.title) { el.setAttribute("data-calc", el.title); el.removeAttribute("title"); }
      if (!el.hasAttribute("tabindex") && el.tagName !== "TH") el.setAttribute("tabindex", "0");
    }
  }

  // ---------------------------------------------------------------- medianas das ações líquidas

  var cacheMed = {};
  function mediana(id) {
    var X = window.RealTerms, t = PORID[id];
    if (!X || !t[4]) return null;
    var chave = id + "|" + X.estado.moeda;
    if (chave in cacheMed) return cacheMed[chave];
    var vs = X.EMPRESAS.filter(function (e) { return Object.keys(e.cotacao).length && e.liquidez >= 1e6; })
      .map(function (e) { return t[4][0](e, X.indicadores(e)); })
      .filter(function (v) { return v != null && isFinite(v); }).sort(function (a, b) { return a - b; });
    var m = vs.length ? (vs.length % 2 ? vs[(vs.length - 1) / 2] : (vs[vs.length / 2 - 1] + vs[vs.length / 2]) / 2) : null;
    return (cacheMed[chave] = m == null ? null : { v: m, n: vs.length });
  }
  function fmt(v, f) {
    var X = window.RealTerms;
    if (f === "x") return X.vezes(v);
    if (f === "%") return X.pct(v, 1);
    if (f === "$") return X.dinheiro(v);
    return X.nf(0).format(v);
  }

  // ---------------------------------------------------------------- a caixa

  var caixa = null, atual = null, timer = null;
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function conteudo(el) {
    var X = window.RealTerms, id = el.getAttribute("data-termo"), t = PORID[id];
    var en = X && X.estado.lingua === "en", d = en ? t[3] : t[2];
    var L = function (pt, ing) { return en ? ing : pt; };
    var m = mediana(id), calc = el.getAttribute("data-calc");
    return "<b>" + esc(d[0]) + "</b><p>" + esc(d[1]) + "</p>" +
      '<p class="td-ler"><i>' + L("Como ler", "How to read it") + "</i> " + esc(d[2]) + "</p>" +
      '<div class="td-faixas"><div class="td-bom"><i>' + L("Bom", "Good") + "</i>" + esc(d[3]) + "</div>" +
      '<div class="td-ruim"><i>' + L("Ruim", "Bad") + "</i>" + esc(d[4]) + "</div></div>" +
      (m ? '<p class="td-ref">' + L("Hoje, mediana das ", "Today's median across ") + m.n + L(" ações líquidas: ", " liquid stocks: ") + "<b>" + fmt(m.v, t[4][1]) + "</b></p>" : "") +
      (calc ? '<p class="td-ref">' + L("Neste número: ", "This figure: ") + esc(calc) + "</p>" : "") +
      '<p class="td-aviso">' + L("Faixas de referência gerais; compare sempre com o setor. Não é recomendação.", "General reference ranges; always compare within the sector. Not a recommendation.") + "</p>";
  }
  function mostrar(el) {
    clearTimeout(timer);
    if (!caixa) { caixa = document.createElement("div"); caixa.className = "termo-dica"; caixa.setAttribute("role", "tooltip"); caixa.id = "termo-dica"; document.body.appendChild(caixa); }
    atual = el;
    caixa.innerHTML = conteudo(el);
    caixa.hidden = false;
    el.setAttribute("aria-describedby", "termo-dica");
    var r = el.getBoundingClientRect(), w = caixa.offsetWidth, h = caixa.offsetHeight, m = 8;
    var x = Math.min(Math.max(m, r.left + r.width / 2 - w / 2), window.innerWidth - w - m);
    var y = r.bottom + 8;
    if (y + h > window.innerHeight - m && r.top - h - 8 > m) y = r.top - h - 8;
    caixa.style.left = x + "px"; caixa.style.top = Math.max(m, y) + "px";
  }
  function esconder() {
    clearTimeout(timer);
    if (atual) atual.removeAttribute("aria-describedby");
    atual = null;
    if (caixa) caixa.hidden = true;
  }

  var tocavel = window.matchMedia && matchMedia("(hover: none)").matches;
  document.addEventListener("mouseover", function (ev) {
    if (tocavel) return;
    var el = ev.target.closest && ev.target.closest("[data-termo]");
    if (el === atual) return;
    if (!el) { if (atual) timer = setTimeout(esconder, 80); return; }
    clearTimeout(timer);
    timer = setTimeout(function () { mostrar(el); }, 180);
  });
  document.addEventListener("focusin", function (ev) { if (tocavel) return; var el = ev.target.closest && ev.target.closest("[data-termo]"); if (el) mostrar(el); });
  document.addEventListener("focusout", esconder);
  document.addEventListener("keydown", function (ev) { if (ev.key === "Escape") esconder(); });
  window.addEventListener("scroll", esconder, { passive: true });
  // no celular: toque mostra; toque fora (ou no mesmo termo) esconde
  document.addEventListener("click", function (ev) {
    if (!tocavel) return;
    var el = ev.target.closest && ev.target.closest("[data-termo]");
    if (el && el !== atual) mostrar(el); else esconder();
  });

  // remarca depois de cada renderização (troca de rota, idioma, moeda, ordenação)
  var app = document.getElementById("app"), pendente = false;
  function agendar() {
    if (pendente) return;
    pendente = true;
    setTimeout(function () { pendente = false; cacheMed = {}; if (atual && !document.contains(atual)) esconder(); marcar(app); }, 30);
  }
  if (app) { new MutationObserver(agendar).observe(app, { childList: true, subtree: true }); agendar(); }

  window.RealTermsTermos = { lista: LISTA, achar: achar, marcar: marcar };
})();
