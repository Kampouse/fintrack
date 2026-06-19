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
export const CRYPTO_SYMBOLS = [
  { symbol: "BINANCE:BTCUSDT", label: "BTC", name: "Bitcoin" },
  { symbol: "BINANCE:ETHUSDT", label: "ETH", name: "Ethereum" },
  { symbol: "BINANCE:SOLUSDT", label: "SOL", name: "Solana" },
  { symbol: "BINANCE:NEARUSDT", label: "NEAR", name: "NEAR Protocol" },
  { symbol: "BINANCE:BNBUSDT", label: "BNB", name: "BNB" },
  { symbol: "BINANCE:XRPUSDT", label: "XRP", name: "XRP" },
  { symbol: "BINANCE:ADAUSDT", label: "ADA", name: "Cardano" },
  { symbol: "BINANCE:DOGEUSDT", label: "DOGE", name: "Dogecoin" },
  { symbol: "BINANCE:AVAXUSDT", label: "AVAX", name: "Avalanche" },
  { symbol: "BINANCE:LINKUSDT", label: "LINK", name: "Chainlink" },
  { symbol: "BINANCE:DOTUSDT", label: "DOT", name: "Polkadot" },
  { symbol: "BINANCE:MATICUSDT", label: "MATIC", name: "Polygon" },
  { symbol: "BINANCE:LTCUSDT", label: "LTC", name: "Litecoin" },
  { symbol: "BINANCE:UNIUSDT", label: "UNI", name: "Uniswap" },
  { symbol: "BINANCE:ATOMUSDT", label: "ATOM", name: "Cosmos" },
  { symbol: "BINANCE:APTUSDT", label: "APT", name: "Aptos" },
  { symbol: "BINANCE:ARBUSDT", label: "ARB", name: "Arbitrum" },
  { symbol: "BINANCE:OPUSDT", label: "OP", name: "Optimism" },
  { symbol: "BINANCE:INJUSDT", label: "INJ", name: "Injective" },
  { symbol: "BINANCE:SUIUSDT", label: "SUI", name: "Sui" },
];
