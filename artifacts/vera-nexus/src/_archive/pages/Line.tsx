import { useState } from 'react';
import { useListEvents, useAnalyzeRipple } from '@workspace/api-client-react';
import { useCategory } from '../lib/CategoryContext';
import { Filter } from 'lucide-react';

type NodeType = 'trigger' | 'cause' | 'effect' | 'consequence';

interface FlowNode {
  id: string;
  label: string;
  type: NodeType;
}

interface FlowEdge {
  from: string;
  to: string;
}

interface Flowchart {
  nodes: FlowNode[];
  edges: FlowEdge[];
}

const NODE_STYLES: Record<NodeType, { border: string; bg: string; text: string; label: string }> = {
  trigger:     { border: '#f59e0b', bg: 'rgba(245,158,11,0.08)',  text: '#f59e0b', label: 'Trigger' },
  cause:       { border: '#ef4444', bg: 'rgba(239,68,68,0.08)',   text: '#ef4444', label: 'Cause' },
  effect:      { border: '#5b4fe8', bg: 'rgba(91,79,232,0.08)',   text: '#a5b4fc', label: 'Effect' },
  consequence: { border: '#00e5b0', bg: 'rgba(0,229,176,0.08)',   text: '#00e5b0', label: 'Consequence' },
};

function RippleFlowchart({ flowchart }: { flowchart: Flowchart }) {
  const { nodes, edges } = flowchart;

  // Group nodes by type in natural order
  const levels: NodeType[] = ['trigger', 'cause', 'effect', 'consequence'];
  const grouped = levels.map((type) => nodes.filter((n) => n.type === type));

  // Build adjacency for "which parent connects to which child"
  const childrenOf: Record<string, string[]> = {};
  for (const e of edges) {
    if (!childrenOf[e.from]) childrenOf[e.from] = [];
    childrenOf[e.from].push(e.to);
  }

  return (
    <div className="space-y-0">
      {grouped.map((group, levelIdx) => {
        if (!group.length) return null;
        const isLast = levelIdx === grouped.length - 1 || grouped.slice(levelIdx + 1).every((g) => !g.length);
        return (
          <div key={levelIdx}>
            {/* Row of nodes */}
            <div className={`flex gap-3 ${group.length === 1 ? 'justify-center' : 'justify-center'}`}>
              {group.map((node) => {
                const style = NODE_STYLES[node.type];
                return (
                  <div
                    key={node.id}
                    className="flex-1 max-w-[200px] rounded-lg px-3 py-3 text-center relative"
                    style={{ border: `1px solid ${style.border}40`, background: style.bg }}
                  >
                    <div
                      className="text-[9px] font-mono uppercase tracking-widest mb-1.5 font-bold"
                      style={{ color: style.border }}
                    >
                      {style.label}
                    </div>
                    <div className="text-xs leading-snug font-medium" style={{ color: style.text }}>
                      {node.label}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Connector arrows to next level */}
            {!isLast && (
              <div className="flex justify-center py-1.5">
                <div className="flex flex-col items-center">
                  <div className="w-px h-4 bg-[var(--border2)]"></div>
                  <svg width="10" height="6" viewBox="0 0 10 6" fill="none">
                    <path d="M5 6L0 0H10L5 6Z" fill="var(--border2)" />
                  </svg>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function LinePage() {
  const { category } = useCategory();
  const params = category && category !== 'all' ? { category } : undefined;
  const { data: rawEvents, isLoading, isError } = useListEvents(params as any);
  const events = Array.isArray(rawEvents) ? rawEvents : (rawEvents as any)?.data ?? [];
  const [selectedEventForRipple, setSelectedEventForRipple] = useState<number | null>(null);

  const rippleMutation = useAnalyzeRipple();

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <header className="flex items-center justify-between mb-8 border-b border-[var(--border)] pb-4">
        <h1 className="text-sm font-mono text-[var(--muted)]">{isLoading ? '—' : events.length} events · chronological</h1>
        <button className="flex items-center gap-2 text-sm text-[var(--muted)] hover:text-white transition-colors px-3 py-1.5 bg-[var(--surface2)] rounded border border-[var(--border)]">
          <Filter className="w-4 h-4" />
          Filter
        </button>
      </header>

      <div className="relative border-l border-[var(--border2)] ml-4 space-y-12 pb-12">
        {isLoading ? (
          <div className="pl-8 space-y-6">
            {[1,2,3].map(i => (
              <div key={i} className="h-48 bg-[var(--surface2)] rounded-lg animate-pulse w-full"></div>
            ))}
          </div>
        ) : isError ? (
          <div className="pl-8 py-16 text-center">
            <div className="text-[var(--red)] font-mono text-sm mb-2">Failed to load events</div>
            <div className="text-[var(--dim)] text-xs font-mono">Check that the API server is reachable at VITE_API_BASE_URL</div>
          </div>
        ) : events.length === 0 ? (
          <div className="pl-8 py-16 text-center">
            <div className="text-[var(--muted)] font-mono text-sm">No events found for this category</div>
          </div>
        ) : events.map((event: any) => {
          const isPos = event.sentiment === 'positive';
          const isNeg = event.sentiment === 'negative';

          return (
            <div key={event.id} className="relative pl-8 group">
              <div className={`absolute -left-2 top-0 w-4 h-4 rounded-full border-[4px] border-[var(--bg)] flex items-center justify-center ${
                isPos ? 'bg-[var(--green)]' : isNeg ? 'bg-[var(--red)]' : 'bg-[var(--amber)]'
              }`}></div>

              <div className="bg-[var(--surface2)] border border-[var(--border)] rounded-lg p-6 hover:border-[var(--border2)] transition-colors relative overflow-hidden">
                <div className="flex items-center gap-3 mb-4 text-xs font-mono">
                  <span className="px-2 py-1 bg-[var(--surface3)] rounded text-white">{event.year}</span>
                  <span className="uppercase text-[var(--muted)] tracking-wider">{event.category} Intelligence</span>
                  <span className={`px-2 py-1 rounded border uppercase font-bold tracking-wider ${
                    isPos ? 'text-[var(--green)] border-[var(--green)]/30 bg-[var(--green)]/10' :
                    isNeg ? 'text-[var(--red)] border-[var(--red)]/30 bg-[var(--red)]/10' :
                    'text-[var(--amber)] border-[var(--amber)]/30 bg-[var(--amber)]/10'
                  }`}>
                    {event.sentiment}
                  </span>
                  {event.rippleCount !== undefined && (
                    <span className="px-2 py-1 bg-[var(--indigo)]/20 text-[var(--indigo-light)] rounded border border-[var(--indigo)]/30">
                      Ripples: {event.rippleCount}
                    </span>
                  )}
                </div>

                <h2 className="text-2xl font-syne font-bold text-white mb-2">{event.title}</h2>
                <p className="text-[var(--muted)] text-sm mb-6 max-w-2xl leading-relaxed">{event.description}</p>

                <div className="flex items-center justify-between border-t border-[var(--border)] pt-4">
                  <div className="flex items-center gap-3 flex-1 max-w-[200px]">
                    <span className="text-xs font-mono text-[var(--dim)]">Impact</span>
                    <div className="flex-1 h-1 bg-[var(--surface3)] rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${event.impact}%`,
                          background: isPos ? 'var(--green)' : isNeg ? 'var(--red)' : 'var(--amber)'
                        }}
                      ></div>
                    </div>
                    <span className="text-xs font-mono text-[var(--text)]">{event.impact}%</span>
                  </div>

                  <button
                    onClick={() => {
                      setSelectedEventForRipple(event.id);
                      rippleMutation.mutate({ id: event.id });
                    }}
                    className="text-sm font-bold text-[var(--indigo-light)] hover:text-white transition-colors"
                  >
                    Ripple Analysis →
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Ripple Analysis slide-over */}
      {selectedEventForRipple && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => { setSelectedEventForRipple(null); rippleMutation.reset(); }}
          ></div>
          <div className="w-[480px] bg-[var(--surface)] border-l border-[var(--border)] h-full relative z-10 flex flex-col">
            <div className="absolute top-0 left-0 w-full h-0.5 bg-gradient-to-r from-[var(--indigo)] to-transparent"></div>

            {/* Header */}
            <div className="flex justify-between items-center px-6 py-5 border-b border-[var(--border)] shrink-0">
              <div>
                <div className="text-[10px] font-mono text-[var(--indigo-light)] uppercase tracking-widest mb-0.5">Causal Analysis</div>
                <h2 className="text-lg font-syne font-bold text-white">Ripple Effect</h2>
              </div>
              <button
                onClick={() => { setSelectedEventForRipple(null); rippleMutation.reset(); }}
                className="text-[var(--muted)] hover:text-white text-xl font-mono"
              >
                ✕
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto px-6 py-6 space-y-6 min-h-0">
              {rippleMutation.isPending ? (
                <div className="flex flex-col items-center justify-center gap-4 py-16 text-[var(--indigo-light)] font-mono text-sm">
                  <div className="w-10 h-10 border-2 border-[var(--indigo)]/20 border-t-[var(--indigo)] rounded-full animate-spin"></div>
                  Mapping causal chain...
                </div>
              ) : rippleMutation.data ? (
                <>
                  {/* Summary */}
                  <div className="bg-[var(--surface2)] border border-[var(--border)] rounded-lg p-4">
                    <h3 className="text-[10px] font-mono text-[var(--mint)] mb-2 uppercase tracking-wider">Analysis</h3>
                    <p className="text-sm text-[var(--text)] leading-relaxed">{rippleMutation.data.analysis}</p>
                  </div>

                  {/* Flowchart */}
                  {rippleMutation.data.flowchart &&
                   rippleMutation.data.flowchart.nodes &&
                   rippleMutation.data.flowchart.nodes.length > 0 ? (
                    <div>
                      <h3 className="text-[10px] font-mono text-[var(--amber)] mb-4 uppercase tracking-wider flex items-center gap-2">
                        <span className="w-1.5 h-1.5 bg-[var(--amber)] rounded-full"></span>
                        Cause & Effect Flowchart
                      </h3>
                      <RippleFlowchart flowchart={rippleMutation.data.flowchart as Flowchart} />
                    </div>
                  ) : rippleMutation.data.causalChain && rippleMutation.data.causalChain.length > 0 ? (
                    <div>
                      <h3 className="text-[10px] font-mono text-[var(--amber)] mb-3 uppercase tracking-wider">Causal Chain</h3>
                      <div className="space-y-2 border-l border-[var(--border)] ml-2 pl-4">
                        {rippleMutation.data.causalChain.map((step: string, i: number) => (
                          <div key={i} className="text-sm text-[var(--muted)] relative before:absolute before:-left-[21px] before:top-2 before:w-2 before:h-2 before:bg-[var(--surface3)] before:rounded-full before:border before:border-[var(--border)]">
                            {step}
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    // Previously this fell through to `null` — both the flowchart
                    // and causalChain branches can legitimately come back empty
                    // (model call failed after retry, or genuinely no key), and
                    // that left a blank gap where the chain should be with no
                    // indication anything went wrong. Surface it explicitly so
                    // "no chain" always reads as a real state, never a rendering gap.
                    <div className="text-sm text-[var(--dim)] border border-dashed border-[var(--border)] rounded-lg px-4 py-3">
                      Couldn't map the causal chain for this event.
                      {rippleMutation.data.generationFailed && (
                        <button
                          className="ml-2 text-[var(--amber)] underline underline-offset-2"
                          onClick={() => rippleMutation.mutate({ id: selectedEventForRipple as number })}
                        >
                          Retry
                        </button>
                      )}
                    </div>
                  )}

                  {/* Affected sectors */}
                  {rippleMutation.data.affectedSectors && rippleMutation.data.affectedSectors.length > 0 && (
                    <div>
                      <h3 className="text-[10px] font-mono text-[var(--dim)] mb-3 uppercase tracking-wider">Affected Sectors</h3>
                      <div className="flex flex-wrap gap-2">
                        {rippleMutation.data.affectedSectors.map((sector: string) => (
                          <span key={sector} className="text-[11px] font-mono px-2 py-1 bg-[var(--surface2)] text-[var(--muted)] rounded border border-[var(--border)]">
                            {sector}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Legend */}
                  {rippleMutation.data.flowchart && (
                    <div className="border-t border-[var(--border)] pt-4">
                      <div className="text-[10px] font-mono text-[var(--dim)] mb-3 uppercase tracking-wider">Legend</div>
                      <div className="grid grid-cols-2 gap-2">
                        {(Object.entries(NODE_STYLES) as [NodeType, typeof NODE_STYLES[NodeType]][]).map(([type, style]) => (
                          <div key={type} className="flex items-center gap-2">
                            <div className="w-3 h-3 rounded-sm border" style={{ borderColor: style.border, background: style.bg }}></div>
                            <span className="text-[11px] font-mono" style={{ color: style.border }}>{style.label}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
