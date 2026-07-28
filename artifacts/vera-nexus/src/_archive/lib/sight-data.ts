import { useQuery } from '@tanstack/react-query';

export interface IndexTick {
  name: string;
  value: string;
  change: number;
}

export interface NewsSlide {
  title: string;
  body: string;
}

export interface NewsArticle {
  id: number;
  cat: string;
  tagLabel: string;
  hero?: boolean;
  title: string;
  hook?: string; // One-line punchy hook for story rail
  blurb: string;
  img: string;
  source: string;
  time: string;
  body: string[];
  stats: { label: string; value: string }[];
  slides?: NewsSlide[]; // 2-3 mini-sections for story viewer
}

export interface StockInfo {
  sym: string;
  name: string;
  price: number;
  chg: number;
}

const MOCK_INDICES: IndexTick[] = [
  { name: 'SENSEX', value: '76,802.90', change: -0.78 },
  { name: 'NIFTY 50', value: '24,013.10', change: -0.64 },
  { name: 'NIFTY BANK', value: '57,685.75', change: -0.48 },
  { name: 'NIFTY MIDCAP', value: '62,517.30', change: 0.22 },
  { name: 'INDIA VIX', value: '13.42', change: 1.85 },
  { name: 'NIFTY IT', value: '41,205.6', change: -1.12 },
  { name: 'S&P 500', value: '5,308.15', change: 0.11 },
  { name: 'NASDAQ', value: '18,671.43', change: 0.28 },
  { name: 'DOW JONES', value: '38,947.67', change: -0.13 },
  { name: 'BTC/USD', value: '67,420.50', change: 1.47 },
];

const MOCK_ARTICLES: NewsArticle[] = [
  {
    id: 1, cat: 'markets', tagLabel: 'Markets', hero: true,
    title: 'Nifty slips below 24,050 as financials drag; midcaps buck the trend',
    hook: 'Banks pull benchmark down; midcaps shine on retail bets',
    blurb: 'Banking and energy stocks weighed on the benchmark even as broader markets stayed resilient on domestic fund inflows.',
    img: 'https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?q=80&w=1200&auto=format&fit=crop',
    source: 'Market Desk', time: '18 min ago',
    body: [
      'Indian equity benchmarks closed lower on Friday, with the Nifty 50 slipping under the 24,050 mark as heavyweight private banks and energy counters dragged the index down through the final hour of trade.',
      'Foreign portfolio investors trimmed positions in financials ahead of the weekend, while domestic institutional buying provided a partial cushion. The Nifty Midcap 100 bucked the broader trend, closing in the green on continued retail participation in select industrial and capital goods names.',
      'Traders pointed to elevated volatility heading into the next derivatives expiry, with the India VIX up sharply during the session. Analysts expect a stock-specific market next week as earnings season picks up pace.',
      'Sectorally, IT shed further ground on a stronger rupee, while metals found support on firmer global commodity prices.',
    ],
    stats: [{ label: 'Sentiment', value: 'Cautious' }, { label: 'Key driver', value: 'Bank Nifty' }, { label: 'FII flow', value: '-₹1,025 Cr' }],
    slides: [
      { title: 'The Selloff', body: 'FPIs trimmed positions in private banks, while energy stocks sold off on global concerns. Despite the headwind, domestic flows kept midcap indices resilient.' },
      { title: 'Volatility Ahead', body: 'The India VIX spiked 18% as traders positioned ahead of the weekly expiry. Analysts expect elevated volatility next week as earnings season picks up.' },
      { title: 'Sector Watch', body: 'IT down 1.9% on a stronger rupee. Metals held support on firmer global commodity prices. Capital goods saw continued retail demand.' },
    ],
  },
  {
    id: 2, cat: 'macro', tagLabel: 'Macro',
    title: 'RBI likely to hold rates in August as inflation stays within band',
    hook: 'Steady inflation gives RBI room to stay on pause',
    blurb: 'Economists expect the central bank to maintain its current stance given steady food price trends and a stable currency.',
    img: 'https://images.unsplash.com/photo-1518186285589-2f7649de83e0?q=80&w=800&auto=format&fit=crop',
    source: 'Macro Desk', time: '42 min ago',
    body: [
      'A majority of economists surveyed expect the Reserve Bank of India to keep the repo rate unchanged at its upcoming policy meeting, citing inflation readings that have stayed comfortably within the central bank\'s tolerance band for three consecutive months.',
      'Food price pressures have eased meaningfully since the start of the year, while core inflation has remained sticky but manageable. The rupee has traded in a relatively narrow range against the dollar, reducing the urgency for a defensive rate move.',
      'Bond markets are pricing in a largely neutral outcome, with yields on the 10-year benchmark holding steady ahead of the announcement.',
    ],
    stats: [{ label: 'Expected move', value: 'No change' }, { label: 'Inflation trend', value: 'Easing' }, { label: '10Y yield', value: '7.02%' }],
    slides: [
      { title: 'Inflation Under Control', body: 'CPI has stayed within RBI\'s 4% target for three months. Food inflation eased sharply from peaks, while core inflation remains manageable despite rate cuts.' },
      { title: 'Currency Stability', body: 'The rupee has traded in a narrow 82.5-83.2 range against the dollar, removing urgency for any defensive policy shift by the central bank.' },
      { title: 'Forward Guidance', body: 'Bond markets expect a pause at the August meeting, with rate cuts more likely in Q4. 10Y yields holding at 7.02% signal confidence in the outlook.' },
    ],
  },
  {
    id: 3, cat: 'earnings', tagLabel: 'Earnings',
    title: 'Mid-tier IT firm beats estimates on deal wins, guides cautiously for H2',
    hook: 'Beat on revenue, but guide is cautious for back half',
    blurb: 'Management flagged continued softness in discretionary tech spend from US clients despite a strong order book.',
    img: 'https://images.unsplash.com/photo-1551288049-bebda4e38f71?q=80&w=800&auto=format&fit=crop',
    source: 'Earnings Wire', time: '1 hr ago',
    body: [
      'The company reported quarterly revenue ahead of street estimates, driven by a string of large deal wins in BFSI and healthcare verticals, even as management struck a cautious tone on near-term demand from North American clients.',
      'Operating margins expanded modestly on the back of cost discipline and a richer mix of fixed-price contracts, though the firm flagged continued pressure on discretionary technology spending heading into the back half of the fiscal year.',
      'The stock saw volatile trade in the immediate aftermath of the print as investors weighed the strong order book against the softer guidance.',
    ],
    stats: [{ label: 'Revenue', value: 'Beat' }, { label: 'Margin', value: '+40 bps QoQ' }, { label: 'Guidance', value: 'Cautious' }],
    slides: [
      { title: 'Deal Wins Drive Beat', body: 'Revenue beat powered by large BFSI and healthcare deals. Order book expanded 22%, suggesting strong pipeline for H2 even amid near-term headwinds.' },
      { title: 'Margin Expansion', body: 'Operating margins up 40 bps QoQ to 18.2%, driven by cost discipline and higher fixed-price contract mix. Offset some discretionary spend softness.' },
      { title: 'Guidance: Cautious', body: 'Management flagged continued softness in US discretionary tech spend. H2 growth guide of 6-8% signals slower momentum heading into year-end.' },
    ],
  },
  {
    id: 4, cat: 'global', tagLabel: 'Global',
    title: 'US yields tick higher after stronger-than-expected jobs data',
    blurb: 'Treasury yields rose as traders pared back bets on near-term rate cuts from the Federal Reserve.',
    img: 'https://images.unsplash.com/photo-1590283603385-17ffb3a7f29f?q=80&w=800&auto=format&fit=crop',
    source: 'Global Desk', time: '2 hr ago',
    body: [
      'Treasury yields climbed after a stronger-than-expected payrolls report led traders to scale back expectations of an imminent rate cut from the Federal Reserve, with the probability of action at the next meeting falling sharply.',
      'Asian and European equity markets traded mixed in response, with rate-sensitive sectors underperforming broader benchmarks. The dollar index firmed against a basket of major currencies.',
      'Emerging market assets, including Indian equities, are likely to take cues from the move as global risk appetite resets heading into next week.',
    ],
    stats: [{ label: '10Y UST', value: '4.38%' }, { label: 'Dollar index', value: '+0.4%' }, { label: 'Rate cut odds', value: 'Lower' }],
  },
  {
    id: 5, cat: 'ipo', tagLabel: 'IPO',
    title: 'Logistics-tech startup files draft papers for ₹2,400 Cr IPO',
    blurb: 'The issue will be a mix of fresh shares and an offer for sale by early investors, per the draft filing.',
    img: 'https://images.unsplash.com/photo-1586528116311-ad8dd3c8310d?q=80&w=800&auto=format&fit=crop',
    source: 'IPO Desk', time: '3 hr ago',
    body: [
      'A logistics-technology platform has filed draft papers with market regulators for an initial public offering worth approximately ₹2,400 crore, comprising a fresh issue and an offer for sale by existing shareholders.',
      'The company, which provides supply-chain software to mid-market manufacturers, has grown revenue at a compounded rate of over 40% over the past three years, though it remains lossmaking on an adjusted basis.',
      'Proceeds from the fresh issue are earmarked for technology investment, working capital, and inorganic growth opportunities.',
    ],
    stats: [{ label: 'Issue size', value: '₹2,400 Cr' }, { label: 'Type', value: 'Fresh + OFS' }, { label: 'Revenue CAGR', value: '40%+' }],
  },
  {
    id: 6, cat: 'markets', tagLabel: 'Markets',
    title: 'Auto stocks rally on strong monthly dispatch numbers',
    blurb: 'Two-wheeler makers led gains as rural demand showed signs of a durable recovery heading into festive season.',
    img: 'https://images.unsplash.com/photo-1502877338535-766e1452684a?q=80&w=800&auto=format&fit=crop',
    source: 'Sector Watch', time: '4 hr ago',
    body: [
      'Automobile manufacturers posted robust wholesale dispatch numbers for the month, with two-wheeler makers leading the rally on the back of a sustained recovery in rural demand.',
      'Passenger vehicle makers also reported healthy growth, aided by a strong order book for recently launched SUV models. Commercial vehicle sales remained comparatively muted amid soft infrastructure spending.',
      'Analysts at several brokerages upgraded earnings estimates for the sector citing improving margin trends on softer input costs.',
    ],
    stats: [{ label: '2W growth', value: '+18% YoY' }, { label: 'PV growth', value: '+9% YoY' }, { label: 'CV growth', value: '+2% YoY' }],
  },
  {
    id: 7, cat: 'macro', tagLabel: 'Macro',
    title: 'Core sector output growth slows to four-month low',
    blurb: 'A slowdown in coal and cement output weighed on the index, even as steel and electricity stayed resilient.',
    img: 'https://images.unsplash.com/photo-1496307653780-42ee777d4833?q=80&w=800&auto=format&fit=crop',
    source: 'Macro Desk', time: '5 hr ago',
    body: [
      'Growth in India\'s eight core infrastructure sectors slowed to a four-month low, dragged down by weaker output in coal and cement even as steel and electricity generation held up.',
      'The core sector data, which feeds into the broader index of industrial production, suggests some moderation in momentum after a strong start to the fiscal year.',
      'Economists expect the slowdown to be temporary, attributing part of the weakness to seasonal factors and an early onset of monsoon disruptions in key mining regions.',
    ],
    stats: [{ label: 'Core growth', value: '3.1% YoY' }, { label: 'Weak spot', value: 'Coal, Cement' }, { label: 'Strong spot', value: 'Steel, Power' }],
  },
  {
    id: 8, cat: 'global', tagLabel: 'Global',
    title: 'Crude prices ease as supply concerns ebb after ceasefire talks',
    blurb: 'Brent crude fell over a percent in early trade as geopolitical risk premium continued to unwind.',
    img: 'https://images.unsplash.com/photo-1605101100539-3473f53dbd72?q=80&w=800&auto=format&fit=crop',
    source: 'Commodities Desk', time: '6 hr ago',
    body: [
      'Crude oil prices eased in early trade as the geopolitical risk premium continued to unwind following reports of progress in ceasefire negotiations in a key producing region.',
      'Brent crude futures slipped over a percent, while US benchmark WTI saw a similar move, as traders reassessed supply disruption risks that had pushed prices higher earlier in the month.',
      'Lower crude prices, if sustained, would be a tailwind for India\'s import bill and could ease pressure on downstream inflation in the coming months.',
    ],
    stats: [{ label: 'Brent', value: '-1.3%' }, { label: 'WTI', value: '-1.1%' }, { label: 'INR impact', value: 'Mildly positive' }],
  },
];

const ALL_STOCKS: StockInfo[] = [
  { sym: 'RELIANCE', name: 'Reliance Industries', price: 2945.6, chg: 1.2 },
  { sym: 'TCS', name: 'Tata Consultancy Services', price: 3812.1, chg: -0.8 },
  { sym: 'HDFCBANK', name: 'HDFC Bank', price: 1654.3, chg: -1.4 },
  { sym: 'INFY', name: 'Infosys', price: 1498.9, chg: -1.9 },
  { sym: 'ICICIBANK', name: 'ICICI Bank', price: 1212.5, chg: 0.6 },
  { sym: 'TATASTEEL', name: 'Tata Steel', price: 168.4, chg: 2.3 },
  { sym: 'ADANIENT', name: 'Adani Enterprises', price: 3105.0, chg: 3.1 },
  { sym: 'ITC', name: 'ITC Ltd', price: 432.8, chg: 0.3 },
  { sym: 'BAJFINANCE', name: 'Bajaj Finance', price: 7142.0, chg: -0.5 },
  { sym: 'SUNPHARMA', name: 'Sun Pharma', price: 1789.2, chg: 1.0 },
  { sym: 'MARUTI', name: 'Maruti Suzuki', price: 12480.0, chg: 1.8 },
  { sym: 'WIPRO', name: 'Wipro', price: 268.5, chg: -2.1 },
  { sym: 'AAPL', name: 'Apple Inc.', price: 189.3, chg: 0.4 },
  { sym: 'NVDA', name: 'NVIDIA Corp.', price: 875.4, chg: 2.8 },
  { sym: 'TSLA', name: 'Tesla Inc.', price: 243.7, chg: -1.2 },
  { sym: 'MSFT', name: 'Microsoft Corp.', price: 420.5, chg: 0.7 },
  { sym: 'GOOGL', name: 'Alphabet Inc.', price: 172.8, chg: 0.3 },
];

// Isolate mock data fetchers so swapping for real API is a one-line change inside each function
export function getMockIndices(): IndexTick[] {
  return MOCK_INDICES;
}

export function getMockStockPrice(symbol: string): StockInfo | undefined {
  // TODO: Replace with real market data API call (e.g. Yahoo Finance, Alpha Vantage)
  return ALL_STOCKS.find(s => s.sym === symbol.toUpperCase());
}

export function getNewsArticles(category?: string): NewsArticle[] {
  if (!category || category === 'all') return MOCK_ARTICLES;
  return MOCK_ARTICLES.filter(a => a.cat === category);
}

export function getAllStocks(): StockInfo[] {
  return ALL_STOCKS;
}

// TanStack Query hooks — swap mock for real fetch inside the query function only
export function useIndices() {
  return useQuery({
    queryKey: ['sight-indices'],
    queryFn: () => getMockIndices(),
    staleTime: 30_000,
  });
}

export function useNewsArticles(category?: string) {
  return useQuery({
    queryKey: ['sight-articles', category],
    queryFn: () => getNewsArticles(category),
    staleTime: 60_000,
  });
}

export function useWatchlistPrices(symbols: string[]) {
  return useQuery({
    queryKey: ['sight-watchlist-prices', symbols.join(',')],
    queryFn: () => symbols.map(sym => getMockStockPrice(sym)).filter(Boolean) as StockInfo[],
    staleTime: 120_000,
    enabled: symbols.length > 0,
  });
}
