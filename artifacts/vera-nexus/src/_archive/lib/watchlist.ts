const WATCHLIST_KEY = 've_watchlist';

export const DEFAULT_TICKERS = ['AAPL', 'TSLA', 'NVDA', 'MSFT', 'GOOGL'];
const MAX_TICKERS = 10;

export function getWatchlist(): string[] {
  try {
    const raw = localStorage.getItem(WATCHLIST_KEY);
    if (!raw) return [...DEFAULT_TICKERS];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [...DEFAULT_TICKERS];
  } catch {
    return [...DEFAULT_TICKERS];
  }
}

export function saveWatchlist(tickers: string[]) {
  try {
    localStorage.setItem(WATCHLIST_KEY, JSON.stringify(tickers.slice(0, MAX_TICKERS)));
  } catch {}
}

export function addTicker(ticker: string): string[] {
  const current = getWatchlist();
  const upper = ticker.toUpperCase().trim();
  if (!upper || current.includes(upper) || current.length >= MAX_TICKERS) return current;
  const next = [...current, upper];
  saveWatchlist(next);
  return next;
}

export function removeTicker(ticker: string): string[] {
  const current = getWatchlist();
  const next = current.filter(t => t !== ticker.toUpperCase());
  saveWatchlist(next);
  return next;
}
