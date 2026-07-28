interface AiStat {
  label: string;
  value: string;
}

interface AiSummaryData {
  bullets: string[];
  stats: AiStat[];
}

interface AiSummaryPanelProps {
  isLoading: boolean;
  data?: AiSummaryData;
}

function Shimmer({ width }: { width: string }) {
  return (
    <div
      className="h-[11px] rounded-[4px]"
      style={{
        width,
        background: 'linear-gradient(90deg, var(--surface2) 25%, var(--surface3) 50%, var(--surface2) 75%)',
        backgroundSize: '200% 100%',
        animation: 'sight-shimmer 1.3s infinite',
      }}
    />
  );
}

export function AiSummaryPanel({ isLoading, data }: AiSummaryPanelProps) {
  return (
    <div className="h-full overflow-y-auto p-6">
      <style>{`
        @keyframes sight-shimmer {
          from { background-position: 200% 0; }
          to { background-position: -200% 0; }
        }
      `}</style>
      <div className="flex items-center gap-2 mb-1">
        <svg className="w-4 h-4 stroke-[var(--mint)]" viewBox="0 0 24 24" fill="none" strokeWidth="2">
          <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
        </svg>
        <h4 className="font-syne text-[14.5px] font-bold text-[var(--text)]">AI Summary</h4>
      </div>
      <p className="text-[11.5px] text-[var(--dim)] mb-4 leading-[1.5]">
        Condensed in seconds. Always verify against the full article for trading decisions.
      </p>

      {isLoading && (
        <div className="flex flex-col gap-[9px]">
          <Shimmer width="92%" />
          <Shimmer width="76%" />
          <Shimmer width="85%" />
          <Shimmer width="60%" />
          <Shimmer width="80%" />
          <Shimmer width="70%" />
        </div>
      )}

      {!isLoading && data && (
        <>
          <div className="flex flex-col gap-[11px] mb-[18px]">
            {data.bullets.map((bullet, i) => (
              <div key={i} className="flex gap-[9px] text-[12.8px] leading-[1.55] text-[#d6d9e6]">
                <span className="w-[5px] h-[5px] rounded-full bg-[var(--mint)] mt-[7px] flex-shrink-0" />
                {bullet}
              </div>
            ))}
          </div>
          {data.stats.length > 0 && (
            <>
              <div className="h-px bg-[var(--border)] my-[18px]" />
              <div>
                {data.stats.map((stat, i) => (
                  <div
                    key={i}
                    className="flex justify-between items-center py-[9px] border-b border-[var(--border)] last:border-b-0 text-[12px]"
                  >
                    <span className="text-[var(--dim)]">{stat.label}</span>
                    <span className="font-mono font-semibold text-[var(--text)]">{stat.value}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
