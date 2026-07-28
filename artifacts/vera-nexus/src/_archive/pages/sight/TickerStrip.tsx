import { useIndices } from '../../lib/sight-data';

function TickItem({ name, value, change }: { name: string; value: string; change: number }) {
  const up = change >= 0;
  return (
    <span className="inline-flex items-baseline gap-[7px] px-[22px] border-r border-[var(--border)] font-mono text-[12.5px] shrink-0">
      <b className="font-semibold text-[var(--text)] tracking-[0.3px]">{name}</b>
      <span className="text-[var(--muted)]">{value}</span>
      <span className={`font-semibold ${up ? 'text-[var(--mint)]' : 'text-[var(--red)]'}`}>
        {up ? '▲' : '▼'} {Math.abs(change)}%
      </span>
    </span>
  );
}

export function TickerStrip() {
  const { data: indices = [] } = useIndices();

  if (!indices.length) return null;

  const items = [...indices, ...indices]; // duplicate for seamless loop

  return (
    <div
      className="border-t border-b border-[var(--border)] overflow-hidden relative"
      style={{
        WebkitMaskImage: 'linear-gradient(90deg, transparent, #000 4%, #000 96%, transparent)',
        maskImage: 'linear-gradient(90deg, transparent, #000 4%, #000 96%, transparent)',
      }}
    >
      <style>{`
        @keyframes sight-scroll-left {
          from { transform: translateX(0); }
          to { transform: translateX(-50%); }
        }
        .sight-ticker-track {
          display: inline-flex;
          animation: sight-scroll-left 38s linear infinite;
          padding: 9px 0;
          white-space: nowrap;
        }
        .sight-ticker-wrap:hover .sight-ticker-track {
          animation-play-state: paused;
        }
      `}</style>
      <div className="sight-ticker-wrap">
        <div className="sight-ticker-track">
          {items.map((tick, i) => (
            <TickItem key={i} name={tick.name} value={tick.value} change={tick.change} />
          ))}
        </div>
      </div>
    </div>
  );
}
