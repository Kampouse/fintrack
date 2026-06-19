const FINNHUB_KEY = "REDACTED";
const BASE = "https://finnhub.io/api/v1";

export async function getQuote(symbol) {
  const res = await fetch(`${BASE}/quote?symbol=${encodeURIComponent(symbol)}&token=${FINNHUB_KEY}`);
  if (!res.ok) throw new Error(`Quote failed: ${res.status}`);
  const d = await res.json();
  return {
    price: d.c,
    change: d.d,
    changePct: d.dp,
    high: d.h,
    low: d.l,
    open: d.o,
    prevClose: d.pc,
    ts: d.t,
  };
}

export async function getQuotes(symbols) {
  // serial to respect 60/min limit
  const results = {};
  for (const sym of symbols) {
    try {
      results[sym] = await getQuote(sym);
    } catch (e) {
      results[sym] = null;
    }
  }
  return results;
}

// Common crypto symbols on Binance
// cmcId = CoinMarketCap coin ID for token icons (CMC CDN)
export const CRYPTO_SYMBOLS = [
  { symbol: "BINANCE:BTCUSDT", label: "BTC", name: "Bitcoin", cmcId: 1 },
  { symbol: "BINANCE:ETHUSDT", label: "ETH", name: "Ethereum", cmcId: 1027 },
  { symbol: "BINANCE:SOLUSDT", label: "SOL", name: "Solana", cmcId: 5426 },
  { symbol: "BINANCE:NEARUSDT", label: "NEAR", name: "NEAR Protocol", cmcId: 4256 },
  { symbol: "BINANCE:BNBUSDT", label: "BNB", name: "BNB", cmcId: 1839 },
  { symbol: "BINANCE:XRPUSDT", label: "XRP", name: "XRP", cmcId: 52 },
  { symbol: "BINANCE:ADAUSDT", label: "ADA", name: "Cardano", cmcId: 2010 },
  { symbol: "BINANCE:DOGEUSDT", label: "DOGE", name: "Dogecoin", cmcId: 74 },
  { symbol: "BINANCE:AVAXUSDT", label: "AVAX", name: "Avalanche", cmcId: 5805 },
  { symbol: "BINANCE:LINKUSDT", label: "LINK", name: "Chainlink", cmcId: 1975 },
  { symbol: "BINANCE:DOTUSDT", label: "DOT", name: "Polkadot", cmcId: 6636 },
  { symbol: "BINANCE:MATICUSDT", label: "MATIC", name: "Polygon", cmcId: 3890 },
  { symbol: "BINANCE:LTCUSDT", label: "LTC", name: "Litecoin", cmcId: 2 },
  { symbol: "BINANCE:UNIUSDT", label: "UNI", name: "Uniswap", cmcId: 7083 },
  { symbol: "BINANCE:ATOMUSDT", label: "ATOM", name: "Cosmos", cmcId: 3794 },
  { symbol: "BINANCE:APTUSDT", label: "APT", name: "Aptos", cmcId: 21714 },
  { symbol: "BINANCE:ARBUSDT", label: "ARB", name: "Arbitrum", cmcId: 11841 },
  { symbol: "BINANCE:OPUSDT", label: "OP", name: "Optimism", cmcId: 24178 },
  { symbol: "BINANCE:INJUSDT", label: "INJ", name: "Injective", cmcId: 20887 },
  { symbol: "BINANCE:SUIUSDT", label: "SUI", name: "Sui", cmcId: 20947 },
];

// Build CMC CDN icon URL for a symbol or cmcId
export function tokenIcon(symbolOrId, size = 64) {
  const id = typeof symbolOrId === "number" ? symbolOrId : CRYPTO_SYMBOLS.find((c) => c.symbol === symbolOrId)?.cmcId;
  if (!id) return null;
  return `https://s2.coinmarketcap.com/static/img/coins/${size}x${size}/${id}.png`;
}
