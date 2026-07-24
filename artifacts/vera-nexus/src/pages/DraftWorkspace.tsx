import { useMemo, useState } from 'react';
import { Copy, Check, Loader2, Send, Sparkles } from 'lucide-react';
import { useVenusAnalyze } from '@workspace/api-client-react';
import { usePublishDraft, useConnectors } from '../lib/venusApi';

// When Vera writes something the founder is going to USE — a LinkedIn post,
// an email, a Slack message — the answer isn't advice to read, it's text to
// ship. Rendering it as ordinary chat prose meant the only way to act on it
// was to select it by hand out of a chat bubble, paste it somewhere else,
// edit it there, and come back if it needed another pass. This turns that
// response into a working surface: a copyable text file, line-level
// revision, and (where the connector can actually accept it) a way out.

export type DraftChannel = 'linkedin' | 'email' | 'slack' | 'generic';

type ChannelMeta = {
  filename: string;
  label: string;
  // Only LinkedIn can publish a from-scratch draft — Gmail's client can only
  // draft a reply into an existing thread and Slack's needs a channel id, so
  // for those the workspace says what it can't do instead of showing a button
  // that fails. See lib/connectors/sendAction.ts.
  publishable: boolean;
  connector?: string;
  sendLabel?: string;
  unavailableNote?: string;
};

const CHANNEL_META: Record<DraftChannel, ChannelMeta> = {
  linkedin: {
    filename: 'linkedin-post.txt',
    label: 'LinkedIn post',
    publishable: true,
    connector: 'linkedin',
    sendLabel: 'Upload draft to LinkedIn',
  },
  email: {
    filename: 'email-draft.txt',
    label: 'Email',
    publishable: false,
    connector: 'gmail',
    unavailableNote: 'Vera can only put drafts into an existing Gmail thread, so this one is copy-and-paste for now.',
  },
  slack: {
    filename: 'slack-message.txt',
    label: 'Slack message',
    publishable: false,
    connector: 'slack',
    unavailableNote: 'Sending needs a channel to post into, which this draft doesn’t carry yet — copy it across for now.',
  },
  generic: { filename: 'draft.txt', label: 'Draft', publishable: false },
};

// Both halves have to be true for this to be a draft: the founder asked for
// something to be WRITTEN, and there's a channel it's written for. "What
// should I post about this quarter?" is strategy advice and stays prose;
// "write me a LinkedIn post about the raise" is a draft. Deliberately
// conservative — a false positive turns an ordinary answer into a
// text-file UI, which is far more jarring than a missed one.
const WRITE_INTENT = /\b(draft|write|compose|rewrite|reword|word|caption)\b/i;

const CHANNEL_PATTERNS: { channel: DraftChannel; test: RegExp }[] = [
  { channel: 'linkedin', test: /\blinked\s?-?in\b/i },
  { channel: 'email', test: /\b(e-?mails?|gmail|inbox)\b/i },
  { channel: 'slack', test: /\bslack\b/i },
];

export function detectDraftChannel(contextQuery: string | undefined, summary: string | undefined): DraftChannel | null {
  if (!contextQuery || !summary) return null;
  if (!WRITE_INTENT.test(contextQuery)) return null;

  // A one-liner is an answer about writing, not the written thing.
  if (summary.trim().length < 120) return null;

  const match = CHANNEL_PATTERNS.find((p) => p.test.test(contextQuery));
  if (match) return match.channel;

  // "draft a post/message/reply" with no named channel still produces
  // something to copy, just with nowhere specific to send it.
  return /\b(post|message|reply|note|announcement)\b/i.test(contextQuery) ? 'generic' : null;
}

export function DraftWorkspace({ initialText, channel, onTextChange }: {
  initialText: string;
  channel: DraftChannel;
  // Lets the chat persist a refined draft back onto the message, so edits
  // survive a reload instead of living only in this component's state.
  onTextChange?: (next: string) => void;
}) {
  const meta = CHANNEL_META[channel];
  const [text, setText] = useState(initialText);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [refineInput, setRefineInput] = useState('');
  const [copied, setCopied] = useState(false);
  const [confirmingPublish, setConfirmingPublish] = useState(false);

  const refine = useVenusAnalyze();
  const publish = usePublishDraft();
  const { data: connectorData } = useConnectors();

  const lines = useMemo(() => text.split('\n'), [text]);
  const connected = meta.connector
    ? connectorData?.connectors.find((c) => c.type === meta.connector)?.status === 'connected'
    : false;

  const toggleLine = (i: number) => {
    if (!lines[i]?.trim()) return; // blank spacer lines aren't selectable
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(i) ? next.delete(i) : next.add(i);
      return next;
    });
  };

  const copy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    }).catch(() => {});
  };

  // Sends the WHOLE draft plus the quoted selection, and asks for the whole
  // draft back. Asking only for the changed lines would mean stitching a
  // reply into the middle of the text and hoping the seams matched.
  const runRefine = () => {
    const instruction = refineInput.trim();
    if (!instruction || refine.isPending) return;

    const selectedText = [...selected].sort((a, b) => a - b).map((i) => lines[i]).join('\n');
    const scope = selectedText
      ? `Change only this part:\n"""\n${selectedText}\n"""\n\nLeave the rest of the draft as it is.`
      : 'Apply the change across the whole draft.';

    const prompt = [
      `Here is a ${meta.label.toLowerCase()} draft:`,
      '"""', text, '"""',
      '',
      scope,
      '',
      `What to change: ${instruction}`,
      '',
      'Reply with the complete revised draft and nothing else — no preamble, no explanation, no surrounding quotes.',
    ].join('\n');

    refine.mutate(
      { data: { message: prompt } },
      {
        onSuccess: (res) => {
          if (res.summary?.trim()) {
            const next = res.summary.trim();
            setText(next);
            onTextChange?.(next);
            setSelected(new Set());
            setRefineInput('');
          }
        },
      },
    );
  };

  const doPublish = () => {
    if (!confirmingPublish) { setConfirmingPublish(true); return; }
    publish.mutate({ channel: 'linkedin', content: text }, { onSuccess: () => setConfirmingPublish(false) });
  };

  return (
    <div
      className="rounded-xl overflow-hidden mb-3"
      style={{ background: 'var(--v7-bg-raised)', border: '1px solid var(--v7-border-strong)' }}
    >
      {/* File header — the visual promise that this is a document, not chat */}
      <div
        className="flex items-center justify-between px-3.5 py-2"
        style={{ borderBottom: '1px solid var(--v7-border)', background: 'var(--v7-bg-raised-2)' }}
      >
        <span className="text-[11px] font-mono truncate" style={{ color: 'var(--v7-text-mute)', letterSpacing: '0.03em' }}>
          {meta.filename}
        </span>
        <button
          type="button"
          onClick={copy}
          className="inline-flex items-center gap-1.5 text-[10.5px] font-mono shrink-0"
          style={{ color: copied ? 'var(--mint)' : 'var(--v7-text-mute)', background: 'none', border: 'none', letterSpacing: '0.03em' }}
        >
          {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>

      {/* The draft itself. Every non-blank line is a click target; selected
          lines underline, which is the cue that they're what a refinement
          will apply to. */}
      <div className="px-3.5 py-3 text-[13.5px] leading-[1.75] font-mono" style={{ color: 'var(--v7-text)', whiteSpace: 'pre-wrap' }}>
        {lines.map((line, i) => {
          const isBlank = !line.trim();
          const isSelected = selected.has(i);
          if (isBlank) return <div key={i} style={{ height: '0.9em' }} />;
          return (
            <div
              key={i}
              onClick={() => toggleLine(i)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleLine(i); } }}
              className="transition-colors rounded px-1 -mx-1"
              style={{
                cursor: 'pointer',
                textDecoration: isSelected ? 'underline' : 'none',
                textDecorationColor: 'var(--v7-cyan)',
                textDecorationThickness: '2px',
                textUnderlineOffset: '3px',
                background: isSelected ? 'var(--v7-cyan-soft)' : 'transparent',
              }}
              onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = 'var(--v7-bg-raised-2)'; }}
              onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = 'transparent'; }}
            >
              {line}
            </div>
          );
        })}
      </div>

      {/* Refine bar */}
      <div style={{ borderTop: '1px solid var(--v7-border)', padding: '10px 14px', background: 'var(--v7-bg-raised-2)' }}>
        <div className="flex items-center gap-1.5 mb-2">
          <Sparkles className="w-3 h-3" style={{ color: 'var(--v7-cyan)' }} />
          <span className="text-[10.5px] font-mono" style={{ color: 'var(--v7-text-mute)', letterSpacing: '0.03em' }}>
            {selected.size > 0
              ? `REFINE ${selected.size} SELECTED ${selected.size === 1 ? 'LINE' : 'LINES'}`
              : 'WHAT WOULD YOU LIKE TO REFINE?'}
          </span>
        </div>

        {selected.size === 0 && (
          <p className="text-[11px] mb-2" style={{ color: 'var(--v7-text-mute)' }}>
            Click any line to target it, or just describe a change to apply to the whole draft.
          </p>
        )}

        <div className="flex gap-2 items-end">
          <textarea
            value={refineInput}
            onChange={(e) => setRefineInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); runRefine(); } }}
            placeholder="Make it shorter, drop the last line, add a stat…"
            rows={2}
            className="flex-1 rounded-lg px-2.5 py-2 text-[12.5px] outline-none resize-none"
            style={{ background: 'var(--v7-bg-raised)', border: '1px solid var(--v7-border)', color: 'var(--v7-text)' }}
          />
          <button
            type="button"
            onClick={runRefine}
            disabled={!refineInput.trim() || refine.isPending}
            className="shrink-0 rounded-lg px-3 py-2 text-[11px] font-mono font-semibold disabled:opacity-40"
            style={{ background: 'var(--v7-cyan)', color: 'var(--v7-bg)', border: 'none' }}
          >
            {refine.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Refine'}
          </button>
        </div>

        {refine.isError && (
          <p className="text-[11px] mt-2" style={{ color: 'var(--red)' }}>
            {refine.error instanceof Error ? refine.error.message : 'That refinement failed — try again.'}
          </p>
        )}
      </div>

      {/* Send */}
      {(meta.publishable || meta.unavailableNote) && (
        <div style={{ borderTop: '1px solid var(--v7-border)', padding: '10px 14px' }}>
          {!meta.publishable ? (
            <p className="text-[11px]" style={{ color: 'var(--v7-text-mute)' }}>{meta.unavailableNote}</p>
          ) : !connected ? (
            <p className="text-[11px]" style={{ color: 'var(--v7-text-mute)' }}>
              Connect {meta.label.split(' ')[0]} in Settings → Connectors to publish straight from here.
            </p>
          ) : publish.isSuccess ? (
            <p className="text-[11.5px] inline-flex items-center gap-1.5" style={{ color: 'var(--mint)' }}>
              <Check className="w-3.5 h-3.5" /> Published to LinkedIn.
            </p>
          ) : (
            <div className="flex items-center gap-3 flex-wrap">
              <button
                type="button"
                onClick={doPublish}
                disabled={publish.isPending}
                className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11.5px] font-semibold disabled:opacity-50"
                style={{
                  background: confirmingPublish ? 'var(--v7-pink)' : 'transparent',
                  color: confirmingPublish ? 'var(--v7-bg)' : 'var(--v7-cyan)',
                  border: `1px solid ${confirmingPublish ? 'var(--v7-pink)' : 'var(--v7-cyan)'}`,
                }}
              >
                {publish.isPending
                  ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Publishing…</>
                  : <><Send className="w-3.5 h-3.5" /> {confirmingPublish ? 'Yes, publish it' : meta.sendLabel}</>}
              </button>

              {confirmingPublish && !publish.isPending && (
                <>
                  <span className="text-[11px]" style={{ color: 'var(--amber)' }}>
                    This posts publicly to your LinkedIn.
                  </span>
                  <button
                    type="button"
                    onClick={() => setConfirmingPublish(false)}
                    className="text-[11px] font-mono"
                    style={{ background: 'none', border: 'none', color: 'var(--v7-text-mute)' }}
                  >
                    Cancel
                  </button>
                </>
              )}
            </div>
          )}

          {publish.isError && (
            <p className="text-[11px] mt-2" style={{ color: 'var(--red)' }}>
              {publish.error instanceof Error ? publish.error.message : 'Publishing failed — try again.'}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
