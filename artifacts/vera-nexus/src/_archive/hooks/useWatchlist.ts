import { useState } from 'react';

const MAX_WATCHLIST = 10;
// TODO: Swap this hook for Supabase persistence — only this file needs changing.
// Replace useState with a Supabase-backed hook that reads/writes the watchlist table
// filtered by the current user's session ID. All components that call useWatchlist
// will automatically pick up the persistence without any other changes.
const DEFAULT_SYMBOLS = ['RELIANCE', 'TCS', 'TATASTEEL', 'ADANIENT'];

export function useWatchlist() {
  const [symbols, setSymbols] = useState<string[]>(DEFAULT_SYMBOLS);

  const addSymbol = (sym: string) => {
    const upper = sym.trim().toUpperCase();
    if (!upper) return;
    setSymbols(prev => {
      if (prev.includes(upper) || prev.length >= MAX_WATCHLIST) return prev;
      return [...prev, upper];
    });
  };

  const removeSymbol = (sym: string) => {
    setSymbols(prev => prev.filter(s => s !== sym.toUpperCase()));
  };

  const isFull = symbols.length >= MAX_WATCHLIST;

  return { symbols, addSymbol, removeSymbol, isFull, max: MAX_WATCHLIST };
}
