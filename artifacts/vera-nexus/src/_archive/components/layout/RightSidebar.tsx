import { useListSignals } from '@workspace/api-client-react';

export function RightSidebar() {
  const { data: rawSignals, isLoading } = useListSignals();
  const signals = Array.isArray(rawSignals) ? rawSignals : (rawSignals as any)?.data ?? [];

  return (
    <aside className="w-[220px] border-l border-[var(--border)] bg-[var(--surface)] p-4 flex flex-col shrink-0 overflow-y-auto">
      <h3 className="text-xs font-bold text-[var(--dim)] uppercase tracking-wider mb-4">Signals</h3>
      
      {isLoading ? (
        <div className="space-y-4">
          {[1,2,3].map(i => <div key={i} className="h-12 bg-[var(--surface2)] rounded animate-pulse"></div>)}
        </div>
      ) : (
        <div className="space-y-3 mb-8">
          {signals.map((signal: any) => {
            const isPos = signal.sentiment === 'positive';
            const isNeg = signal.sentiment === 'negative';
            const isWarn = signal.sentiment === 'warning';
            
            return (
              <div key={signal.id} className="flex flex-col gap-1 p-2 rounded hover:bg-[var(--surface2)] transition-colors border border-transparent hover:border-[var(--border)]">
                <div className="flex items-center justify-between text-xs font-medium text-[var(--text)]">
                  <span>{signal.name}</span>
                  <span className="font-mono">{signal.value || '-'}</span>
                </div>
                <div className="flex items-center justify-between text-[11px] font-mono">
                  <span className={`${
                    isPos ? 'text-[var(--green)]' : isNeg ? 'text-[var(--red)]' : isWarn ? 'text-[var(--amber)]' : 'text-[var(--dim)]'
                  }`}>
                    {isNeg && '↓ '}{signal.change}
                  </span>
                  {isWarn && <span className="text-[var(--amber)] font-bold">High</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="mt-auto pt-4 border-t border-[var(--border)]">
        <div className="bg-[var(--surface2)] border border-[var(--mint)]/30 rounded p-3 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-16 h-16 bg-[var(--mint)] opacity-10 blur-xl"></div>
          <h4 className="text-sm font-syne font-bold text-white mb-2">Causal AI Layer</h4>
          <p className="text-xs text-[var(--muted)] mb-3 leading-relaxed">
            Unlock deep network effect analysis and multi-order impact prediction.
          </p>
          <button className="w-full text-xs font-bold uppercase tracking-wider bg-[var(--mint)] text-black py-2 rounded hover:bg-opacity-90 transition-colors">
            Unlock Enterprise →
          </button>
        </div>
      </div>
    </aside>
  );
}
