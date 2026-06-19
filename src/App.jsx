import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Plus, X, TrendingUp, ChevronLeft, Trash2, Pencil } from "lucide-react";
import { getQuote, getQuotes, CRYPTO_SYMBOLS, tokenIcon } from "./api.js";

const TX_KEY = "fintrack_transactions";
const OLD_KEY = "fintrack_positions"; // migrate from old format

function loadTransactions() {
  // migrate old positions[] format → transactions[]
  const txs = JSON.parse(localStorage.getItem(TX_KEY) || "[]");
  if (txs.length > 0) return txs;
  const old = JSON.parse(localStorage.getItem(OLD_KEY) || "[]");
  if (old.length > 0) {
    const migrated = old.map((p) => ({
      id: crypto.randomUUID(),
      symbol: p.symbol,
      qty: p.qty,
      price: p.entryPrice,
      ts: p.addedAt || Date.now(),
    }));
    localStorage.setItem(TX_KEY, JSON.stringify(migrated));
    return migrated;
  }
  return [];
}

function saveTransactions(txs) {
  localStorage.setItem(TX_KEY, JSON.stringify(txs));
}

// --- formatting ---
function fmt(n, decimals = 2) {
  if (n == null || isNaN(n)) return "—";
  if (Math.abs(n) < 0.01) return n.toFixed(6);
  if (Math.abs(n) < 1) return n.toFixed(4);
  return n.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function fmtUsd(n) {
  if (n == null || isNaN(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `$${(n / 1e3).toFixed(2)}K`;
  return `$${fmt(n)}`;
}

function fmtDate(ts) {
  return new Date(ts).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "2-digit",
  });
}

// convert a timestamp (ms) <-> the value format of <input type="datetime-local">
function toLocalInput(ts) {
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function fromLocalInput(val) {
  const ts = new Date(val).getTime();
  return isNaN(ts) ? null : ts;
}

function labelFromSymbol(sym) {
  const found = CRYPTO_SYMBOLS.find((c) => c.symbol === sym);
  if (found) return found.label;
  const m = sym.match(/:([A-Z]+)(USDT|USD|BTC|ETH)/);
  return m ? m[1] : sym;
}

// --- core: compute positions from transactions ---
function computePosition(symbol, txs) {
  const lots = txs
    .filter((t) => t.symbol === symbol)
    .sort((a, b) => a.ts - b.ts);

  let cumQty = 0;
  let cumCost = 0;
  // running cost basis after each lot — for the sparkline
  const basisHistory = lots.map((lot) => {
    cumQty += lot.qty;
    cumCost += lot.qty * lot.price;
    return {
      ...lot,
      cumQty,
      cumCost,
      avgCost: cumQty > 0 ? cumCost / cumQty : 0,
    };
  });

  return {
    symbol,
    label: labelFromSymbol(symbol),
    lots: basisHistory,
    qty: cumQty,
    totalCost: cumCost,
    avgCost: cumQty > 0 ? cumCost / cumQty : 0,
    lotCount: lots.length,
  };
}

export default function App() {
  const [txs, setTxs] = useState(loadTransactions);
  const [quotes, setQuotes] = useState({});
  const [showAdd, setShowAdd] = useState(false);
  const [detailSymbol, setDetailSymbol] = useState(null);
  const [editLot, setEditLot] = useState(null);

  useEffect(() => saveTransactions(txs), [txs]);

  // --- positions derived from transactions ---
  const symbols = useMemo(() => [...new Set(txs.map((t) => t.symbol))], [txs]);

  const positions = useMemo(
    () =>
      symbols
        .map((s) => computePosition(s, txs))
        .sort((a, b) => b.totalCost - a.totalCost),
    [symbols, txs],
  );

  const refreshQuotes = useCallback(async () => {
    if (symbols.length === 0) return;
    const data = await getQuotes(symbols);
    setQuotes(data);
  }, [symbols]);

  useEffect(() => {
    refreshQuotes();
    const interval = setInterval(refreshQuotes, 30000);
    return () => clearInterval(interval);
  }, [refreshQuotes]);

  // --- enrich positions with live marks ---
  const enriched = positions.map((p) => {
    const q = quotes[p.symbol];
    const price = q?.price ?? null;
    const value = price != null ? price * p.qty : null;
    const pnl = value != null ? value - p.totalCost : null;
    const pnlPct =
      p.totalCost > 0 && pnl != null ? (pnl / p.totalCost) * 100 : null;
    const dayChange =
      value != null && q?.changePct != null
        ? (value * q.changePct) / 100
        : null;
    return { ...p, price, value, pnl, pnlPct, dayChange };
  });

  const totalValue = enriched.reduce((s, p) => s + (p.value ?? 0), 0);
  const totalCost = enriched.reduce((s, p) => s + p.totalCost, 0);
  const totalPnl = totalValue - totalCost;
  const totalPnlPct = totalCost > 0 ? (totalPnl / totalCost) * 100 : 0;
  const totalDay = enriched.reduce((s, p) => s + (p.dayChange ?? 0), 0);

  const addLot = (symbol, qty, price) => {
    setTxs((prev) => [
      ...prev,
      { id: crypto.randomUUID(), symbol, qty, price, ts: Date.now() },
    ]);
  };

  const removeLot = (lotId) => {
    setTxs((prev) => prev.filter((t) => t.id !== lotId));
  };

  const updateLot = (lotId, updates) => {
    setTxs((prev) =>
      prev.map((t) => (t.id === lotId ? { ...t, ...updates } : t)),
    );
  };

  // --- render ---
  if (detailSymbol) {
    return (
      <>
        <PositionDetail
          symbol={detailSymbol}
          txs={txs}
          quote={quotes[detailSymbol]}
          onBack={() => setDetailSymbol(null)}
          onRemoveLot={removeLot}
          onEditLot={(lot) => setEditLot(lot)}
          onAddLot={() => {
            setDetailSymbol(null);
            setShowAdd(true);
          }}
        />
        {editLot && (
          <EditLotSheet
            lot={editLot}
            onClose={() => setEditLot(null)}
            onSave={(lotId, updates) => {
              updateLot(lotId, updates);
              setEditLot(null);
            }}
          />
        )}
      </>
    );
  }

  return (
    <div>
      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "24px",
        }}
      >
        <h1
          style={{
            fontSize: "22px",
            fontWeight: 600,
            letterSpacing: "-0.02em",
          }}
        >
          Fintrack
        </h1>
        <button
          onClick={() => setShowAdd(true)}
          style={{ ...btnIcon, background: "var(--lime-dim)" }}
          aria-label="Add"
        >
          <Plus size={18} color="var(--lime)" />
        </button>
      </div>
      {/* Portfolio summary */}
      {enriched.length > 0 && (
        <div style={card}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "flex-end",
              marginBottom: "12px",
            }}
          >
            <div>
              <div style={{ fontSize: "13px", color: "var(--text-dim)" }}>
                Portfolio Value
              </div>
              <div
                style={{
                  fontSize: "32px",
                  fontWeight: 700,
                  letterSpacing: "-0.03em",
                }}
              >
                {fmtUsd(totalValue)}
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: "13px", color: "var(--text-dim)" }}>
                Today
              </div>
              <div
                style={{
                  fontSize: "16px",
                  fontWeight: 600,
                  color: totalDay >= 0 ? "var(--lime)" : "var(--red)",
                }}
              >
                {totalDay >= 0 ? "+" : ""}
                {fmtUsd(totalDay)}
              </div>
            </div>
          </div>
          <div style={{ display: "flex", gap: "16px" }}>
            <div
              style={{
                fontSize: "14px",
                color: totalPnl >= 0 ? "var(--lime)" : "var(--red)",
              }}
            >
              {totalPnl >= 0 ? "+" : ""}
              {fmtUsd(totalPnl)} ({totalPnlPct >= 0 ? "+" : ""}
              {fmt(totalPnlPct)}%)
            </div>
            <div style={{ fontSize: "14px", color: "var(--text-dim)" }}>
              Cost: {fmtUsd(totalCost)}
            </div>
          </div>
        </div>
      )}
      {/* Positions */}
      <div style={{ marginTop: "16px" }}>
        {enriched.length === 0 && (
          <div style={{ ...card, textAlign: "center", padding: "48px 24px" }}>
            <div style={{ fontSize: "40px", marginBottom: "12px" }}>📊</div>
            <div
              style={{ fontSize: "16px", fontWeight: 500, marginBottom: "4px" }}
            >
              No positions yet
            </div>
            <div style={{ fontSize: "14px", color: "var(--text-dim)" }}>
              Tap + to add your first buy
            </div>
          </div>
        )}

        {enriched.map((p) => (
          <PositionCard
            key={p.symbol}
            pos={p}
            onClick={() => setDetailSymbol(p.symbol)}
          />
        ))}
      </div>
      {showAdd && (
        <AddSheet
          onClose={() => setShowAdd(false)}
          onSave={(sym, qty, price) => {
            addLot(sym, qty, price);
            setShowAdd(false);
          }}
          preselect={null}
        />
      )}
      {editLot && (
        <EditLotSheet
          lot={editLot}
          onClose={() => setEditLot(null)}
          onSave={(lotId, updates) => {
            updateLot(lotId, updates);
            setEditLot(null);
          }}
        />
      )}
    </div>
  );
}

// --- Position Card (taps open detail) ---
function PositionCard({ pos, onClick }) {
  const {
    label,
    qty,
    avgCost,
    lotCount,
    price,
    value,
    pnl,
    pnlPct,
    dayChange,
  } = pos;
  const isUp = (pnl ?? 0) >= 0;
  const dayUp = (dayChange ?? 0) >= 0;

  return (
    <div
      style={{
        ...card,
        marginBottom: "8px",
        padding: "14px 16px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        cursor: "pointer",
      }}
      onClick={onClick}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "12px",
          minWidth: 0,
        }}
      >
        <div
          style={{
            width: "36px",
            height: "36px",
            borderRadius: "50%",
            background: "var(--lime-dim)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "13px",
            fontWeight: 700,
            color: "var(--lime)",
            flexShrink: 0,
          }}
        >
          {label.slice(0, 4)}
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <span style={{ fontSize: "15px", fontWeight: 600 }}>{label}</span>
            {lotCount > 1 && (
              <span
                style={{
                  fontSize: "11px",
                  color: "var(--text-dim)",
                  background: "var(--card)",
                  padding: "1px 6px",
                  borderRadius: "6px",
                }}
              >
                {lotCount} lots
              </span>
            )}
          </div>
          <div style={{ fontSize: "12px", color: "var(--text-dim)" }}>
            {fmt(qty, 6)} @ avg ${fmt(avgCost)}
          </div>
        </div>
      </div>
      <div style={{ textAlign: "right" }}>
        <div style={{ fontSize: "15px", fontWeight: 600 }}>
          {price != null ? fmtUsd(value) : "—"}
        </div>
        <div
          style={{
            display: "flex",
            gap: "6px",
            justifyContent: "flex-end",
            alignItems: "center",
          }}
        >
          {dayChange != null && (
            <span
              style={{
                fontSize: "12px",
                color: dayUp ? "var(--lime)" : "var(--red)",
              }}
            >
              {dayUp ? "+" : ""}
              {fmtUsd(dayChange)}
            </span>
          )}
          <span
            style={{
              fontSize: "12px",
              fontWeight: 600,
              color: isUp ? "var(--lime)" : "var(--red)",
            }}
          >
            {pnl != null
              ? `${isUp ? "+" : ""}${fmtUsd(pnl)} (${pnlPct >= 0 ? "+" : ""}${fmt(pnlPct)}%)`
              : ""}
          </span>
        </div>
      </div>
    </div>
  );
}

// --- Position Detail (lot-by-lot history + cost basis chart) ---
function PositionDetail({
  symbol,
  txs,
  quote,
  onBack,
  onRemoveLot,
  onEditLot,
  onAddLot,
}) {
  const pos = computePosition(symbol, txs);
  const price = quote?.price ?? null;
  const value = price != null ? price * pos.qty : null;
  const pnl = value != null ? value - pos.totalCost : null;
  const pnlPct =
    pos.totalCost > 0 && pnl != null ? (pnl / pos.totalCost) * 100 : null;
  const label = pos.label;

  return (
    <div>
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "12px",
          marginBottom: "24px",
        }}
      >
        <button onClick={onBack} style={btnIcon}>
          <ChevronLeft size={18} color="var(--text)" />
        </button>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <div
            style={{
              width: "32px",
              height: "32px",
              borderRadius: "50%",
              background: "var(--lime-dim)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "12px",
              fontWeight: 700,
              color: "var(--lime)",
            }}
          >
            {label.slice(0, 4)}
          </div>
          <h1 style={{ fontSize: "20px", fontWeight: 600 }}>{label}</h1>
        </div>
      </div>

      {/* Summary card */}
      <div style={card}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-end",
            marginBottom: "12px",
          }}
        >
          <div>
            <div style={{ fontSize: "13px", color: "var(--text-dim)" }}>
              Value
            </div>
            <div
              style={{
                fontSize: "28px",
                fontWeight: 700,
                letterSpacing: "-0.03em",
              }}
            >
              {price != null ? fmtUsd(value) : "—"}
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: "13px", color: "var(--text-dim)" }}>
              Current Price
            </div>
            <div style={{ fontSize: "18px", fontWeight: 600 }}>
              {price != null ? `$${fmt(price)}` : "—"}
            </div>
          </div>
        </div>
        <div style={{ display: "flex", gap: "16px", flexWrap: "wrap" }}>
          <Metric label="Total Cost" value={fmtUsd(pos.totalCost)} />
          <Metric label="Avg Cost" value={`$${fmt(pos.avgCost)}`} />
          <Metric
            label="P&L"
            value={`${pnl >= 0 ? "+" : ""}${fmtUsd(pnl)}`}
            color={pnl >= 0 ? "var(--lime)" : "var(--red)"}
          />
          <Metric
            label="Return"
            value={`${pnlPct >= 0 ? "+" : ""}${fmt(pnlPct)}%`}
            color={pnl >= 0 ? "var(--lime)" : "var(--red)"}
          />
        </div>
      </div>

      {/* Cost basis evolution sparkline */}
      {pos.lots.length > 1 && (
        <div style={{ ...card, marginTop: "12px", padding: "16px" }}>
          <div
            style={{
              fontSize: "13px",
              color: "var(--text-dim)",
              marginBottom: "8px",
            }}
          >
            Cost Basis Over Time
          </div>
          <BasisChart lots={pos.lots} currentPrice={price} />
        </div>
      )}

      {/* Lot history */}
      <div style={{ marginTop: "16px" }}>
        <div
          style={{
            fontSize: "13px",
            color: "var(--text-dim)",
            marginBottom: "8px",
            paddingLeft: "4px",
          }}
        >
          {pos.lots.length} {pos.lots.length === 1 ? "lot" : "lots"}
        </div>
        {pos.lots.map((lot, i) => {
          const lotValue = price != null ? price * lot.qty : null;
          const lotPnl =
            lotValue != null ? lotValue - lot.qty * lot.price : null;
          return (
            <div
              key={lot.id}
              style={{
                ...card,
                marginBottom: "6px",
                padding: "12px 14px",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div
                  style={{ display: "flex", gap: "8px", alignItems: "center" }}
                >
                  <span
                    style={{
                      fontSize: "11px",
                      color: "var(--text-dim)",
                      width: "16px",
                    }}
                  >
                    #{i + 1}
                  </span>
                  <span style={{ fontSize: "14px", fontWeight: 600 }}>
                    {fmt(lot.qty, 6)}
                  </span>
                  <span style={{ fontSize: "12px", color: "var(--text-dim)" }}>
                    @ ${fmt(lot.price)}
                  </span>
                </div>
                <div
                  style={{
                    fontSize: "11px",
                    color: "var(--text-dim)",
                    paddingLeft: "24px",
                    marginTop: "2px",
                  }}
                >
                  {fmtDate(lot.ts)} · avg basis ${fmt(lot.avgCost)} after
                </div>
              </div>
              <div
                style={{ display: "flex", alignItems: "center", gap: "10px" }}
              >
                <div style={{ textAlign: "right" }}>
                  {lotValue != null && (
                    <>
                      <div
                        style={{
                          fontSize: "13px",
                          fontWeight: 600,
                          color: lotPnl >= 0 ? "var(--lime)" : "var(--red)",
                        }}
                      >
                        {lotPnl >= 0 ? "+" : ""}
                        {fmtUsd(lotPnl)}
                      </div>
                    </>
                  )}
                </div>
                <button
                  onClick={() => onEditLot(lot)}
                  aria-label="Edit lot"
                  style={{
                    ...btnIcon,
                    width: "28px",
                    height: "28px",
                    opacity: 0.5,
                  }}
                >
                  <Pencil size={13} color="var(--text-dim)" />
                </button>
                <button
                  onClick={() => onRemoveLot(lot.id)}
                  style={{
                    ...btnIcon,
                    width: "28px",
                    height: "28px",
                    opacity: 0.5,
                  }}
                >
                  <Trash2 size={14} color="var(--red)" />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Add more */}
      <button
        onClick={onAddLot}
        style={{
          width: "100%",
          marginTop: "12px",
          padding: "14px",
          borderRadius: "12px",
          background: "var(--lime-dim)",
          border: "1px solid var(--lime)",
          color: "var(--lime)",
          fontSize: "15px",
          fontWeight: 600,
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: "6px",
        }}
      >
        <Plus size={18} /> Add to {label}
      </button>
    </div>
  );
}

// --- Token Icon (CMC CDN, with fallback to initials) ---
function TokenIcon({ symbol, size = 24 }) {
  const [err, setErr] = useState(false);
  const src = tokenIcon(symbol, 64);
  const label = labelFromSymbol(symbol);
  if (!src || err) {
    return (
      <div
        style={{
          width: size,
          height: size,
          borderRadius: "50%",
          background: "var(--lime-dim)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: size * 0.4,
          fontWeight: 700,
          color: "var(--lime)",
          flexShrink: 0,
        }}
      >
        {label.slice(0, 4)}
      </div>
    );
  }
  return (
    <img
      src={src}
      alt={label}
      width={size}
      height={size}
      onError={() => setErr(true)}
      style={{ borderRadius: "50%", flexShrink: 0, display: "block" }}
    />
  );
}

function Metric({ label, value, color }) {
  return (
    <div>
      <div style={{ fontSize: "11px", color: "var(--text-dim)" }}>{label}</div>
      <div
        style={{
          fontSize: "15px",
          fontWeight: 600,
          color: color || "var(--text)",
        }}
      >
        {value}
      </div>
    </div>
  );
}

// --- Cost Basis Sparkline (SVG) ---
function BasisChart({ lots, currentPrice }) {
  const width = 300;
  const height = 80;
  const pad = 8;

  const points = lots.map((l) => ({ x: l.ts, y: l.avgCost }));
  if (currentPrice != null) {
    points.push({ x: Date.now(), y: currentPrice, isPrice: true });
  }

  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const rangeX = maxX - minX || 1;
  const rangeY = maxY - minY || 1;

  const sx = (x) => pad + ((x - minX) / rangeX) * (width - pad * 2);
  const sy = (y) => height - pad - ((y - minY) / rangeY) * (height - pad * 2);

  const pathD = points
    .map(
      (p, i) =>
        `${i === 0 ? "M" : "L"} ${sx(p.x).toFixed(1)} ${sy(p.y).toFixed(1)}`,
    )
    .join(" ");
  const areaD = `${pathD} L ${sx(points[points.length - 1].x).toFixed(1)} ${height - pad} L ${sx(points[0].x).toFixed(1)} ${height - pad} Z`;

  return (
    <svg
      width="100%"
      viewBox={`0 0 ${width} ${height}`}
      style={{ display: "block" }}
    >
      <defs>
        <linearGradient id="basisGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--lime)" stopOpacity="0.2" />
          <stop offset="100%" stopColor="var(--lime)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaD} fill="url(#basisGrad)" />
      <path
        d={pathD}
        fill="none"
        stroke="var(--lime)"
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {points.map((p, i) => (
        <circle
          key={i}
          cx={sx(p.x)}
          cy={sy(p.y)}
          r={p.isPrice ? 4 : 2.5}
          fill={p.isPrice ? "var(--text)" : "var(--lime)"}
          stroke="var(--bg)"
          strokeWidth="1"
        />
      ))}
      {/* labels */}
      <text x={pad} y={height - 2} fontSize="9" fill="var(--text-dim)">
        ${fmt(minY)}
      </text>
      <text
        x={width - pad}
        y={12}
        fontSize="9"
        fill="var(--text-dim)"
        textAnchor="end"
      >
        ${fmt(maxY)}
      </text>
    </svg>
  );
}

// --- Add Sheet (always creates a new lot) ---
function AddSheet({ onClose, onSave, preselect }) {
  const [symbol, setSymbol] = useState(preselect || "");
  const [qty, setQty] = useState("");
  const [price, setPrice] = useState("");
  const [search, setSearch] = useState("");
  const [priceLoading, setPriceLoading] = useState(false);
  const [livePrice, setLivePrice] = useState(null);
  const priceDirty = useRef(false);

  // Auto-fill price with live quote when symbol is selected
  useEffect(() => {
    if (!symbol || priceDirty.current) return;
    let cancelled = false;
    setPriceLoading(true);
    getQuote(symbol)
      .then((q) => {
        if (cancelled || priceDirty.current) return;
        if (q?.price != null) {
          setLivePrice(q.price);
          setPrice(String(q.price));
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setPriceLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [symbol]);

  // Reset dirty flag when symbol changes
  useEffect(() => {
    priceDirty.current = false;
    setLivePrice(null);
  }, [symbol]);

  const handlePriceChange = (e) => {
    priceDirty.current = true;
    setPrice(e.target.value);
  };

  const filtered = CRYPTO_SYMBOLS.filter(
    (c) =>
      c.label.toLowerCase().includes(search.toLowerCase()) ||
      c.name.toLowerCase().includes(search.toLowerCase()),
  );

  const handleSave = () => {
    const q = parseFloat(qty);
    const p = parseFloat(price);
    if (!symbol || !q || !p || q <= 0 || p <= 0) return;
    onSave(symbol, q, p);
  };

  const canSave = symbol && parseFloat(qty) > 0 && parseFloat(price) > 0;

  return (
    <>
      <div
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.5)",
          zIndex: 100,
          animation: "fadeIn 0.2s",
        }}
      />
      <div
        style={{
          position: "fixed",
          bottom: 0,
          left: "50%",
          transform: "translateX(-50%)",
          width: "100%",
          maxWidth: "560px",
          background: "var(--bg)",
          borderRadius: "20px 20px 0 0",
          padding: "20px 20px 36px",
          zIndex: 101,
          maxHeight: "80vh",
          overflowY: "auto",
          boxShadow: "0 -8px 32px rgba(0,0,0,0.4)",
          animation: "slideUp 0.25s ease",
        }}
      >
        <style>{`
          @keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }
          @keyframes slideUp { from { transform: translate(-50%, 100%) } to { transform: translate(-50%, 0) } }
        `}</style>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "20px",
          }}
        >
          <h2 style={{ fontSize: "18px", fontWeight: 600 }}>Add Buy</h2>
          <button onClick={onClose} style={btnIcon}>
            <X size={18} color="var(--text-dim)" />
          </button>
        </div>

        {!preselect && (
          <>
            <input
              type="text"
              placeholder="Search..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ ...input, marginBottom: "8px" }}
            />
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(100px, 1fr))",
                gap: "8px",
                maxHeight: "200px",
                overflowY: "auto",
                marginBottom: "16px",
              }}
            >
              {filtered.map((c) => (
                <button
                  key={c.symbol}
                  onClick={() => setSymbol(c.symbol)}
                  style={{
                    padding: "10px 12px",
                    borderRadius: "12px",
                    textAlign: "left",
                    background:
                      symbol === c.symbol ? "var(--lime-dim)" : "var(--card)",
                    border:
                      symbol === c.symbol
                        ? "1px solid var(--lime)"
                        : "1px solid var(--card-border)",
                    color: "var(--text)",
                    cursor: "pointer",
                    transition: "all 0.15s",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <TokenIcon symbol={c.symbol} size={20} />
                    <div>
                      <div style={{ fontSize: "14px", fontWeight: 600 }}>
                        {c.label}
                      </div>
                      <div style={{ fontSize: "11px", color: "var(--text-dim)" }}>
                        {c.name}
                      </div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </>
        )}

        {preselect && (
          <div style={{ ...card, padding: "12px 14px", marginBottom: "16px", display: "flex", alignItems: "center", gap: "10px" }}>
            <TokenIcon symbol={symbol} size={28} />
            <span style={{ fontSize: "16px", fontWeight: 600 }}>
              {labelFromSymbol(symbol)}
            </span>
          </div>
        )}

        <div style={{ marginBottom: "12px" }}>
          <input
            type="number"
            inputMode="decimal"
            placeholder="Quantity"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            style={input}
          />
        </div>
        <div style={{ marginBottom: "20px" }}>
          {priceLoading && (
            <div
              style={{
                fontSize: "11px",
                color: "var(--lime)",
                marginBottom: "6px",
                paddingLeft: "4px",
              }}
            >
              ↻ fetching live price...
            </div>
          )}
          {!priceLoading && livePrice != null && (
            <div
              style={{
                fontSize: "11px",
                color: "var(--text-dim)",
                marginBottom: "6px",
                paddingLeft: "4px",
              }}
            >
              ● live: ${fmt(livePrice)}
            </div>
          )}
          <input
            type="number"
            inputMode="decimal"
            placeholder="Buy price (USD)"
            value={price}
            onChange={handlePriceChange}
            style={input}
          />
        </div>

        <button
          onClick={handleSave}
          disabled={!canSave}
          style={{
            width: "100%",
            padding: "14px",
            borderRadius: "12px",
            background: "var(--lime-dim)",
            border: "1px solid var(--lime)",
            color: "var(--lime)",
            fontSize: "15px",
            fontWeight: 600,
            cursor: "pointer",
            opacity: canSave ? 1 : 0.4,
          }}
        >
          Add Buy
        </button>
      </div>
    </>
  );
}

// --- Edit Lot Sheet (modify an existing buy's qty / price / date) ---
function EditLotSheet({ lot, onClose, onSave }) {
  const label = labelFromSymbol(lot.symbol);
  const [qty, setQty] = useState(String(lot.qty));
  const [price, setPrice] = useState(String(lot.price));
  const [date, setDate] = useState(toLocalInput(lot.ts));

  const handleSave = () => {
    const q = parseFloat(qty);
    const p = parseFloat(price);
    const ts = fromLocalInput(date);
    if (!q || !p || q <= 0 || p <= 0 || ts == null) return;
    onSave(lot.id, { qty: q, price: p, ts });
  };

  const canSave =
    parseFloat(qty) > 0 &&
    parseFloat(price) > 0 &&
    fromLocalInput(date) != null;

  return (
    <>
      <div
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.5)",
          zIndex: 100,
          animation: "fadeIn 0.2s",
        }}
      />
      <div
        style={{
          position: "fixed",
          bottom: 0,
          left: "50%",
          transform: "translateX(-50%)",
          width: "100%",
          maxWidth: "560px",
          background: "var(--bg)",
          borderRadius: "20px 20px 0 0",
          padding: "20px 20px 36px",
          zIndex: 101,
          maxHeight: "80vh",
          overflowY: "auto",
          boxShadow: "0 -8px 32px rgba(0,0,0,0.4)",
          animation: "slideUp 0.25s ease",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "20px",
          }}
        >
          <h2 style={{ fontSize: "18px", fontWeight: 600 }}>Edit Lot</h2>
          <button onClick={onClose} style={btnIcon}>
            <X size={18} color="var(--text-dim)" />
          </button>
        </div>

        <div
          style={{
            ...card,
            padding: "12px 14px",
            marginBottom: "16px",
          }}
        >
          <span style={{ fontSize: "16px", fontWeight: 600 }}>{label}</span>
        </div>

        <div style={{ marginBottom: "12px" }}>
          <input
            type="number"
            inputMode="decimal"
            placeholder="Quantity"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            style={input}
          />
        </div>
        <div style={{ marginBottom: "12px" }}>
          <input
            type="number"
            inputMode="decimal"
            placeholder="Buy price (USD)"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            style={input}
          />
        </div>
        <div style={{ marginBottom: "20px" }}>
          <input
            type="datetime-local"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            style={input}
          />
        </div>

        <button
          onClick={handleSave}
          disabled={!canSave}
          style={{
            width: "100%",
            padding: "14px",
            borderRadius: "12px",
            background: "var(--lime-dim)",
            border: "1px solid var(--lime)",
            color: "var(--lime)",
            fontSize: "15px",
            fontWeight: 600,
            cursor: "pointer",
            opacity: canSave ? 1 : 0.4,
          }}
        >
          Save Changes
        </button>
      </div>
    </>
  );
}

const card = {
  background: "var(--card)",
  border: "1px solid var(--card-border)",
  borderRadius: "var(--radius)",
  backdropFilter: "blur(12px)",
};

const btnIcon = {
  width: "36px",
  height: "36px",
  borderRadius: "10px",
  border: "1px solid var(--card-border)",
  background: "var(--card)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "pointer",
  color: "var(--text)",
  flexShrink: 0,
};

const input = {
  width: "100%",
  padding: "14px 16px",
  borderRadius: "12px",
  background: "var(--card)",
  border: "1px solid var(--card-border)",
  color: "var(--text)",
  fontSize: "16px",
  outline: "none",
  fontFamily: "inherit",
};
