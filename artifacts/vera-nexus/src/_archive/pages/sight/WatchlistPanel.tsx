import { useState } from 'react';
import { useWatchlist } from '../../hooks/useWatchlist';
import { useWatchlistPrices, getAllStocks } from '../../lib/sight-data';

function sparklinePath(seed: number, w: number, h: number): { d: string; up: boolean } {
  let val = 50;
  const pts: number[] = [];
  let s = seed;
  const rand = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
  for (let i = 0; i < 14; i++) {
    val += (rand() - 0.48) * 14;
    val = Math.max(8, Math.min(92, val));
    pts.push(val);
  }
  const step = w / (pts.length - 1);
  const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${i * step} ${h - (p / 100 * h)}`).join(' ');
  return { d, up: pts[pts.length - 1] >= pts[0] };
}

function Sparkline({ seed, positive }: { seed: number; positive: boolean }) {
  const { d } = sparklinePath(seed, 60, 28);
  const color = positive ? 'var(--mint)' : 'var(--red)';
  return (
    <svg width="60" height="28" viewBox="0 0 60 28" className="flex-shrink-0">
      <path d={d} fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function WatchlistPanel() {
  const { symbols, addSymbol, removeSymbol, isFull, max } = useWatchlist();
  const { data: prices = [] } = useWatchlistPrices(symbols);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchInput, setSearchInput] = useState('');

  const allStocks = getAllStocks();
  const suggestions = searchInput.trim()
    ? allStocks.filter(s =>
        (s.sym.includes(searchInput.toUpperCase()) || s.name.toLowerCase().includes(searchInput.toLowerCase())) &&
        !symbols.includes(s.sym)
      ).slice(0, 6)
    : allStocks.filter(s => !symbols.includes(s.sym)).slice(0, 6);

  const handleAdd = (sym: string) => {
    addSymbol(sym);
    setSearchInput('');
    setSearchOpen(false);
  };

  return (
    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-[14px] overflow-hidden">
      <div className="flex items-center justify-between px-4 py-[15px] border-b border-[var(--border)]">
        <h4 className="font-syne text-[14px] font-bold flex items-center gap-[7px]">
          Watchlist
          <span className="text-[var(--dim)] font-mono font-medium text-[11px]">{symbols.length}/{max}</span>
        </h4>
        <button
          onClick={() => setSearchOpen(v => !v)}
          disabled={isFull}
          title={isFull ? 'Watchlist full (max 10)' : 'Add stock'}
          className="w-[25px] h-[25px] rounded-[7px] border border-[var(--border)] bg-[var(--surface2)] text-[var(--muted)] flex items-center justify-center text-[15px] transition-all hover:bg-[var(--indigo)] hover:border-[var(--indigo)] hover:text-white disabled:opacity-40 disabled:cursor-not-allowed"
        >
          +
        </button>
      </div>

      {searchOpen && (
        <div className="px-3 py-[10px] border-b border-[var(--border)]">
          <input
            autoFocus
            type="text"
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            placeholder="Search ticker e.g. TATASTEEL"
            className="w-full bg-[var(--surface2)] border border-[var(--border)] rounded-lg px-[10px] py-2 text-[12.5px] text-[var(--text)] placeholder-[var(--dim)] outline-none focus:border-[var(--indigo)]"
          />
          {suggestions.length > 0 && (
            <div className="mt-[6px] flex flex-col gap-[2px] max-h-[160px] overflow-y-auto">
              {suggestions.map(s => (
                <button
                  key={s.sym}
                  onClick={() => handleAdd(s.sym)}
                  className="flex justify-between items-center px-[9px] py-[7px] rounded-[6px] text-[12px] hover:bg-[var(--surface3)] transition-colors text-left"
                >
                  <span className="font-mono font-semibold text-[var(--text)]">{s.sym}</span>
                  <span className="text-[var(--dim)] text-[11px] truncate ml-2">{s.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="flex flex-col">
        {symbols.length === 0 ? (
          <div className="py-6 px-4 text-center text-[var(--dim)] text-[12px] leading-[1.6]">
            No stocks yet.<br />Tap + to build your watchlist (max 10).
          </div>
        ) : (
          symbols.map((sym, idx) => {
            const priceData = prices.find(p => p.sym === sym);
            const positive = priceData ? priceData.chg >= 0 : true;
            return (
              <div
                key={sym}
                className="group flex items-center gap-[10px] px-4 py-[11px] border-b border-[var(--border)] last:border-b-0 hover:bg-[var(--surface2)] transition-colors relative"
              >
                <div className="flex-1 min-w-0">
                  <div className="font-mono font-bold text-[12.5px] tracking-[0.2px] text-[var(--text)]">{sym}</div>
                  <div className="text-[10.5px] text-[var(--dim)] truncate">{priceData?.name || sym}</div>
                </div>
                <Sparkline seed={idx * 37 + 11} positive={positive} />
                {priceData && (
                  <div className="text-right flex-shrink-0">
                    <div className="font-mono text-[12.5px] font-semibold text-[var(--text)]">
                      {priceData.price.toLocaleString('en-IN', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
                    </div>
                    <div className={`font-mono text-[10.5px] font-semibold ${positive ? 'text-[var(--mint)]' : 'text-[var(--red)]'}`}>
                      {positive ? '+' : ''}{priceData.chg}%
                    </div>
                  </div>
                )}
                <button
                  onClick={() => removeSymbol(sym)}
                  className="absolute right-[6px] top-[6px] opacity-0 group-hover:opacity-100 w-[18px] h-[18px] rounded-full bg-[var(--surface3)] flex items-center justify-center text-[11px] text-[var(--muted)] hover:text-[var(--red)] transition-all"
                >
                  ✕
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
