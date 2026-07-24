import { useState } from 'react';
import { Reply, Megaphone, FileText, Send, Copy, Check, Inbox, Linkedin } from 'lucide-react';
import { useRunInstantAction, type InstantActionType } from '../lib/venusApi';

// Zero-onboarding by design: pick an action, paste one thing in, get one
// result back. No multi-step wizard, no explainer — the two output buttons
// ARE the entire interaction surface (see section 3 of the build plan:
// "action -> result", instant copy-paste OR sent to the queue as a pending
// item, per attempt rather than a fixed setting per action type).
const ACTIONS: { type: InstantActionType; label: string; placeholder: string; Icon: typeof Reply }[] = [
  { type: 'draft_reply', label: 'Draft a reply', placeholder: 'Paste the message you got…', Icon: Reply },
  { type: 'sell_this', label: 'Sell this', placeholder: 'Describe what you’re selling…', Icon: Megaphone },
  { type: 'summarize', label: 'Summarize', placeholder: 'Paste the text to summarize…', Icon: FileText },
  { type: 'follow_up', label: 'Follow up', placeholder: 'Who/what is this following up on…', Icon: Send },
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
        <div className="flex flex-wrap gap-1.5">
          {ACTIONS.map(({ type, label, Icon }) => (
            <button
              key={type}
              onClick={() => setActive(type)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-medium"
              style={{ background: 'var(--v7-bg-raised)', color: 'var(--v7-text-dim)' }}
            >
              <Icon className="w-3.5 h-3.5" style={{ color: 'var(--v7-cyan)' }} />
              {label}
            </button>
          ))}
        </div>
      ) : (
        <ActionForm type={activeMeta.type} placeholder={activeMeta.placeholder} onClose={() => setActive(null)} />
      )}
    </div>
  );
}
