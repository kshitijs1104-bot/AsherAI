import { useRef, useState } from 'react';
import { Copy, Check, Loader2, Send, Sparkles, X } from 'lucide-react';
import { useVenusAnalyze } from '@workspace/api-client-react';
import { usePublishDraft, useConnectors } from '../lib/venusApi';

// When Vera writes something the founder is going to USE — a LinkedIn post,
// an email, a Slack message — the answer isn't advice to read, it's text to
// ship. Rendering it as ordinary chat prose meant the only way to act on it
// was to select it by hand out of a chat bubble, paste it somewhere else,
// edit it there, and come back if it needed another pass. This turns that
// response into a working surface: a copyable text file, revision scoped to
// whatever the founder highlights, and (where the connector can actually
// accept it) a way out.

export type DraftChannel = 'linkedin' | 'email' | 'slack' | 'whatsapp' | 'social' | 'generic';

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
  whatsapp: {
    filename: 'whatsapp-message.txt',
    label: 'WhatsApp message',
    publishable: false,
    connector: 'whatsapp',
    unavailableNote: 'Sending needs a recipient this draft doesn’t carry yet — copy it across for now.',
  },
  social: { filename: 'post.txt', label: 'Post', publishable: false },
  generic: { filename: 'draft.txt', label: 'Draft', publishable: false },
};

// Both halves have to be true for this to be a draft: the founder asked for
// something to be WRITTEN, and there's something identifiable being written.
// "What should I post about this quarter?" is strategy advice and stays
// prose; "write me a LinkedIn post about the raise" is a draft. Deliberately
// conservative — a false positive turns an ordinary answer into a text-file
// UI, which is far more jarring than a missed one.
const WRITE_INTENT = /\b(draft|write|compose|rewrite|reword|word|caption|script)\b/i;

const CHANNEL_PATTERNS: { channel: DraftChannel; test: RegExp }[] = [
  { channel: 'linkedin', test: /\blinked\s?-?in\b/i },
  { channel: 'email', test: /\b(e-?mails?|gmail|inbox|newsletter)\b/i },
  { channel: 'slack', test: /\bslack\b/i },
  { channel: 'whatsapp', test: /\bwhats\s?-?app\b/i },
  { channel: 'social', test: /\b(twitter|tweet|thread|instagram|x post)\b/i },
];

// Anything long enough to be worth refining rather than retyping. Kept as an
// explicit noun list rather than "any long answer" because the intent verbs
// above appear innocently in plenty of strategy questions ("should I write
// off this customer") where a document UI would be wrong.
const DRAFTABLE_NOUN = /\b(post|message|reply|note|announcement|memo|proposal|pitch|outreach|blurb|bio|description|copy|update|script|letter|dm)\b/i;

export function detectDraftChannel(contextQuery: string | undefined, summary: string | undefined): DraftChannel | null {
  if (!contextQuery || !summary) return null;
  if (!WRITE_INTENT.test(contextQuery)) return null;

  // A one-liner is an answer about writing, not the written thing.
  if (summary.trim().length < 120) return null;

  const match = CHANNEL_PATTERNS.find((p) => p.test.test(contextQuery));
  if (match) return match.channel;

  return DRAFTABLE_NOUN.test(contextQuery) ? 'generic' : null;
}

type Selection = { start: number; end: number; top: number; left: number };

export function DraftWorkspace({ initialText, channel, onTextChange }: {
  initialText: string;
  channel: DraftChannel;
  // Lets the chat persist a refined draft back onto the message, so edits
  // survive a reload instead of living only in this component's state.
  onTextChange?: (next: string) => void;
}) {
  const meta = CHANNEL_META[channel];
  const [text, setText] = useState(initialText);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [refineInput, setRefineInput] = useState('');
  const [copied, setCopied] = useState(false);
  const [confirmingPublish, setConfirmingPublish] = useState(false);

  const bodyRef = useRef<HTMLDivElement | null>(null);
  const refine = useVenusAnalyze();
  const publish = usePublishDraft();
  const { data: connectorData } = useConnectors();

  const connected = meta.connector
    ? connectorData?.connectors.find((c) => c.type === meta.connector)?.status === 'connected'
    : false;

  const selectedText = selection ? text.slice(selection.start, selection.end) : '';

  // Reads the browser's own selection rather than making lines clickable.
  // Click-to-select-a-line looked fine in a mockup and was wrong in practice:
  // a LinkedIn post is one long wrapped paragraph, so "select the line"
  // underlined the entire draft and scoped every refinement to all of it.
  // Highlighting is what people already do to point at a phrase.
  //
  // Offsets are measured against the container's textContent, which is why
  // the body renders as ONE pre-wrap node — splitting it into per-line
  // elements would drop the newlines from textContent and skew every offset
  // after the first line break.
  const captureSelection = () => {
    const sel = window.getSelection();
    const container = bodyRef.current;
    if (!sel || sel.isCollapsed || sel.rangeCount === 0 || !container) return;

    const range = sel.getRangeAt(0);
    if (!container.contains(range.startContainer) || !container.contains(range.endContainer)) return;
    if (!range.toString().trim()) return;

    const prefix = document.createRange();
    prefix.selectNodeContents(container);
    prefix.setEnd(range.startContainer, range.startOffset);
    const start = prefix.toString().length;
    const end = start + range.toString().length;

    const rect = range.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();

    setSelection({
      start,
      end,
      top: rect.bottom - containerRect.top + 8,
      // Clamped so the popover can't hang off the left edge of the card or
      // push past its right edge on a narrow viewport.
      left: Math.max(0, Math.min(rect.left - containerRect.left, containerRect.width - 300)),
    });
  };

  const clearSelection = () => {
    setSelection(null);
    setRefineInput('');
    window.getSelection()?.removeAllRanges();
  };

  const copy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    }).catch(() => {});
  };

  // Sends the WHOLE draft plus the quoted selection, and asks for the whole
  // draft back. Asking only for the changed span would mean splicing a reply
  // into the middle of the text and hoping the seams matched.
  const runRefine = () => {
    const instruction = refineInput.trim();
    if (!instruction || refine.isPending) return;

    const scope = selectedText
      ? `Change only this part:\n"""\n${selectedText}\n"""\n\nLeave the rest of the draft exactly as it is.`
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
            clearSelection();
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

      <div className="relative">
        {/* One pre-wrap node, not per-line elements — see captureSelection.
            Only the highlighted span is marked, so the draft reads as plain
            text until the founder points at something. */}
        <div
          ref={bodyRef}
          onMouseUp={captureSelection}
          onTouchEnd={captureSelection}
          onKeyUp={captureSelection}
          className="px-3.5 py-3 text-[13.5px] leading-[1.75] font-mono"
          style={{ color: 'var(--v7-text)', whiteSpace: 'pre-wrap' }}
        >
          {selection ? (
            <>
              {text.slice(0, selection.start)}
              <mark
                style={{
                  background: 'var(--v7-cyan-soft)',
                  color: 'var(--v7-text)',
                  textDecoration: 'underline',
                  textDecorationColor: 'var(--v7-cyan)',
                  textDecorationThickness: '2px',
                  textUnderlineOffset: '3px',
                  borderRadius: '2px',
                }}
              >
                {text.slice(selection.start, selection.end)}
              </mark>
              {text.slice(selection.end)}
            </>
          ) : text}
        </div>

        {/* Refine popover — only exists while something is highlighted. It
            used to be a permanent bar under every draft, which meant the
            most common state (just reading the thing) carried a form nobody
            had asked for. */}
        {selection && (
          <div
            className="absolute z-20 rounded-xl p-3"
            style={{
              top: selection.top,
              left: selection.left,
              width: 300,
              background: 'var(--v7-bg-raised-2)',
              border: '1px solid var(--v7-cyan)',
              boxShadow: '0 12px 30px -12px rgba(0,0,0,0.55)',
            }}
          >
            <div className="flex items-center justify-between mb-2">
              <span className="inline-flex items-center gap-1.5 text-[10px] font-mono" style={{ color: 'var(--v7-cyan)', letterSpacing: '0.04em' }}>
                <Sparkles className="w-3 h-3" /> REFINE SELECTION
              </span>
              <button
                type="button"
                onClick={clearSelection}
                style={{ background: 'none', border: 'none', color: 'var(--v7-text-mute)', lineHeight: 0 }}
                title="Cancel"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            <p
              className="text-[11px] mb-2 line-clamp-2"
              style={{ color: 'var(--v7-text-mute)', fontStyle: 'italic' }}
            >
              “{selectedText.length > 70 ? `${selectedText.slice(0, 70)}…` : selectedText}”
            </p>

            <textarea
              autoFocus
              value={refineInput}
              onChange={(e) => setRefineInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); runRefine(); }
                if (e.key === 'Escape') clearSelection();
              }}
              placeholder="What would you like to change?"
              rows={2}
              className="w-full rounded-lg px-2.5 py-2 text-[12.5px] outline-none resize-none mb-2"
              style={{ background: 'var(--v7-bg-raised)', border: '1px solid var(--v7-border)', color: 'var(--v7-text)' }}
            />

            <button
              type="button"
              onClick={runRefine}
              disabled={!refineInput.trim() || refine.isPending}
              className="w-full rounded-lg py-1.5 text-[11px] font-mono font-semibold disabled:opacity-40 inline-flex items-center justify-center gap-1.5"
              style={{ background: 'var(--v7-cyan)', color: 'var(--v7-bg)', border: 'none' }}
            >
              {refine.isPending ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Refining…</> : 'Refine'}
            </button>

            {refine.isError && (
              <p className="text-[11px] mt-2" style={{ color: 'var(--red)' }}>
                {refine.error instanceof Error ? refine.error.message : 'That refinement failed — try again.'}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Footer: the one-line hint that replaces the old permanent form, plus
          the send affordance where there is one. */}
      <div style={{ borderTop: '1px solid var(--v7-border)', padding: '9px 14px' }}>
        {!selection && (
          <p className="text-[11px] mb-0" style={{ color: 'var(--v7-text-mute)' }}>
            Highlight any word or sentence to refine just that part.
          </p>
        )}

        {(meta.publishable || meta.unavailableNote) && (
          <div style={{ marginTop: selection ? 0 : 8 }}>
            {!meta.publishable ? (
              <p className="text-[11px]" style={{ color: 'var(--v7-text-mute)' }}>{meta.unavailableNote}</p>
            ) : !connected ? (
              <p className="text-[11px]" style={{ color: 'var(--v7-text-mute)' }}>
                Connect LinkedIn in Settings → Connectors to publish straight from here.
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
    </div>
  );
}
