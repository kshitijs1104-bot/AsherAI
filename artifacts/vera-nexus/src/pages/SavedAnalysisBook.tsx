import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { ArrowLeft, ArrowRight, MessageSquare, Loader2 } from 'lucide-react';
import { useVenusAnalyze } from '@workspace/api-client-react';
import {
  getSavedAnalyses, typeLabel,
  type SavedAnalysis, type SavedAnalysisType, type ChatMessage,
} from '../lib/venusHistory';

// The Saved Analysis book — the read-back half of "Save as Analysis", which
// until now wrote to localStorage and showed the result only as a flat list
// in the chat sidebar. Saving something and then never being shown it again
// in any considered way is what made the feature feel write-only.
//
// Physically it's one notebook with three spreads: the board you came from,
// an index page, and a page per analysis type. Movement between them is a
// page turn rather than a route change, because these are pages of the same
// object — Command Center is already styled as a paper board, and a router
// navigation would break that fiction and lose the board's scroll position.

export type BookPalette = {
  bg: string; paper: string; paperEdge: string; line: string;
  text: string; muted: string; faint: string;
  teal: string; tealDim: string; tealBorder: string;
  coral: string; coralDim: string; coralBorder: string;
  marginRule: string; dogear: string;
};

// One colour per analysis type, used for that type's sticky tab and its
// page accents. Chosen to stay distinguishable from each other AND legible
// as a text colour on the light paper — the tabs are the only navigation on
// the index page, so "which tab is which" has to survive a glance.
const TYPE_COLORS: Record<SavedAnalysisType, { dark: string; light: string }> = {
  risk: { dark: '#e0765f', light: '#b03f21' },
  roadmap: { dark: '#4d9fe8', light: '#1d4ed8' },
  pattern: { dark: '#c98ae0', light: '#7e22ce' },
  fundraising: { dark: '#3fc79a', light: '#0b7a61' },
  competitive: { dark: '#e8b84d', light: '#8a6100' },
  analysis: { dark: '#8f9bb3', light: '#4a5568' },
};

export const TYPE_ORDER: SavedAnalysisType[] = ['risk', 'roadmap', 'fundraising', 'competitive', 'pattern', 'analysis'];

// Exported so Command Center's own Saved Analysis section dots match the
// book's tabs exactly — one source of truth for "what colour is a risk".
export function typeColor(type: SavedAnalysisType, isLight: boolean): string {
  const c = TYPE_COLORS[type] ?? TYPE_COLORS.analysis;
  return isLight ? c.light : c.dark;
}

function formatSavedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ---------------------------------------------------------------------------
// Mini Vera
// ---------------------------------------------------------------------------

const MINI_TURN_LIMIT = 3;

// A deliberately capped conversation attached to one saved analysis. The cap
// isn't a technical limit — it's the point of the thing: this is for "what
// did I mean by this" while looking at the page, and anything longer is a
// real chat that deserves the full thread, its own goal, and history. At the
// limit it stops and hands the whole exchange over to a new chat rather than
// silently degrading into a cramped chat window.
function MiniVera({
  analysis, palette, isLight, onContinueInChat, onClose,
}: {
  analysis: SavedAnalysis;
  palette: BookPalette;
  isLight: boolean;
  onContinueInChat: (messages: ChatMessage[]) => void;
  onClose: () => void;
}) {
  const analyze = useVenusAnalyze();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const endRef = useRef<HTMLDivElement | null>(null);

  const userTurns = messages.filter((m) => m.role === 'user').length;
  const atLimit = userTurns >= MINI_TURN_LIMIT;

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, analyze.isPending]);

  const send = () => {
    const text = input.trim();
    if (!text || atLimit || analyze.isPending) return;

    const next: ChatMessage[] = [...messages, { role: 'user', content: text }];
    setMessages(next);
    setInput('');

    // The saved analysis leads the history so Vera answers about THIS
    // conclusion rather than starting cold — the founder is looking at the
    // page, and having to re-explain what they're looking at would defeat
    // the point of asking from here.
    const history = [
      { role: 'venus' as const, content: `Earlier analysis titled "${analysis.title}":\n\n${analysis.summary}` },
      ...messages.map((m) => ({ role: m.role, content: m.content ?? '' })),
    ];

    analyze.mutate(
      { data: { message: text, sessionHistory: history } },
      {
        onSuccess: (res) => {
          setMessages((prev) => [...prev, {
            role: 'venus',
            content: res.summary,
            cards: res.cards,
            confidence: res.confidence,
            confidenceNote: res.confidenceNote,
            contextQuery: text,
          }]);
        },
      },
    );
  };

  // Handed to the full chat with the analysis as the opening context, so the
  // new thread reads as a continuation rather than a transcript pasted in.
  const handoff = () => {
    onContinueInChat([
      { role: 'user', content: `About my saved analysis "${analysis.title}":\n\n${analysis.summary}` },
      ...messages,
    ]);
  };

  return (
    <div
      style={{
        marginTop: '12px', borderRadius: '10px', overflow: 'hidden',
        border: `1px solid ${palette.tealBorder}`, background: palette.tealDim,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '9px 12px', borderBottom: `1px solid ${palette.tealBorder}` }}>
        <span style={{ fontFamily: "var(--v7-font-mono, 'IBM Plex Mono', monospace)", fontSize: '10px', letterSpacing: '0.05em', color: palette.teal }}>
          ASK ASHER · {MINI_TURN_LIMIT - userTurns} {MINI_TURN_LIMIT - userTurns === 1 ? 'MESSAGE' : 'MESSAGES'} LEFT
        </span>
        <button type="button" onClick={onClose} style={{ background: 'none', border: 'none', color: palette.muted, fontSize: '11px', fontFamily: "var(--v7-font-mono, 'IBM Plex Mono', monospace)", cursor: 'pointer', padding: 0 }}>
          Close
        </button>
      </div>

      <div style={{ maxHeight: '260px', overflowY: 'auto', padding: '12px' }}>
        {messages.length === 0 && (
          <p style={{ fontSize: '12.5px', fontStyle: 'italic', color: palette.muted, margin: 0 }}>
            Ask about this analysis — what's changed, what you got wrong, what to do next.
          </p>
        )}
        {messages.map((m, i) => (
          <div key={i} style={{ marginBottom: '10px' }}>
            <div style={{ fontFamily: "var(--v7-font-mono, 'IBM Plex Mono', monospace)", fontSize: '9.5px', letterSpacing: '0.05em', color: m.role === 'user' ? palette.faint : palette.teal, marginBottom: '3px' }}>
              {m.role === 'user' ? 'YOU' : 'ASHER'}
            </div>
            <div style={{ fontSize: '13px', lineHeight: 1.55, color: palette.text, whiteSpace: 'pre-wrap' }}>{m.content}</div>
          </div>
        ))}
        {analyze.isPending && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: palette.muted, fontSize: '12px' }}>
            <Loader2 style={{ width: 12, height: 12 }} className="animate-spin" /> Thinking…
          </div>
        )}
        {analyze.isError && (
          <div style={{ fontSize: '11.5px', color: palette.coral }}>
            {analyze.error instanceof Error ? analyze.error.message : 'That failed. Try again.'}
          </div>
        )}
        <div ref={endRef} />
      </div>

      <div style={{ padding: '10px 12px', borderTop: `1px solid ${palette.tealBorder}` }}>
        {atLimit ? (
          <div>
            <p style={{ fontSize: '12.5px', color: palette.text, margin: '0 0 8px', lineHeight: 1.5 }}>
              That's as far as this goes here. Let's continue properly in a new chat, where Asher keeps the full thread.
            </p>
            <button
              type="button"
              onClick={handoff}
              style={{
                fontFamily: "var(--v7-font-mono, 'IBM Plex Mono', monospace)", fontSize: '11px', letterSpacing: '0.03em',
                background: palette.teal, color: isLight ? '#ffffff' : '#08120f',
                border: 'none', borderRadius: '6px', padding: '7px 12px', cursor: 'pointer', fontWeight: 600,
              }}
            >
              Open this in a new chat
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end' }}>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
              placeholder="Ask about this…"
              rows={2}
              style={{
                flex: 1, fontSize: '12.5px', color: palette.text, background: palette.paper,
                border: `1px solid ${palette.line}`, borderRadius: '6px', padding: '7px 9px',
                outline: 'none', fontFamily: 'inherit', resize: 'none',
              }}
            />
            <button
              type="button"
              onClick={send}
              disabled={!input.trim() || analyze.isPending}
              style={{
                fontFamily: "var(--v7-font-mono, 'IBM Plex Mono', monospace)", fontSize: '11px',
                background: palette.teal, color: isLight ? '#ffffff' : '#08120f',
                border: 'none', borderRadius: '6px', padding: '8px 12px',
                cursor: 'pointer', fontWeight: 600, opacity: !input.trim() || analyze.isPending ? 0.45 : 1,
              }}
            >
              Ask
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// One saved analysis on a type page
// ---------------------------------------------------------------------------

function AnalysisEntry({
  analysis, palette, isLight, onOpenThread, onContinueInChat,
}: {
  analysis: SavedAnalysis;
  palette: BookPalette;
  isLight: boolean;
  onOpenThread: ((a: SavedAnalysis) => void) | undefined;
  onContinueInChat: (messages: ChatMessage[]) => void;
}) {
  const [asking, setAsking] = useState(false);
  const color = typeColor(analysis.type, isLight);
  const canOpenThread = !!analysis.sessionId && !!onOpenThread;

  return (
    <div style={{ padding: '18px 0', borderBottom: `1px solid ${palette.line}` }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginBottom: '6px' }}>
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: color, flexShrink: 0 }} />
        <span style={{ fontFamily: "var(--v7-font-mono, 'IBM Plex Mono', monospace)", fontSize: '9.5px', letterSpacing: '0.05em', color: palette.faint }}>
          {formatSavedAt(analysis.savedAt)}
        </span>
      </div>

      <h3 style={{ fontSize: '17px', fontWeight: 600, color: palette.text, margin: '0 0 6px', lineHeight: 1.3 }}>
        {analysis.title}
      </h3>

      {analysis.contextQuery && (
        <p style={{ fontSize: '12px', fontStyle: 'italic', color: palette.muted, margin: '0 0 8px', lineHeight: 1.5 }}>
          You asked: “{analysis.contextQuery}”
        </p>
      )}

      <p style={{ fontSize: '13.5px', lineHeight: 1.65, color: palette.text, margin: '0 0 12px', whiteSpace: 'pre-wrap' }}>
        {analysis.summary}
      </p>

      <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', alignItems: 'center' }}>
        <button
          type="button"
          onClick={() => setAsking((v) => !v)}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: '5px',
            fontFamily: "var(--v7-font-mono, 'IBM Plex Mono', monospace)", fontSize: '10.5px', letterSpacing: '0.02em',
            background: 'transparent', border: 'none', padding: 0, cursor: 'pointer',
            color: palette.teal, borderBottom: `1px solid ${palette.tealBorder}`,
          }}
        >
          <MessageSquare style={{ width: 11, height: 11 }} />
          {asking ? 'Hide Asher' : 'Analyze with Asher'}
        </button>

        {canOpenThread && (
          <button
            type="button"
            onClick={() => onOpenThread!(analysis)}
            style={{
              fontFamily: "var(--v7-font-mono, 'IBM Plex Mono', monospace)", fontSize: '10.5px', letterSpacing: '0.02em',
              background: 'transparent', border: 'none', padding: 0, cursor: 'pointer',
              color: palette.muted, borderBottom: '1px solid transparent',
            }}
          >
            Open original chat
          </button>
        )}
      </div>

      {asking && (
        <MiniVera
          analysis={analysis}
          palette={palette}
          isLight={isLight}
          onContinueInChat={onContinueInChat}
          onClose={() => setAsking(false)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The book
// ---------------------------------------------------------------------------

type Spread = { kind: 'index' } | { kind: 'type'; type: SavedAnalysisType };

export function SavedAnalysisBook({
  palette, isLight, onBack, onOpenThread, onContinueInChat,
}: {
  palette: BookPalette;
  isLight: boolean;
  onBack: () => void;
  onOpenThread?: (a: SavedAnalysis) => void;
  onContinueInChat: (messages: ChatMessage[]) => void;
}) {
  const [spread, setSpread] = useState<Spread>({ kind: 'index' });
  // Drives the turn animation. The incoming page is what animates; the key
  // change is what restarts it, so every turn re-runs the keyframe rather
  // than only the first.
  const [turnKey, setTurnKey] = useState(0);

  const saved = useMemo(() => getSavedAnalyses(), []);
  const byType = useMemo(() => {
    const groups = new Map<SavedAnalysisType, SavedAnalysis[]>();
    for (const s of saved) {
      const list = groups.get(s.type) ?? [];
      list.push(s);
      groups.set(s.type, list);
    }
    return groups;
  }, [saved]);

  const presentTypes = TYPE_ORDER.filter((t) => (byType.get(t)?.length ?? 0) > 0);

  const goTo = (next: Spread) => { setSpread(next); setTurnKey((k) => k + 1); };

  const pageStyle: CSSProperties = {
    background: palette.paper,
    border: `1px solid ${palette.paperEdge}`,
    borderRadius: '4px 14px 14px 4px',
    padding: '34px 40px 40px 52px',
    position: 'relative',
    boxShadow: '0 30px 60px -30px rgba(0,0,0,0.6)',
    transformOrigin: 'left center',
  };

  return (
    <div style={{ width: '100%', maxWidth: '640px', perspective: '1800px' }}>
      <button
        type="button"
        onClick={spread.kind === 'index' ? onBack : () => goTo({ kind: 'index' })}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: '6px',
          fontFamily: "var(--v7-font-mono, 'IBM Plex Mono', monospace)", fontSize: '12px', letterSpacing: '0.02em',
          color: palette.muted, background: 'none', border: 'none', padding: 0,
          marginBottom: '28px', cursor: 'pointer',
        }}
      >
        <ArrowLeft style={{ width: 12, height: 12 }} />
        {spread.kind === 'index' ? 'Back to the board' : 'Back to saved analysis'}
      </button>

      <div key={turnKey} className="venus-page-turn" style={pageStyle}>
        <div style={{ position: 'absolute', left: 34, top: 0, bottom: 0, width: 1, background: palette.marginRule }} />
        <div style={{ position: 'absolute', top: 0, right: 0, width: 0, height: 0, borderStyle: 'solid', borderWidth: '0 34px 34px 0', borderColor: `transparent ${palette.dogear} transparent transparent` }} />

        {spread.kind === 'index'
          ? <IndexPage palette={palette} isLight={isLight} saved={saved} byType={byType} presentTypes={presentTypes} onOpenType={(t) => goTo({ kind: 'type', type: t })} />
          : <TypePage
              palette={palette}
              isLight={isLight}
              type={spread.type}
              entries={byType.get(spread.type) ?? []}
              onOpenThread={onOpenThread}
              onContinueInChat={onContinueInChat}
            />}
      </div>
    </div>
  );
}

function IndexPage({
  palette, isLight, saved, byType, presentTypes, onOpenType,
}: {
  palette: BookPalette;
  isLight: boolean;
  saved: SavedAnalysis[];
  byType: Map<SavedAnalysisType, SavedAnalysis[]>;
  presentTypes: SavedAnalysisType[];
  onOpenType: (t: SavedAnalysisType) => void;
}) {
  return (
    <>
      {/* The highlighter sweep behind the heading is the one hand-made mark
          on the page — it's what makes this read as something the founder
          keeps rather than a generated list. */}
      <h1 style={{ fontSize: '30px', fontWeight: 500, margin: '0 0 4px', lineHeight: 1.2, display: 'inline-block', position: 'relative' }}>
        <span style={{ position: 'relative', zIndex: 1 }}>Saved Analysis</span>
        <span
          aria-hidden="true"
          style={{
            position: 'absolute', left: -4, right: -6, bottom: 2, height: '13px',
            background: palette.tealDim, borderRadius: '2px',
            transform: 'rotate(-0.6deg)', zIndex: 0,
          }}
        />
      </h1>

      <p style={{ fontFamily: "var(--v7-font-mono, 'IBM Plex Mono', monospace)", fontSize: '11.5px', color: palette.muted, letterSpacing: '0.01em', margin: '8px 0 18px' }}>
        HERE'S WHAT YOU SAVED FROM YOUR CHATS
      </p>

      <p style={{ fontSize: '14px', lineHeight: 1.7, color: palette.text, margin: '0 0 26px' }}>
        {saved.length === 0
          ? "Nothing saved yet. When Asher gives you something worth keeping, hit “Save as Analysis” under the response and it gets filed here by type."
          : `${saved.length} ${saved.length === 1 ? 'analysis' : 'analyses'} kept from your conversations, filed by what they're about. Pick a tab to read one back, ask Asher about it, or jump to the chat it came from.`}
      </p>

      {presentTypes.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {presentTypes.map((t) => {
            const color = typeColor(t, isLight);
            const count = byType.get(t)?.length ?? 0;
            return (
              <button
                key={t}
                type="button"
                onClick={() => onOpenType(t)}
                // Each row is the visible edge of the page behind this one,
                // with its sticky tab poking out past the right margin.
                style={{
                  position: 'relative',
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  width: '100%', textAlign: 'left', cursor: 'pointer',
                  background: palette.paper,
                  border: `1px solid ${palette.paperEdge}`,
                  borderLeft: `3px solid ${color}`,
                  borderRadius: '3px',
                  padding: '13px 16px',
                  boxShadow: `0 2px 0 0 ${palette.paperEdge}, 0 4px 0 0 ${palette.paper}`,
                }}
              >
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: '15px', fontWeight: 600, color: palette.text }}>{typeLabel(t)}</span>
                  <span style={{ display: 'block', fontFamily: "var(--v7-font-mono, 'IBM Plex Mono', monospace)", fontSize: '10px', color: palette.faint, marginTop: '2px', letterSpacing: '0.03em' }}>
                    {count} {count === 1 ? 'SAVED' : 'SAVED'}
                  </span>
                </span>
                <ArrowRight style={{ width: 14, height: 14, color, flexShrink: 0 }} />
                <span
                  aria-hidden="true"
                  style={{
                    position: 'absolute', right: -9, top: '50%', transform: 'translateY(-50%)',
                    width: 9, height: 26, background: color, borderRadius: '0 3px 3px 0',
                    boxShadow: '1px 1px 2px rgba(0,0,0,0.18)',
                  }}
                />
              </button>
            );
          })}
        </div>
      )}
    </>
  );
}

function TypePage({
  palette, isLight, type, entries, onOpenThread, onContinueInChat,
}: {
  palette: BookPalette;
  isLight: boolean;
  type: SavedAnalysisType;
  entries: SavedAnalysis[];
  onOpenThread?: (a: SavedAnalysis) => void;
  onContinueInChat: (messages: ChatMessage[]) => void;
}) {
  const color = typeColor(type, isLight);

  return (
    <>
      <h1 style={{ fontSize: '28px', fontWeight: 500, margin: '0 0 4px', lineHeight: 1.2, display: 'inline-block', position: 'relative' }}>
        <span style={{ position: 'relative', zIndex: 1 }}>{typeLabel(type)}</span>
        <span
          aria-hidden="true"
          style={{
            position: 'absolute', left: -4, right: -6, bottom: 2, height: '12px',
            background: color, opacity: isLight ? 0.18 : 0.24, borderRadius: '2px',
            transform: 'rotate(-0.5deg)', zIndex: 0,
          }}
        />
      </h1>

      <p style={{ fontFamily: "var(--v7-font-mono, 'IBM Plex Mono', monospace)", fontSize: '11px', color: palette.muted, letterSpacing: '0.02em', margin: '8px 0 4px' }}>
        {entries.length} {entries.length === 1 ? 'ANALYSIS' : 'ANALYSES'} SAVED
      </p>

      {/* Scrolls independently so a long type page doesn't push the page
          furniture (heading, back link) off the top of the board. */}
      <div style={{ maxHeight: '58vh', overflowY: 'auto', marginTop: '10px' }}>
        {entries.map((a) => (
          <AnalysisEntry
            key={a.id}
            analysis={a}
            palette={palette}
            isLight={isLight}
            onOpenThread={onOpenThread}
            onContinueInChat={onContinueInChat}
          />
        ))}
      </div>
    </>
  );
}
