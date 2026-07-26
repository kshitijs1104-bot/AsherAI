import { useState } from 'react';
import { Reply, Crosshair, FileText, Send, Copy, Check, Inbox, Linkedin } from 'lucide-react';
import { useRunInstantAction, type InstantActionType } from '../lib/venusApi';

// Zero-onboarding by design: pick an action, paste one thing in, get one
// result back. No multi-step wizard, no explainer.
//
// Labels state what you get back, not a verb phrase you have to interpret.
// "Sell this" in particular said nothing — a founder could not tell whether it
// wrote a landing page, an email, a pitch or a tweet, and generic marketing
// copy is the weakest possible thing for a causal-analysis product to offer.
// It now maps to the one instant action that is actually Vera's job: hand it a
// plan you're about to commit to and it tries to break it. Each entry also
// carries a one-line `hint` so the grid explains itself without a tooltip.
const ACTIONS: {
  type: InstantActionType;
  label: string;
  hint: string;
  placeholder: string;
  Icon: typeof Reply;
}[] = [
  {
    type: 'sell_this',
    label: 'Pressure-test it',
    hint: 'The strongest reason this is wrong, and the cheapest test to find out',
    placeholder: "The plan or assumption you're about to commit to…",
    Icon: Crosshair,
  },
  {
    type: 'summarize',
    label: 'Cut to the point',
    hint: 'A long thread, doc or report down to what actually matters',
    placeholder: 'Paste the thread, doc or report…',
    Icon: FileText,
  },
  {
    type: 'draft_reply',
    label: 'Draft a reply',
    hint: 'A short, direct response to something in your inbox',
    placeholder: 'Paste the message you need to answer…',
    Icon: Reply,
  },
  {
    type: 'follow_up',
    label: 'Restart a thread',
    hint: 'A low-pressure nudge for a deal or intro that went quiet',
    placeholder: 'Who went quiet, and what it was about…',
    Icon: Send,
  },
];

function ActionForm({ type, placeholder, onClose }: { type: InstantActionType; placeholder: string; onClose: () => void }) {
  const [input, setInput] = useState('');
  const [result, setResult] = useState<string | null>(null);
  const [queued, setQueued] = useState(false);
  const [copied, setCopied] = useState(false);
  const run = useRunInstantAction();

  const handleRun = (mode: 'instant' | 'queue', postTo?: 'linkedin') => {
    if (!input.trim()) return;
    run.mutate(
      { type, input: input.trim(), mode, postTo },
      {
        onSuccess: (data) => {
          if (mode === 'instant') setResult(data.result ?? null);
          else setQueued(true);
        },
      },
    );
  };

  const handleCopy = async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };

  if (queued) {
    return (
      <div className="rounded-xl p-4 flex items-center gap-2.5 text-[13px]" style={{ background: 'var(--v7-bg-raised)', color: 'var(--v7-text-dim)' }}>
        <Inbox className="w-4 h-4 shrink-0" style={{ color: 'var(--v7-cyan)' }} />
        Sent to your queue — review it in Command Center.
        <button onClick={onClose} className="ml-auto text-[11.5px] font-semibold" style={{ color: 'var(--v7-cyan)' }}>Done</button>
      </div>
    );
  }

  if (result) {
    return (
      <div className="rounded-xl p-4" style={{ background: 'var(--v7-bg-raised)' }}>
        <div className="text-[12.5px] whitespace-pre-wrap mb-3" style={{ color: 'var(--v7-text)' }}>{result}</div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={handleCopy}
            className="flex items-center gap-1 text-[11.5px] font-semibold px-2.5 py-1.5 rounded-md"
            style={{ background: 'var(--v7-cyan-soft)', border: '1px solid var(--v7-cyan-strong)', color: 'var(--v7-cyan)' }}
          >
            {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
            {copied ? 'Copied' : 'Copy'}
          </button>
          <button onClick={onClose} className="text-[11.5px] font-medium px-2.5 py-1.5" style={{ color: 'var(--v7-text-mute)' }}>
            Close
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl p-4" style={{ background: 'var(--v7-bg-raised)' }}>
      <textarea
        autoFocus
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder={placeholder}
        rows={3}
        className="w-full text-[12.5px] rounded-lg p-2.5 outline-none mb-2.5"
        style={{ background: 'var(--v7-bg-raised-2)', color: 'var(--v7-text)', border: '1px solid var(--v7-border, rgba(255,255,255,0.08))' }}
      />
      <div className="flex items-center gap-1.5">
        <button
          disabled={!input.trim() || run.isPending}
          onClick={() => handleRun('instant')}
          className="text-[11.5px] font-semibold px-2.5 py-1.5 rounded-md"
          style={{ background: 'var(--v7-cyan-soft)', border: '1px solid var(--v7-cyan-strong)', color: 'var(--v7-cyan)' }}
        >
          {run.isPending ? 'Working…' : 'Get result'}
        </button>
        <button
          disabled={!input.trim() || run.isPending}
          onClick={() => handleRun('queue')}
          className="text-[11.5px] font-medium px-2.5 py-1.5 rounded-md"
          style={{ border: '1px solid var(--v7-border, rgba(255,255,255,0.08))', color: 'var(--v7-text-dim)' }}
        >
          Send to queue instead
        </button>
        {type === 'sell_this' && (
          <button
            disabled={!input.trim() || run.isPending}
            onClick={() => handleRun('queue', 'linkedin')}
            title="Drafts it, then publishes once you accept it in Command Center"
            className="flex items-center gap-1 text-[11.5px] font-medium px-2.5 py-1.5 rounded-md"
            style={{ border: '1px solid var(--v7-border, rgba(255,255,255,0.08))', color: 'var(--v7-text-dim)' }}
          >
            <Linkedin className="w-3 h-3" />
            Draft for LinkedIn
          </button>
        )}
        <button onClick={onClose} className="text-[11.5px] ml-auto" style={{ color: 'var(--v7-text-mute)' }}>
          Cancel
        </button>
      </div>
      {run.isError && (
        <div className="text-[11px] mt-2" style={{ color: 'var(--red, #e5555c)' }}>
          {run.error instanceof Error ? run.error.message : 'Failed — try again.'}
        </div>
      )}
    </div>
  );
}

export function QuickActions() {
  const [active, setActive] = useState<InstantActionType | null>(null);
  const activeMeta = ACTIONS.find((a) => a.type === active);

  return (
    <div className="mb-7">
      <div
        className="text-[10.5px] font-bold uppercase px-0.5 pb-2.5"
        style={{ color: 'var(--v7-text-mute)', fontFamily: 'var(--v7-font-mono)', letterSpacing: '0.07em' }}
      >
        Quick actions
      </div>

      {!activeMeta ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {ACTIONS.map(({ type, label, hint, Icon }) => (
            <button
              key={type}
              onClick={() => setActive(type)}
              className="vera-block text-left transition-colors"
              onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'var(--v7-cyan-strong)')}
              onMouseLeave={(e) => (e.currentTarget.style.borderColor = '')}
            >
              <span className="flex items-center gap-2 text-[13px] font-semibold" style={{ color: 'var(--v7-text)' }}>
                <Icon className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--v7-cyan)' }} />
                {label}
              </span>
              <span className="block mt-1 text-[11.5px] leading-snug" style={{ color: 'var(--v7-text-mute)' }}>
                {hint}
              </span>
            </button>
          ))}
        </div>
      ) : (
        <ActionForm type={activeMeta.type} placeholder={activeMeta.placeholder} onClose={() => setActive(null)} />
      )}
    </div>
  );
}
