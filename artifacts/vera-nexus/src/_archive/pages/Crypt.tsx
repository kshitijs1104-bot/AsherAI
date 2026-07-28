import { useAutopsyChat } from '@workspace/api-client-react';
import { useState, useRef, useEffect } from 'react';
import { GRAVEYARD, type GraveyardEntry } from '../lib/graveyard';

const MAX_ATTEMPTS = 5;

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface DynamicStat {
  key: string;
  value: string;
  label: string;
}

type CompanyState = 'Critical' | 'Deteriorating' | 'Stable' | 'Recovering' | 'Survived' | 'Collapsed';

const STATE_COLORS: Record<string, string> = {
  Critical: 'var(--red)',
  Deteriorating: '#f97316',
  Stable: 'var(--amber)',
  Recovering: 'var(--mint)',
  Survived: 'var(--green)',
  Collapsed: 'var(--red)',
};

const STATE_ICONS: Record<string, string> = {
  Critical: '🔴',
  Deteriorating: '🟠',
  Stable: '🟡',
  Recovering: '🟢',
  Survived: '✅',
  Collapsed: '💀',
};

function CompanyStateBar({ state, attempt }: { state: CompanyState; attempt: number }) {
  const color = STATE_COLORS[state] || 'var(--muted)';
  const attemptsLeft = MAX_ATTEMPTS - attempt;

  return (
    <div className="flex items-center gap-4 px-6 py-3 border-b border-[var(--border)] bg-[var(--surface2)]/60">
      <div className="flex items-center gap-2">
        <span className="text-lg">{STATE_ICONS[state] || '⚪'}</span>
        <span className="text-xs font-mono uppercase tracking-wider" style={{ color }}>
          {state}
        </span>
      </div>
      <div className="h-4 w-px bg-[var(--border)]"></div>
      <div className="flex items-center gap-2">
        <span className="text-xs font-mono text-[var(--dim)]">Decisions remaining:</span>
        <div className="flex gap-1">
          {Array.from({ length: MAX_ATTEMPTS }).map((_, i) => (
            <div
              key={i}
              className="w-5 h-5 rounded border flex items-center justify-center text-[10px] font-mono"
              style={{
                borderColor: i < attempt ? 'transparent' : 'var(--border2)',
                background: i < attempt ? 'var(--surface3)' : 'var(--indigo)',
                color: i < attempt ? 'var(--dim)' : 'white',
                opacity: i < attempt ? 0.3 : 1,
              }}
            >
              {i < attempt ? '✓' : i + 1}
            </div>
          ))}
        </div>
        <span className="text-xs font-mono text-[var(--muted)]">
          {attemptsLeft > 0 ? `${attemptsLeft} left` : 'Final'}
        </span>
      </div>
    </div>
  );
}

function CompanyContextPanel({ entry, stats }: { entry: GraveyardEntry; stats: DynamicStat[] }) {
  return (
    <div className="w-96 shrink-0 border-r border-[var(--border)] flex flex-col overflow-y-auto bg-[var(--surface2)]/30">
      <div className="px-5 py-5 border-b border-[var(--border)]">
        <div className="text-[9px] font-mono text-[var(--dim)] uppercase tracking-widest mb-1">{entry.sector}</div>
        <h3 className="text-base font-syne font-bold text-[var(--amber)] leading-tight">{entry.name}</h3>
        <div className="text-[11px] font-mono text-[var(--dim)] mt-0.5">{entry.yearRange}</div>
      </div>

      {stats.length > 0 && (
        <div className="px-5 py-4 border-b border-[var(--border)]">
          <div className="text-[9px] font-mono text-[var(--mint)] uppercase tracking-widest mb-3">Current State</div>
          <div className="space-y-2">
            {stats.map((stat) => (
              <div key={stat.key} className="flex items-baseline justify-between gap-2">
                <span className="text-[9px] font-mono text-[var(--dim)] uppercase tracking-wider">{stat.label}</span>
                <span className="text-sm font-mono text-[var(--text)] text-right">{stat.value}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="px-5 py-4 border-b border-[var(--border)] space-y-1">
        <div className="text-[9px] font-mono text-[var(--mint)] uppercase tracking-widest mb-2">The Product</div>
        <p className="text-xs text-[var(--muted)] leading-relaxed">{entry.description}</p>
      </div>

      {entry.keyMetrics && (
        <div className="px-5 py-4 border-b border-[var(--border)]">
          <div className="text-[9px] font-mono text-[var(--amber)] uppercase tracking-widest mb-2">Key Metrics</div>
          <p className="text-xs font-mono text-[var(--text)] leading-relaxed">{entry.keyMetrics}</p>
        </div>
      )}

      <div className="px-5 py-4 border-b border-[var(--border)]">
        <div className="text-[9px] font-mono text-[var(--green)] uppercase tracking-widest mb-2">What Worked</div>
        <p className="text-xs text-[var(--muted)] leading-relaxed">
          {entry.category === 'technology' && 'Early traction, cultural buzz, and pioneering a new product category.'}
          {entry.category === 'finance' && 'Rapid capital raise, high valuations, and investor confidence at peak.'}
          {entry.category === 'health' && 'Massive press coverage and disruption narrative that drew top-tier investors.'}
          {entry.category === 'markets' && 'Strong initial market positioning and first-mover advantage.'}
          {!['technology','finance','health','markets'].includes(entry.category) && 'Strong initial market traction and brand recognition in the early stages.'}
        </p>
      </div>

      <div className="px-5 py-4">
        <div className="text-[9px] font-mono text-[var(--red)] uppercase tracking-widest mb-2">Why It Failed</div>
        <p className="text-xs text-[var(--text)] leading-relaxed">{entry.failureReason}</p>
        <div className="flex flex-wrap gap-1.5 mt-3">
          {entry.tags.map(tag => (
            <span key={tag} className="text-[9px] font-mono px-1.5 py-0.5 bg-[var(--surface3)] text-[var(--dim)] rounded border border-[var(--border)]">
              {tag}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function AutopsyChatModal({ entry, onClose }: { entry: GraveyardEntry; onClose: () => void }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [companyState, setCompanyState] = useState<CompanyState>('Critical');
  const [attempt, setAttempt] = useState(0);
  const [gameOver, setGameOver] = useState(false);
  const [outcome, setOutcome] = useState<string | null>(null);
  const [briefingDone, setBriefingDone] = useState(false);
  const [dynamicStats, setDynamicStats] = useState<DynamicStat[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const chatMutation = useAutopsyChat();

  const scrollToBottom = () => {
    setTimeout(() => {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
    }, 50);
  };

  // Defensive: if the backend ever returns the model's raw JSON (or a fenced
  // code block) as the reply, extract the human-readable `reply` field so the
  // war room never shows raw `"reply": "..."` text.
  const cleanReply = (raw: string): string => {
    if (!raw || typeof raw !== 'string') return raw;
    let s = raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    if (s.startsWith('{') || s.includes('"reply"')) {
      const start = s.indexOf('{');
      const end = s.lastIndexOf('}');
      if (start !== -1 && end > start) {
        try {
          const obj = JSON.parse(s.slice(start, end + 1));
          if (obj && typeof obj.reply === 'string') return obj.reply;
        } catch {
          /* fall through to regex */
        }
      }
      const m = s.match(/"reply"\s*:\s*"((?:[^"\\]|\\.)*)"/);
      if (m) return m[1].replace(/\\"/g, '"').replace(/\\n/g, '\n');
    }
    return raw;
  };

  // Parse STATS line from AI response. Format: STATS|key1:val1|key2:val2|...
  const parseStats = (text: string): DynamicStat[] => {
    const match = text.match(/STATS\|([^\n]+)/);
    if (!match) return [];
    const pairs = match[1].split('|').map(p => p.trim()).filter(Boolean);
    const labels: Record<string, string> = {
      burn_rate_percent: 'Burn Rate',
      runway_months: 'Runway',
      cash_position: 'Cash Position',
      customers: 'Customers',
      churn_rate: 'Churn',
      arr: 'ARR',
      growth_rate: 'Growth',
      key_metric: 'Key Metric',
    };
    return pairs
      .map(p => {
        const [key, value] = p.split(':').map(s => s.trim());
        return { key, value, label: labels[key] || key.replace(/_/g, ' ').toUpperCase() };
      })
      .filter(s => s.key && s.value);
  };

  useEffect(() => {
    chatMutation.mutate(
      { id: entry.id, data: { message: '', attempt: 0, history: [] } },
      {
        onSuccess: (data) => {
          const cleaned = cleanReply(data.reply);
          const stats = parseStats(cleaned);
          setDynamicStats(stats);
          // Strip STATS line from display
          const displayContent = cleaned.replace(/\n?STATS\|[^\n]+/g, '').trim();
          setMessages([{ role: 'assistant', content: displayContent }]);
          setCompanyState((data.companyState as CompanyState) || 'Critical');
          setBriefingDone(true);
          scrollToBottom();
        },
      }
    );
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSend = () => {
    if (!input.trim() || chatMutation.isPending || gameOver || !briefingDone) return;
    const nextAttempt = attempt + 1;
    const userMsg: ChatMessage = { role: 'user', content: input.trim() };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput('');

    chatMutation.mutate(
      {
        id: entry.id,
        data: {
          message: userMsg.content,
          attempt: nextAttempt,
          history: newMessages.map((m) => ({ role: m.role, content: m.content })),
        },
      },
      {
        onSuccess: (data) => {
          const cleaned = cleanReply(data.reply);
          const stats = parseStats(cleaned);
          setDynamicStats(stats);
          // Strip STATS line from display
          const displayContent = cleaned.replace(/\n?STATS\|[^\n]+/g, '').trim();
          setMessages((prev) => [...prev, { role: 'assistant', content: displayContent }]);
          setCompanyState((data.companyState as CompanyState) || 'Critical');
          setAttempt(nextAttempt);
          if (data.gameOver) {
            setGameOver(true);
            setOutcome(data.outcome || null);
          }
          scrollToBottom();
          inputRef.current?.focus();
        },
      }
    );
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/95">
      <div className="w-full bg-[var(--bg)] border border-[var(--red)]/30 rounded-xl relative flex flex-col overflow-hidden" style={{ maxWidth: '1100px', maxHeight: '92vh', height: '92vh' }}>
        <div className="absolute top-0 left-0 w-full h-0.5 bg-gradient-to-r from-[var(--red)] via-[var(--amber)] to-transparent"></div>

        {/* Header */}
        <div className="flex items-start justify-between px-6 py-4 border-b border-[var(--border)] shrink-0">
          <div>
            <div className="text-[10px] font-mono text-[var(--red)] uppercase tracking-widest mb-0.5">Interim CEO Simulation</div>
            <h2 className="text-lg font-syne font-bold text-white">
              Saving <span className="text-[var(--amber)]">{entry.name}</span>
            </h2>
            <p className="text-xs text-[var(--dim)] font-mono mt-0.5">{entry.yearRange} · {entry.sector}</p>
          </div>
          <button onClick={onClose} className="text-[var(--muted)] hover:text-white text-xl font-mono mt-1 shrink-0">✕</button>
        </div>

        {/* State bar */}
        <CompanyStateBar state={companyState} attempt={attempt} />

        {/* Body: context panel + chat */}
        <div className="flex flex-1 min-h-0">
          <CompanyContextPanel entry={entry} stats={dynamicStats} />

          {/* Chat column */}
          <div className="flex flex-col flex-1 min-w-0">
            <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-5 space-y-4 min-h-0">
              {!briefingDone && (
                <div className="flex items-center justify-center gap-3 py-12 text-[var(--red)] font-mono text-sm">
                  <div className="w-5 h-5 border-2 border-[var(--red)]/20 border-t-[var(--red)] rounded-full animate-spin"></div>
                  Connecting to war room...
                </div>
              )}

              {messages.map((msg, i) => (
                <div key={i} className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
                  {msg.role === 'assistant' ? (
                    <div className="w-7 h-7 rounded-full bg-[var(--red)]/20 border border-[var(--red)]/40 flex items-center justify-center text-xs shrink-0 mt-0.5">
                      AI
                    </div>
                  ) : (
                    <div className="w-7 h-7 rounded-full bg-[var(--indigo)]/20 border border-[var(--indigo)]/40 flex items-center justify-center text-xs shrink-0 mt-0.5">
                      CE
                    </div>
                  )}
                    <div className={`max-w-[65%] flex flex-col gap-1 ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                    <div className={`text-[9px] font-mono uppercase tracking-wider ${msg.role === 'user' ? 'text-[var(--indigo-light)]' : 'text-[var(--red)]'}`}>
                      {msg.role === 'user' ? 'You (CEO)' : 'Simulator'}
                    </div>
                    <div className={`px-3 py-2.5 rounded-lg text-sm leading-relaxed whitespace-pre-wrap ${
                      msg.role === 'user'
                        ? 'bg-[var(--indigo)]/20 border border-[var(--indigo)]/30 text-[var(--text)]'
                        : 'bg-[var(--surface2)] border border-[var(--border)] text-[var(--text)]'
                    }`}>
                      {msg.content}
                    </div>
                  </div>
                </div>
              ))}

              {chatMutation.isPending && briefingDone && (
                <div className="flex gap-3">
                  <div className="w-7 h-7 rounded-full bg-[var(--red)]/20 border border-[var(--red)]/40 flex items-center justify-center text-xs shrink-0 mt-0.5">AI</div>
                  <div className="bg-[var(--surface2)] border border-[var(--border)] px-3 py-2.5 rounded-lg">
                    <div className="flex gap-1 items-center">
                      <div className="w-1.5 h-1.5 bg-[var(--red)] rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
                      <div className="w-1.5 h-1.5 bg-[var(--red)] rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                      <div className="w-1.5 h-1.5 bg-[var(--red)] rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
                    </div>
                  </div>
                </div>
              )}

              {gameOver && (
                <div className={`border rounded-xl p-5 text-center ${outcome === 'survived' ? 'border-[var(--mint)]/40 bg-[var(--mint)]/5' : 'border-[var(--red)]/40 bg-[var(--red)]/5'}`}>
                  <div className={`text-lg font-syne font-bold mb-1 ${outcome === 'survived' ? 'text-[var(--mint)]' : 'text-[var(--red)]'}`}>
                    {outcome === 'survived' ? 'Company Survived' : 'Company Collapsed'}
                  </div>
                  <div className="text-xs text-[var(--muted)]">
                    {outcome === 'survived'
                      ? 'Your decisions steered the company through the crisis.'
                      : `${entry.name} is now part of the Corporate Graveyard.`}
                  </div>
                </div>
              )}
            </div>

            {/* Input */}
            {!gameOver && briefingDone && (
              <div className="px-5 py-4 border-t border-[var(--border)] bg-[var(--surface2)]/40 shrink-0">
                <div className="text-[9px] font-mono text-[var(--dim)] mb-2 uppercase tracking-wider">
                  Decision #{attempt + 1} of {MAX_ATTEMPTS} — What is your move?
                </div>
                <div className="flex gap-3 items-end">
                  <textarea
                    ref={inputRef}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Type your decision... (Enter to send)"
                    rows={2}
                    className="flex-1 bg-[var(--surface)] border border-[var(--border)] rounded-lg px-3 py-2.5 text-sm text-[var(--text)] placeholder-[var(--dim)] resize-none focus:outline-none focus:border-[var(--red)]/60 font-mono"
                    disabled={chatMutation.isPending}
                  />
                  <button
                    onClick={handleSend}
                    disabled={!input.trim() || chatMutation.isPending}
                    className="px-4 py-2.5 bg-[var(--red)] hover:bg-[var(--red)]/80 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-bold rounded-lg transition-colors shrink-0"
                  >
                    Execute →
                  </button>
                </div>
              </div>
            )}

            {gameOver && (
              <div className="px-5 py-4 border-t border-[var(--border)] text-center shrink-0">
                <button
                  onClick={onClose}
                  className="px-6 py-2 border border-[var(--border2)] text-[var(--muted)] hover:text-white hover:border-white transition-colors text-sm font-mono rounded-lg"
                >
                  Return to Graveyard
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export function CryptPage() {
  const [selected, setSelected] = useState<GraveyardEntry | null>(null);

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <header className="mb-10 text-center py-10 border-b border-[var(--border2)] bg-gradient-to-b from-transparent to-[var(--surface2)]/30 rounded-t-2xl">
        <h1 className="text-4xl font-syne font-extrabold text-[var(--red)] tracking-tight mb-2 opacity-90">Corporate Graveyard</h1>
        <p className="text-sm font-mono text-[var(--muted)] uppercase tracking-widest">Step in as Interim CEO — 5 decisions to save the company</p>
      </header>

      <div className="grid grid-cols-2 gap-6">
        {GRAVEYARD.map(entry => (
          <div key={entry.id} className="bg-[var(--surface)] border border-[var(--border2)] rounded-lg p-6 relative overflow-hidden group">
            <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
              <svg width="60" height="60" viewBox="0 0 24 24" fill="none" stroke="var(--red)" strokeWidth="1">
                <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
              </svg>
            </div>

            <div className="flex justify-between items-start mb-4 relative z-10">
              <div>
                <h2 className="text-2xl font-syne font-bold text-[var(--amber)]">{entry.name}</h2>
                <div className="text-[10px] font-mono text-[var(--dim)] uppercase tracking-wider mt-1">{entry.sector}</div>
              </div>
              <span className="text-xs font-mono text-[var(--muted)] px-2 py-1 border border-[var(--border)] rounded bg-[var(--surface2)] shrink-0 ml-4">
                {entry.yearRange}
              </span>
            </div>

            <p className="text-sm text-[var(--muted)] mb-4 line-clamp-2 leading-relaxed relative z-10">{entry.description}</p>

            {entry.keyMetrics && (
              <div className="text-[11px] font-mono text-[var(--dim)] bg-[var(--surface2)] border border-[var(--border)] rounded px-3 py-2 mb-4 relative z-10">
                {entry.keyMetrics}
              </div>
            )}

            <div className="flex items-center justify-between mt-auto relative z-10">
              <div className="flex gap-2 flex-wrap">
                {entry.tags.slice(0, 2).map(tag => (
                  <span key={tag} className="text-[10px] uppercase font-mono px-2 py-1 bg-[var(--surface2)] text-[var(--dim)] rounded border border-[var(--border)]">
                    {tag}
                  </span>
                ))}
              </div>
              <button
                onClick={() => setSelected(entry)}
                className="px-4 py-2 border border-[var(--red)]/50 text-[var(--red)] hover:bg-[var(--red)] hover:text-white transition-all text-xs font-bold uppercase tracking-wider rounded shrink-0 ml-4"
              >
                Enter as CEO →
              </button>
            </div>
          </div>
        ))}
      </div>

      {selected && (
        <AutopsyChatModal entry={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}
