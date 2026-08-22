import { useMemo, useRef, useState, type CSSProperties } from 'react';
import { useLocation } from 'wouter';
import { prefStorage } from '../lib/cookieConsent';
import {
  ArrowLeft, ArrowRight, Flame, X, Send, PlugZap, Check,
  Mail, MessageSquare, FileSpreadsheet, NotebookText, Ticket, Linkedin, Plug,
} from 'lucide-react';
import { SavedAnalysisBook, typeColor as savedTypeColor, TYPE_ORDER as SAVED_TYPE_ORDER } from './SavedAnalysisBook';
import { ActivityWeek } from './ActivityWeek';
import { getSavedAnalyses, typeLabel, type SavedAnalysis, type SavedAnalysisType, type ChatMessage } from '../lib/venusHistory';
import {
  useQueue, useQueueAction, useDailyBrief, useRunInstantAction, useConnectors, useDecisions,
  startConnectorAuth,
  type QueueItem, type InstantActionType, type DailyBriefStats, type ConnectorStatus,
} from '../lib/venusApi';
import type { VenusTheme } from '../lib/venusTheme';
import { useVeraSkin } from '../lib/veraSkin';

// "OS" — the operational home Vera opens INTO the same view New Chat opens
// into (see Venus.tsx's mainView state), never a separate route/page. The
// visual language here is deliberately its own thing, not the rest of
// Venus's cyan/indigo chat chrome — a warm, paper/notebook aesthetic (per
// the founder's own mockup) so this reads as "the durable record of what
// Vera's been doing," distinct from the ephemeral chat thread. Renamed
// Blackboard (dark)/Whiteboard (light) rather than "notebook" — still one
// physical object, just the surface founders actually write status updates
// on, which is closer to what this page is.
// These were flat hex literals, which made the board the one surface in the
// product that CSS could not reach: it opted out of the theme system entirely
// and had to be edited by hand whenever the palette moved. Each value is now
// a CSS custom property with the ORIGINAL hex as its fallback, which does two
// things at once — a skin (see index.css) can restyle the board by defining
// the variables, and with no skin selected every fallback fires and the board
// renders exactly the colours it always did, byte for byte.
//
// The board sits inside Venus.tsx's root, which carries `.v7-light` in light
// mode, so the variables already resolve per-theme on their own. The two
// objects below are kept because the component still picks between them by
// theme, and because the fallbacks — the classic values — genuinely differ.
const DARK = {
  bg: 'var(--vera-cc-bg, #0a0d12)',
  paper: 'var(--vera-cc-paper, #11151d)',
  paperEdge: 'var(--vera-cc-paper-edge, #1c212c)',
  line: 'var(--vera-cc-line, rgba(255,255,255,0.07))',
  text: 'var(--vera-cc-text, #e7e9ee)',
  muted: 'var(--vera-cc-muted, #7c8494)',
  faint: 'var(--vera-cc-faint, #4b5261)',
  teal: 'var(--vera-cc-accent, #33d2ac)',
  tealDim: 'var(--vera-cc-accent-dim, rgba(51,210,172,0.14))',
  tealBorder: 'var(--vera-cc-accent-border, rgba(51,210,172,0.3))',
  coral: 'var(--vera-cc-second, #d97a63)',
  coralDim: 'var(--vera-cc-second-dim, rgba(217,122,99,0.14))',
  coralBorder: 'var(--vera-cc-second-border, rgba(217,122,99,0.3))',
  marginRule: 'var(--vera-cc-rule, rgba(217,122,99,0.35))',
  dogear: 'var(--vera-cc-dogear, #0a0d12)',
};
// `faint` carries the timestamp/source line on every row and was #a89d84 on
// #fffdf7 — 2.64:1 measured, less than half the AA floor, so the one piece
// of text saying WHERE an item came from was the hardest thing on the board
// to read. Now 4.55:1, with `muted` at 7.02:1. Matches the contrast pass in
// index.css's .v7-light.
const LIGHT = {
  bg: 'var(--vera-cc-bg, #efe9dc)',
  paper: 'var(--vera-cc-paper, #fffdf7)',
  paperEdge: 'var(--vera-cc-paper-edge, #ddd3bb)',
  line: 'var(--vera-cc-line, rgba(25,20,10,0.12))',
  text: 'var(--vera-cc-text, #1c1913)',
  muted: 'var(--vera-cc-muted, #5f5747)',
  faint: 'var(--vera-cc-faint, #7d7460)',
  teal: 'var(--vera-cc-accent, #0b7a61)',
  tealDim: 'var(--vera-cc-accent-dim, rgba(11,122,97,0.14))',
  tealBorder: 'var(--vera-cc-accent-border, rgba(11,122,97,0.38))',
  coral: 'var(--vera-cc-second, #8f4325)',
  coralDim: 'var(--vera-cc-second-dim, rgba(143,67,37,0.12))',
  coralBorder: 'var(--vera-cc-second-border, rgba(143,67,37,0.34))',
  marginRule: 'var(--vera-cc-rule, rgba(143,67,37,0.38))',
  dogear: 'var(--vera-cc-dogear, #efe9dc)',
};

type Palette = typeof DARK;

const SOURCE_LABEL: Record<string, string> = {
  gmail: 'GMAIL', slack: 'SLACK', sheets: 'SHEETS', calendar: 'CALENDAR', notion: 'NOTION',
  jira: 'JIRA', linkedin: 'LINKEDIN', whatsapp: 'WHATSAPP', instant_action: 'QUICK ACTION',
  vera: 'ASHER',
};

// Moved here from the Living Context bar, which used to carry the "what can
// Vera actually see" glyphs across every screen. That bar is gone — it
// repeated the rail's own figures at the top of the same page — so the one
// thing it showed that the rail didn't comes down into the rail.
const CONNECTOR_ICON: Record<string, typeof Mail> = {
  gmail: Mail,
  slack: MessageSquare,
  whatsapp: MessageSquare,
  sheets: FileSpreadsheet,
  google_sheets: FileSpreadsheet,
  notion: NotebookText,
  jira: Ticket,
  linkedin: Linkedin,
};

function sourceLabel(source: string): string {
  if (source.startsWith('workflow:')) return source.slice('workflow:'.length).replace(/-/g, ' ').toUpperCase();
  return SOURCE_LABEL[source] ?? source.toUpperCase();
}

/* ---- Clearing resolved rows ---------------------------------------------
 *
 * There is no DELETE on /api/queue, and adding one would be the wrong call:
 * the queue is the record of what Vera did and what the founder decided
 * about it, which the monthly wrap and the daily brief both count off. A
 * founder tidying their board must not silently rewrite their own history.
 *
 * So "remove" is exactly that — removed from view, on this device, with the
 * row left intact server-side. Same best-effort localStorage pattern as
 * ve_today_seen / ve_theme.
 */
const HIDDEN_KEY = 've_cc_hidden';

function readHidden(): Set<number> {
  try {
    const raw = prefStorage.getItem(HIDDEN_KEY);
    return new Set(raw ? (JSON.parse(raw) as number[]) : []);
  } catch {
    return new Set();
  }
}

// Best-effort: the row simply reappears next reload if this doesn't persist —
// which is the case in a private-browsing tab, and for anyone who declined
// optional storage in the cookie banner (this key is registered there).
function writeHidden(ids: Set<number>) {
  prefStorage.setItem(HIDDEN_KEY, JSON.stringify([...ids]));
}

type Category = 'drafts' | 'decisions' | 'workflows' | 'notes';

function categorize(item: QueueItem): Category {
  if (item.type === 'decision_followup') return 'decisions';
  if (item.type === 'automation_suggestion' || item.type === 'goal_risk') return 'workflows';
  if (item.draftContent) return 'drafts';
  return 'notes';
}

type CategoryMeta = {
  label: string;
  acceptLabel: string;
  rejectLabel: string;
  // Past-tense forms shown on an already-resolved row. Spelled out rather
  // than derived from the verbs above, which would produce "SET UPED".
  acceptedLabel: string;
  editedLabel: string;
  rejectedLabel: string;
};

const CATEGORY_META: Record<Category, CategoryMeta> = {
  drafts: { label: 'DRAFTS', acceptLabel: 'Accept', rejectLabel: 'Dismiss', acceptedLabel: 'ACCEPTED', editedLabel: 'EDITED & SENT', rejectedLabel: 'DISMISSED' },
  decisions: { label: 'DECISIONS', acceptLabel: 'Log outcome', rejectLabel: 'Snooze', acceptedLabel: 'OUTCOME LOGGED', editedLabel: 'OUTCOME LOGGED', rejectedLabel: 'SNOOZED' },
  workflows: { label: 'WORKFLOWS', acceptLabel: 'Set up', rejectLabel: 'Dismiss', acceptedLabel: 'SET UP', editedLabel: 'SET UP', rejectedLabel: 'DISMISSED' },
  notes: { label: 'NOTES', acceptLabel: 'Acknowledge', rejectLabel: 'Dismiss', acceptedLabel: 'ACKNOWLEDGED', editedLabel: 'ACKNOWLEDGED', rejectedLabel: 'DISMISSED' },
};

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function Entry({ item, palette, category, fresh, onHide, onOpenChat }: {
  item: QueueItem;
  palette: Palette;
  category: Category;
  fresh?: boolean;
  // Removes a resolved row from view. Local-only — see HIDDEN_KEY.
  onHide?: (id: number) => void;
  // Opens the chat a decision follow-up came out of, when we can find it.
  onOpenChat?: (serverChatId: number) => void;
}) {
  const { skin } = useVeraSkin();
  // Every identity is a real design now (classic, which was the absence of
  // one, is gone), so this is constant true. Kept as a named flag because many
  // style branches read it; collapsing those is a separate change.
  const skinned = true;
  const action = useQueueAction();
  const [, navigate] = useLocation();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.draftContent ?? '');
  const [copied, setCopied] = useState(false);
  const isDone = item.status !== 'pending';
  const meta = CATEGORY_META[category];
  const isFlagged = item.type === 'schedule_alert' || item.type === 'goal_risk';
  const resolution = resolutionFor(item);

  const connectors = useConnectors();
  const plan = sendPlanFor(item, connectors.data?.connectors ?? []);

  // The chat this row came from, when it is a decision follow-up. The link
  // is the decision id encoded in externalId (`decision-<id>`) joined against
  // the decisions list, which is the only place chatId is exposed.
  const decisions = useDecisions({});
  const linkedChatId = useMemo(() => {
    if (item.type !== 'decision_followup' || !item.externalId) return null;
    const decisionId = Number(/^decision-(\d+)$/.exec(item.externalId)?.[1]);
    if (!Number.isFinite(decisionId)) return null;
    return decisions.data?.decisions.find((d) => d.id === decisionId)?.chatId ?? null;
  }, [item.type, item.externalId, decisions.data]);

  const copyDraft = async () => {
    if (!item.draftContent) return;
    try {
      await navigator.clipboard.writeText(item.draftContent);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard blocked (insecure origin, denied permission). The draft is
      // still on screen and selectable, so this is a missing convenience
      // rather than a broken action — saying nothing is better than an error.
    }
  };

  // An item that exists because something isn't set up yet was previously
  // "resolved" by ticking it off, which cleared the row and left the actual
  // problem exactly where it was — the board told you to connect Slack, you
  // pressed the only affirmative button, and Slack stayed unconnected. When
  // an item has somewhere to go, the primary action goes there first and
  // only marks the row resolved once the founder is on the page that can
  // actually fix it.
  const handleResolve = () => {
    if (resolution) {
      action.mutate({ id: item.id, action: 'accept' });
      navigate(resolution.href);
      return;
    }
    action.mutate({ id: item.id, action: 'accept' });
  };

  // Accepting one of these doesn't just tidy the board — it saves a real
  // Gmail draft, posts a real Slack message, publishes a real LinkedIn
  // post. That was a single click on a small inline link sitting directly
  // under "Dismiss", with nothing between a misclick and something the
  // founder's customers can see. These now take two deliberate clicks.
  // Only a plan that genuinely sends gets the confirm step. A draft with no
  // send path used to take the same two-click "Yes, send it" treatment,
  // which promised an outward action that was never going to happen.
  const outbound = plan.kind === 'send' ? outboundTargetFor(item) : null;
  const [confirmingSend, setConfirmingSend] = useState(false);

  const handleAccept = () => {
    if (outbound && !confirmingSend) { setConfirmingSend(true); return; }
    setConfirmingSend(false);
    action.mutate({ id: item.id, action: 'accept' });
  };
  const handleReject = () => action.mutate({ id: item.id, action: 'reject' });
  // Saving an edit sends too — the server treats 'edited' exactly like
  // 'accept' for the purposes of actually performing the action — so it
  // needs the same confirmation step as Accept does.
  const handleSubmitEdit = () => {
    if (!draft.trim()) return;
    if (outbound && !confirmingSend) { setConfirmingSend(true); return; }
    setConfirmingSend(false);
    action.mutate({ id: item.id, action: 'edit', editedContent: draft.trim() }, { onSuccess: () => setEditing(false) });
  };

  // The one moment Vera speaks without being asked: a follow-up on a decision
  // the founder made weeks ago and never mentioned again. Under a skin it gets
  // the hue reserved product-wide for exactly this and nothing else, plus a
  // left rule, so "Vera started this, not you" is recognisable at a glance
  // without reading a word.
  const isUnprompted = skinned && item.type === 'decision_followup';
  const markColor = isUnprompted
    ? 'var(--vera-unprompted)'
    : isFlagged
      ? palette.coral
      : palette.teal;

  return (
    <div
      style={{
        padding: isUnprompted ? '14px 0 14px 12px' : '14px 0',
        borderBottom: fresh ? 'none' : `1px solid ${palette.line}`,
        borderLeft: isUnprompted ? '2px solid var(--vera-unprompted)' : undefined,
        display: 'flex',
        gap: '12px',
        background: fresh ? palette.tealDim : isUnprompted ? 'var(--vera-unprompted-soft)' : 'transparent',
        margin: fresh ? '0 -12px 8px' : undefined,
        borderRadius: fresh ? '8px' : isUnprompted ? '0 8px 8px 0' : undefined,
        transition: 'background 1.2s ease',
      }}
    >
      <span style={{ color: markColor, fontSize: '15px', lineHeight: 1.5 }}>·</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        {/* A resolved row has nothing left to do but take up space. The
            cross clears it from view — see HIDDEN_KEY for why this is local
            rather than a delete. */}
        {isDone && onHide && (
          <button
            type="button"
            onClick={() => onHide(item.id)}
            aria-label="Remove from board"
            title="Remove from board"
            style={{ float: 'right', background: 'transparent', border: 'none', padding: '2px', marginLeft: '8px', cursor: 'pointer', color: palette.faint, lineHeight: 0 }}
          >
            <X style={{ width: 13, height: 13 }} />
          </button>
        )}
        <p style={{ fontFamily: "var(--v7-font-mono, 'IBM Plex Mono', monospace)", fontSize: '10px', letterSpacing: '0.04em', color: isUnprompted ? 'var(--vera-unprompted)' : isFlagged ? palette.coral : palette.faint, margin: '0 0 4px' }}>
          {isUnprompted ? 'ASHER FOLLOWED UP · ' : ''}{sourceLabel(item.source)} · {item.createdAt ? formatTime(item.createdAt) : ''}
          {/* A resolved item was previously only struck through, which made
              "I actioned this" and "I dismissed this" look identical the
              next morning. Say which one it was. */}
          {isDone && ` · ${resolutionLabel(item.status, meta)}`}
        </p>
        <p style={{ fontSize: '14.5px', lineHeight: 1.55, margin: '0 0 8px', color: isDone ? palette.faint : palette.text, textDecoration: isDone ? 'line-through' : 'none' }}>
          {item.title}{item.body && item.body !== item.title ? ` — ${item.body}` : ''}
        </p>

        {!isDone && item.draftContent && !editing && (
          <div style={{ fontSize: '12.5px', whiteSpace: 'pre-wrap', color: palette.muted, background: palette.paperEdge, borderRadius: '6px', padding: '8px 10px', marginBottom: '8px' }}>
            {item.draftContent}
          </div>
        )}

        {/* What pressing the primary button will actually do, stated before
            it is pressed. This is the whole fix for "I clicked Accept and
            nothing happened" — the outcome was never wrong, it was just
            never said. */}
        {!isDone && plan.kind !== 'none' && (
          <div
            style={{
              display: 'flex', alignItems: 'flex-start', gap: '6px', marginBottom: '10px',
              fontFamily: "var(--v7-font-mono, 'IBM Plex Mono', monospace)", fontSize: '10.5px', lineHeight: 1.5,
              color: plan.kind === 'send' ? palette.teal : plan.kind === 'local' ? palette.faint : palette.coral,
            }}
          >
            {plan.kind === 'send' && <><Send style={{ width: 11, height: 11, flexShrink: 0, marginTop: 2 }} /><span>Accepting will {plan.label}.</span></>}
            {plan.kind === 'local' && (
              <>
                <PlugZap style={{ width: 11, height: 11, flexShrink: 0, marginTop: 2 }} />
                <span>Asher can't send this — it isn't tied to a connected account. Copy it and send it yourself; Accept just files it.</span>
              </>
            )}
            {plan.kind === 'unrouted' && (
              <>
                <PlugZap style={{ width: 11, height: 11, flexShrink: 0, marginTop: 2 }} />
                <span>
                  {connectorName(plan.connector, connectors.data?.connectors ?? [])} is connected, but this row lost the
                  thread it belongs to, so Asher can't send it. Copy the text and send it yourself.
                </span>
              </>
            )}
            {plan.kind === 'unlinked' && (
              <>
                <PlugZap style={{ width: 11, height: 11, flexShrink: 0, marginTop: 2 }} />
                <span>
                  {connectorName(plan.connector, connectors.data?.connectors ?? [])} isn't connected, so this can't be sent.{' '}
                  <button type="button" onClick={() => navigate('/vera/workflows')} style={{ background: 'none', border: 'none', padding: 0, color: 'inherit', textDecoration: 'underline', cursor: 'pointer', font: 'inherit' }}>
                    Connect it
                  </button>{' '}
                  or copy the text.
                </span>
              </>
            )}
            {plan.kind === 'broken' && (
              <>
                <PlugZap style={{ width: 11, height: 11, flexShrink: 0, marginTop: 2 }} />
                <span>
                  {connectorName(plan.connector, connectors.data?.connectors ?? [])} needs reconnecting before this can send.{' '}
                  <button type="button" onClick={() => navigate('/vera/workflows')} style={{ background: 'none', border: 'none', padding: 0, color: 'inherit', textDecoration: 'underline', cursor: 'pointer', font: 'inherit' }}>
                    Fix it
                  </button>.
                </span>
              </>
            )}
          </div>
        )}
        {!isDone && editing && (
          <textarea
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={4}
            style={{ width: '100%', fontSize: '12.5px', color: palette.text, background: palette.paperEdge, border: `1px solid ${palette.tealBorder}`, borderRadius: '6px', padding: '8px 10px', marginBottom: '8px', outline: 'none', fontFamily: 'inherit' }}
          />
        )}

        {!isDone && (
          <div style={{ display: 'flex', gap: skinned ? '8px' : '14px', alignItems: 'center', flexWrap: 'wrap' }}>
            {editing ? (
              <>
                <button type="button" onClick={handleSubmitEdit} {...actionProps(palette, false, skinned, !!outbound && confirmingSend)}>
                  {outbound ? (confirmingSend ? 'Yes, send it' : 'Save & send') : 'Save'}
                </button>
                <button type="button" onClick={() => { setEditing(false); setConfirmingSend(false); }} {...actionProps(palette, true, skinned)}>Cancel</button>
                {confirmingSend && outbound && (
                  <span style={{ fontFamily: "var(--v7-font-mono, 'IBM Plex Mono', monospace)", fontSize: '10.5px', color: palette.coral }}>
                    This will {outbound}.
                  </span>
                )}
              </>
            ) : (
              confirmingSend && outbound ? (
                <>
                  <span style={{ fontFamily: "var(--v7-font-mono, 'IBM Plex Mono', monospace)", fontSize: '10.5px', color: palette.coral }}>
                    This will {outbound}.
                  </span>
                  <button type="button" onClick={handleAccept} {...actionProps(palette, false, skinned, true)}>
                    {action.isPending ? 'Sending…' : 'Yes, send it'}
                  </button>
                  <button type="button" onClick={() => setConfirmingSend(false)} {...actionProps(palette, true, skinned)}>Cancel</button>
                </>
              ) : (
              <>
                {/* When Asher can't send it, copying IS the action — so it
                    leads, and filing the row becomes the secondary. */}
                {plan.kind === 'local' || plan.kind === 'unlinked' || plan.kind === 'broken' || plan.kind === 'unrouted' ? (
                  <>
                    <button type="button" onClick={copyDraft} {...actionProps(palette, false, skinned)}>
                      {copied ? 'Copied' : 'Copy text'}
                    </button>
                    <button type="button" onClick={handleAccept} {...actionProps(palette, true, skinned)}>
                      {meta.acceptLabel}
                    </button>
                  </>
                ) : (
                  <button type="button" onClick={resolution ? handleResolve : handleAccept} {...actionProps(palette, false, skinned, isFlagged)}>
                    {resolution ? resolution.label : meta.acceptLabel}
                  </button>
                )}
                {item.draftContent && <button type="button" onClick={() => setEditing(true)} {...actionProps(palette, true, skinned)}>Edit</button>}
                {/* The decisions section was read-only: it named a decision
                    and offered no way back to the conversation it came out
                    of, which is the only place its context lives. */}
                {linkedChatId != null && onOpenChat && (
                  <button type="button" onClick={() => onOpenChat(linkedChatId)} {...actionProps(palette, true, skinned)}>
                    Open chat
                  </button>
                )}
                <button type="button" onClick={handleReject} {...actionProps(palette, true, skinned)}>{meta.rejectLabel}</button>
              </>
              )
            )}
          </div>
        )}
        {action.isError && (
          <div style={{ fontSize: '11px', marginTop: '6px', color: palette.coral }}>
            {action.error instanceof Error ? action.error.message : 'Failed — try again.'}
          </div>
        )}
      </div>
    </div>
  );
}

// The streak used to be a 10.5px sticker rotated 3° into the top-right
// corner, and the counters under it were 10px mono labels — small enough
// that the one surface meant to build a daily habit was the easiest thing
// on the page to miss entirely. This gives the streak the top line, at a
// size that registers, and says something addressed to the founder rather
// than printing a bare number.
function streakLine(streak: number, keptToday = true): { headline: string; sub: string } {
  // The at-risk case first, so the full-width band tells the same story as the
  // rail tile rather than two components disagreeing about the same number.
  // See streakCaption for the reasoning behind the three states.
  if (streak > 0 && !keptToday) {
    return {
      headline: `${streak} day${streak === 1 ? '' : 's'} in a row`,
      sub: `Not kept today. One item off the board makes it ${streak + 1}; skipping today puts it back to zero.`,
    };
  }
  // See streakCaption below for why the zero case names the streak explicitly
  // rather than saying "Day one" next to a lifetime days-active tally.
  if (streak <= 0) return { headline: 'No streak yet', sub: 'Clear something off the board and your streak starts today.' };
  if (streak === 1) return { headline: '1 day in a row', sub: 'One day is a start. Come back tomorrow and it becomes a habit.' };
  if (streak < 5) return { headline: `${streak} days in a row`, sub: "You've shown up every day this week. Asher's been keeping up." };
  if (streak < 14) return { headline: `${streak} days in a row`, sub: 'This is a routine now, not a novelty.' };
  return { headline: `${streak} days in a row`, sub: "Genuinely impressive. Asher works better the longer you've done this." };
}

// The rail's version of the same idea, cut to fit beside a 32px numeral in a
// ~320px column. streakLine's sentences are written for the classic board's
// full-width band and wrap to three lines here.
/* ---- The streak, framed as something owned rather than something scored ----
 *
 * A streak only changes behaviour once it belongs to the person: an unbroken
 * run you own reads as something to protect, where the same number presented as
 * a score reads as the product congratulating itself. Three states, and the
 * middle one is the whole point:
 *
 *   none     — nothing to lose yet, so say plainly how one starts.
 *   at risk  — a real run exists and TODAY has not been kept up. This is the
 *              only moment the streak is losable, and it is the only moment
 *              worth saying so.
 *   secure   — kept today. Says so and then gets out of the way; a product that
 *              keeps celebrating after the work is done is noise.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO. No countdown timer, no red alarm state,
 * no "don't lose it!!". The honest fact — this ends tonight unless you clear
 * one thing — is already motivating and is *true*; dressing it up would make
 * the one genuinely time-bound message in the product indistinguishable from
 * manufactured urgency, and then it gets ignored like everything else.
 *
 * `keptToday` comes from the same activityByDay the week strip is drawn from,
 * so the caption can never disagree with the bars directly beneath it.
 */
type StreakState = 'none' | 'at-risk' | 'secure';

function streakState(streak: number, keptToday: boolean): StreakState {
  if (streak <= 0) return 'none';
  return keptToday ? 'secure' : 'at-risk';
}

function streakCaption(streak: number, keptToday = true): { label: string; note: string; state: StreakState } {
  const state = streakState(streak, keptToday);

  // The zero case says WHICH streak this is, not just "Day one". It sits
  // directly under a "N days active" tally counting every day the founder has
  // ever used Vera, so an unqualified "Day one" read as the panel disagreeing
  // with itself — reported as exactly that. These are two different measures:
  // days active is distinct days of any activity, ever; this is consecutive
  // days of clearing the board, which is 0 until something is actioned.
  if (state === 'none') {
    return { label: 'No streak yet', note: 'Clear one item off the board to start one.', state };
  }

  if (state === 'at-risk') {
    // Names the number being lost, because "your streak" is abstract and
    // "your 6-day streak" is a thing you built.
    return {
      label: streak === 1 ? 'Day in a row' : 'Days in a row',
      note: `Not kept today — clear one item and it's ${streak + 1}. Skip today and it's back to zero.`,
      state,
    };
  }

  if (streak === 1) return { label: 'Day in a row', note: 'Kept today. Come back tomorrow and it sticks.', state };
  if (streak < 5) return { label: 'Days in a row', note: "Kept today. You've shown up every day this week.", state };
  if (streak < 14) return { label: 'Days in a row', note: 'Kept today. A routine now, not a novelty.', state };
  return { label: 'Days in a row', note: 'Kept today. Asher works better the longer you do this.', state };
}

/** Whether the board was actually cleared today, read off the same per-day
 *  activity the week strip renders. Last entry is today (buildActivityByDay
 *  fills the window forward to now), so an empty list is honestly "no". */
function keptStreakToday(days: { actions: number }[] | undefined): boolean {
  if (!days || days.length === 0) return false;
  return (days[days.length - 1]?.actions ?? 0) > 0;
}

// "Time saved" was a number in minutes — 8m, 24m — which reads as a
// rounding error and quietly invites the founder to check the maths on a
// figure nobody can verify. Free time is the same idea told as a joke: the
// number goes up honestly with automations, but the framing never asks to
// be taken literally, and once you're past a handful of automations it just
// gives up and says infinity.
function freeTimeLabel(minutes: number): string {
  if (minutes <= 0) return '—';
  if (minutes >= 240) return '∞';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

function StreakBand({ palette, stats, streak }: { palette: Palette; stats: DailyBriefStats; streak: number }) {
  const { skin } = useVeraSkin();
  // Every identity is a real design now (classic, which was the absence of
  // one, is gone), so this is constant true. Kept as a named flag because many
  // style branches read it; collapsing those is a separate change.
  const skinned = true;
  // Same source as the rail tile and the week strip, so all three agree.
  const { headline, sub } = streakLine(streak, keptStreakToday(stats.activityByDay));
  const counters = [
    stats.decisionsCaptured > 0 && [String(stats.decisionsCaptured), stats.decisionsCaptured === 1 ? 'decision captured' : 'decisions captured'],
    stats.lessonsLearned > 0 && [String(stats.lessonsLearned), stats.lessonsLearned === 1 ? 'lesson learned' : 'lessons learned'],
    stats.automationsCompleted > 0 && [String(stats.automationsCompleted), stats.automationsCompleted === 1 ? 'automation run' : 'automations run'],
    stats.timeSavedMinutes > 0 && [freeTimeLabel(stats.timeSavedMinutes), 'free time earned'],
  ].filter((x): x is [string, string] => !!x);

  return (
    <div
      style={{
        marginBottom: '26px',
        padding: '18px 20px',
        borderRadius: '10px',
        background: palette.tealDim,
        border: `1px solid ${palette.tealBorder}`,
      }}
    >
      {/* Under a skin the streak leads with the count set large in the
          measured face, rather than a flame badge beside a sentence — this
          is an accumulating operating record, and a number is what an
          operating record looks like. Classic keeps the flame. */}
      <div style={{ display: 'flex', alignItems: skinned ? 'flex-end' : 'center', gap: skinned ? '12px' : '10px', marginBottom: counters.length ? '14px' : 0 }}>
        {skinned ? (
          <span
            style={{
              fontFamily: "var(--v7-font-mono, 'IBM Plex Mono', monospace)",
              fontSize: '38px',
              fontWeight: 500,
              letterSpacing: '-0.03em',
              lineHeight: 0.9,
              color: palette.teal,
              fontVariantNumeric: 'tabular-nums lining-nums',
              flexShrink: 0,
            }}
          >
            {streak}
          </span>
        ) : (
          <Flame style={{ width: 20, height: 20, color: palette.teal, flexShrink: 0 }} />
        )}
        <div style={{ minWidth: 0 }}>
          <p style={{ fontSize: '19px', fontWeight: 600, color: palette.text, margin: 0, lineHeight: 1.25 }}>{headline}</p>
          <p style={{ fontSize: '13px', fontStyle: 'italic', color: palette.muted, margin: '2px 0 0', lineHeight: 1.4 }}>{sub}</p>
        </div>
      </div>

      {counters.length > 0 && (
        <div style={{ display: 'flex', gap: '26px', flexWrap: 'wrap', paddingTop: '14px', borderTop: `1px solid ${palette.tealBorder}` }}>
          {counters.map(([value, label]) => (
            <span key={label} style={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
              <span style={{ fontFamily: "var(--v7-font-mono, 'IBM Plex Mono', monospace)", fontSize: '20px', fontWeight: 600, color: palette.teal, lineHeight: 1.1 }}>{value}</span>
              <span style={{ fontFamily: "var(--v7-font-mono, 'IBM Plex Mono', monospace)", fontSize: '10.5px', color: palette.muted, letterSpacing: '0.03em' }}>{label}</span>
            </span>
          ))}
        </div>
      )}

      {/* The same week strip the skinned rail draws, in the notebook's own
          ink. Counters say how much; this says whether it was steady. */}
      {stats.activityByDay && stats.activityByDay.length > 0 && (
        <div style={{ marginTop: '4px', paddingTop: '6px', borderTop: counters.length ? `1px solid ${palette.tealBorder}` : 'none' }}>
          <ActivityWeek
            days={stats.activityByDay}
            flush
            tone={{ accent: palette.teal, quiet: palette.tealBorder, well: palette.paperEdge }}
          />
        </div>
      )}
    </div>
  );
}

// Whether accepting this item performs a real, outward-facing action rather
// than just resolving a row. Mirrors the source checks in the server's
// performQueueItemSendAction — an item only actually sends when it has draft
// content AND a source with a live send step. Everything else ("I've seen
// this", an instant-action draft the founder copies out by hand) resolves
// silently and needs no confirmation.
const OUTBOUND_LABELS: Record<string, string> = {
  gmail: 'save this as a real draft in your Gmail account',
  slack: 'post this message to Slack',
  linkedin: 'publish this post to LinkedIn',
};

function outboundTargetFor(item: QueueItem): string | null {
  if (!item.draftContent) return null;
  return OUTBOUND_LABELS[item.source] ?? null;
}

/* ---- What "Accept" will actually do -------------------------------------
 *
 * THE PROBLEM THIS SOLVES. Vera drafts a reply, the founder presses Accept,
 * the row strikes through — and nothing was sent. That is not a bug in the
 * send path; it is the send path working as designed and the UI never saying
 * so. `performQueueItemSendAction` only sends for gmail/slack/linkedin, and
 * only when the row carries routing metadata AND the connector is live.
 * Everything else — every draft produced by the quick actions, which is most
 * of what a founder puts on this board — has no send step at all and never
 * did. Accepting it means "I've seen this", and the founder had no way to
 * know that.
 *
 * So the row now states its own outcome before it is clicked, and the four
 * cases are genuinely different things, not shades of one:
 *
 *   send        — a live connector and routing details. Accepting sends.
 *   broken      — the channel exists but the connector is down. Say which,
 *                 and link to the fix, rather than failing on click.
 *   unlinked    — the channel exists but was never connected.
 *   local       — there is no channel. The draft is text for the founder to
 *                 use; Accept files it. Copy is the real primary action, so
 *                 it is offered as one.
 */
type SendPlan =
  | { kind: 'send'; label: string; connector: string }
  | { kind: 'broken'; label: string; connector: string }
  | { kind: 'unlinked'; label: string; connector: string }
  | { kind: 'unrouted'; connector: string }
  | { kind: 'local' }
  | { kind: 'none' };

function sendPlanFor(item: QueueItem, connectors: ConnectorStatus[]): SendPlan {
  if (!item.draftContent) return { kind: 'none' };

  const label = OUTBOUND_LABELS[item.source];
  if (!label) return { kind: 'local' };

  // gmail and slack additionally need the thread/channel the draft replies
  // into. Without it the server throws rather than silently no-opping (see
  // performQueueItemSendAction), so this is un-sendable up front — but for a
  // DIFFERENT reason than "no connector", and saying "this isn't tied to a
  // connected account" about a live Gmail account is simply untrue. Its own
  // case, with its own sentence.
  if ((item.source === 'gmail' || item.source === 'slack') && !item.metadataJson) {
    return { kind: 'unrouted', connector: item.source };
  }

  const connector = connectors.find((c) => c.type === item.source);
  if (!connector || connector.status === 'disconnected') return { kind: 'unlinked', label, connector: item.source };
  if (connector.status === 'error') return { kind: 'broken', label, connector: item.source };
  return { kind: 'send', label, connector: item.source };
}

// Display names for the two frames in which the connectors query has not
// resolved yet — which is every first paint, not an edge case. Capitalising
// the raw type instead would render "Linkedin" and "Google_sheets" on load
// and then correct itself, which looks like a typo the product shipped.
// Mirrors lib/connectors/registry.ts on the server.
const CONNECTOR_NAME_FALLBACK: Record<string, string> = {
  gmail: 'Gmail',
  slack: 'Slack',
  linkedin: 'LinkedIn',
  notion: 'Notion',
  jira: 'Jira',
  whatsapp: 'WhatsApp',
  sheets: 'Google Sheets',
  google_sheets: 'Google Sheets',
  calendar: 'Google Calendar',
};

// The connector's own display name ("LinkedIn"), not the board's all-caps
// source tag. sourceLabel is built for the mono metadata line above a row and
// reads as shouting inside a sentence.
function connectorName(type: string, connectors: ConnectorStatus[]): string {
  return (
    connectors.find((c) => c.type === type)?.label ??
    CONNECTOR_NAME_FALLBACK[type] ??
    type.charAt(0).toUpperCase() + type.slice(1)
  );
}

// Where a queue item's primary action should actually take the founder.
// Derived from the item rather than stored on it, so no schema change is
// needed and older rows written before this existed still route correctly.
// Returns null for items whose resolution genuinely is just "I've seen
// this" (a plain insight, a read alert) — those keep the old tick-off.
function resolutionFor(item: QueueItem): { label: string; href: string } | null {
  if (item.type === 'welcome') return { label: 'Set up workflows', href: '/vera/workflows' };
  if (item.type === 'automation_suggestion') return { label: 'Set up workflow', href: '/vera/workflows' };
  if (item.type === 'goal_risk') return { label: 'Review goal', href: '/vera/goals' };
  if (item.type === 'decision_followup') return { label: 'Log outcome', href: '/vera/decisions' };

  // "Reconnect Slack"-shaped items: the fix lives on the Workflows page,
  // which is where every connector is actually linked from.
  if (item.type === 'connector_error' || item.type === 'connector_setup') {
    return { label: 'Fix connection', href: '/vera/workflows' };
  }

  return null;
}

// Past-tense echo of whichever verb the founder actually pressed, so the
// resolved row says what happened rather than just looking crossed out.
function resolutionLabel(status: string, meta: CategoryMeta): string {
  if (status === 'accepted') return meta.acceptedLabel;
  if (status === 'edited') return meta.editedLabel;
  if (status === 'rejected') return meta.rejectedLabel;
  return status.toUpperCase();
}

/**
 * Props for one of the board's action controls.
 *
 * Classic keeps the quiet inline links the notebook aesthetic was built
 * around. Under a skin these become real keys — the affirmative action gets
 * weight and travel, and declining deliberately gets neither, so approving
 * and dismissing stop looking like the same gesture. That asymmetry is the
 * point: these buttons send real email and post to real Slack.
 */
function actionProps(
  palette: Palette,
  quiet: boolean,
  skinned: boolean,
  flagged?: boolean,
): { className?: string; style?: CSSProperties } {
  if (!skinned) return { style: linkStyle(palette, quiet, flagged) };
  if (quiet) return { className: 'vera-key vera-key-3' };
  return {
    className: 'vera-key vera-key-1',
    // A send that leaves the building takes the caution hue rather than the
    // accent, so the confirm step doesn't look like every other primary.
    style: flagged ? { background: palette.coral, color: palette.paper } : undefined,
  };
}

function linkStyle(palette: Palette, quiet: boolean, flagged?: boolean): CSSProperties {
  return {
    fontFamily: "var(--v7-font-mono, 'IBM Plex Mono', monospace)",
    fontSize: '10.5px',
    letterSpacing: '0.02em',
    color: quiet ? palette.muted : flagged ? palette.coral : palette.teal,
    textDecoration: 'none',
    // These controls are <button>s (they were <a>s with no href, so keyboard
    // users could neither Tab to them nor press Enter). Strip the UA button
    // chrome so they keep reading as the quiet inline links they were.
    background: 'transparent',
    border: 'none',
    padding: 0,
    borderBottom: quiet ? '1px solid transparent' : `1px solid ${flagged ? palette.coralBorder : palette.tealBorder}`,
    cursor: 'pointer',
  };
}

// Labels state what you get back, not a verb phrase you have to interpret —
// "Sell this" and "Summarize" said nothing about what a founder would
// actually get, so they sat here unused. Same four instant actions, now
// worded the way QuickActions.tsx settled on before that module was
// retired: this is its one home, not the New Chat landing view, which was
// already crowded with the composer and example prompts.
// `hint` is the missing half. The four labels are outcomes ("Cut to the
// point"), which is the right register but tells a founder nothing about
// what to feed them or what comes back — so they read as four unexplained
// buttons. The hint says both, on hover and, once a button is picked, in
// place above the input.
const QUICK_ACTIONS: { type: InstantActionType; label: string; hint: string; placeholder: string }[] = [
  {
    type: 'sell_this',
    label: 'Pressure-test it',
    hint: 'Paste a plan or assumption — Asher argues the other side and finds what breaks it.',
    placeholder: "The plan or assumption you're about to commit to…",
  },
  {
    type: 'summarize',
    label: 'Cut to the point',
    hint: 'Paste any long thread, doc or report — Asher returns just what matters and what to do.',
    placeholder: 'Paste the thread, doc or report…',
  },
  {
    type: 'draft_reply',
    label: 'Draft a reply',
    hint: 'Paste a message you need to answer — Asher writes the reply for you to review.',
    placeholder: 'Paste the message you need to answer…',
  },
  {
    type: 'follow_up',
    label: 'Restart a thread',
    hint: 'Say who went quiet and what it was about — Asher writes the nudge that reopens it.',
    placeholder: 'Who went quiet, and what it was about…',
  },
];

function QuickAddRow({ palette, onAdded }: { palette: Palette; onAdded: (itemId: number) => void }) {
  const { skin } = useVeraSkin();
  // Every identity is a real design now (classic, which was the absence of
  // one, is gone), so this is constant true. Kept as a named flag because many
  // style branches read it; collapsing those is a separate change.
  const skinned = true;
  const [active, setActive] = useState<InstantActionType | null>(null);
  const [hovered, setHovered] = useState<InstantActionType | null>(null);
  const [input, setInput] = useState('');
  const run = useRunInstantAction();
  const activeMeta = QUICK_ACTIONS.find((a) => a.type === active);
  // Hover wins over selection, so pointing at a second button while one is
  // open explains the one under the pointer rather than the one already open.
  const hintText = QUICK_ACTIONS.find((a) => a.type === (hovered ?? active))?.hint ?? null;

  const submit = () => {
    if (!active || !input.trim()) return;
    run.mutate(
      { type: active, input: input.trim(), mode: 'queue' },
      { onSuccess: (data) => { setActive(null); setInput(''); if (data.item) onAdded(data.item.id); } },
    );
  };

  return (
    <div style={{ marginBottom: '30px', paddingBottom: '20px', borderBottom: `1px solid ${palette.line}` }}>
      <div style={{ display: 'flex', gap: '18px', flexWrap: 'wrap' }}>
        {QUICK_ACTIONS.map((a) => (
          <button
            key={a.type}
            onClick={() => setActive(a.type)}
            onMouseEnter={() => setHovered(a.type)}
            onMouseLeave={() => setHovered((h) => (h === a.type ? null : h))}
            onFocus={() => setHovered(a.type)}
            onBlur={() => setHovered((h) => (h === a.type ? null : h))}
            // `title` as well as the inline hint below: the inline line is
            // the one people will actually read, the attribute covers the
            // founder who hovers and waits for a tooltip out of habit.
            title={a.hint}
            style={{
              background: 'none', border: 'none', color: palette.teal, fontFamily: "var(--vera-font-display, 'Fraunces', serif)",
              fontSize: '13.5px', fontStyle: 'italic', borderBottom: `1px solid ${palette.tealBorder}`, padding: '0 0 2px', cursor: 'pointer',
            }}
          >
            {a.label}
          </button>
        ))}
      </div>

      {/* Reserves its own line so hovering the row doesn't reflow the board
          under the pointer. Falls back to naming what the row is for when
          nothing is hovered, which is the question a founder seeing four
          bare verbs actually has. */}
      <p
        style={{
          margin: '8px 0 0', minHeight: '15px',
          fontFamily: "var(--v7-font-mono, 'IBM Plex Mono', monospace)", fontSize: '10.5px', lineHeight: 1.4,
          color: hintText ? palette.muted : palette.faint,
          transition: 'color 200ms ease',
        }}
      >
        {hintText ?? 'Shortcuts — paste something in and Asher puts the result on the board.'}
      </p>

      {activeMeta && (
        <div style={{ marginTop: '14px' }}>
          <textarea
            autoFocus
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={activeMeta.placeholder}
            rows={3}
            style={{ width: '100%', fontSize: '13px', color: palette.text, background: palette.paperEdge, border: `1px solid ${palette.line}`, borderRadius: '6px', padding: '8px 10px', marginBottom: '8px', outline: 'none', fontFamily: 'inherit' }}
          />
          <div style={{ display: 'flex', gap: '14px', alignItems: 'center' }}>
            <button type="button" onClick={submit} {...actionProps(palette, false, skinned)}>{run.isPending ? 'Working…' : 'Add to Blackboard'}</button>
            <button type="button" onClick={() => { setActive(null); setInput(''); }} {...actionProps(palette, true, skinned)}>Cancel</button>
          </div>
          {run.isError && <div style={{ fontSize: '11px', marginTop: '6px', color: palette.coral }}>{run.error instanceof Error ? run.error.message : 'Failed — try again.'}</div>}
        </div>
      )}
    </div>
  );
}

/**
 * What Vera can currently see. Previously a row of unlabelled glyphs in the
 * Living Context bar, where the only way to learn which service a socket
 * stood for — or that one had stopped working — was to hover it. In the rail
 * there is room to simply say so, and a broken connector is the one piece of
 * standing state on this page that needs acting on rather than reading.
 *
 * Renders nothing when nothing is connected: an empty "Connected" tile on a
 * fresh account is a reproach, and the queue already carries a real
 * connector_setup item pointing at the same page.
 */
function ConnectedTile() {
  const [, navigate] = useLocation();
  const connectors = useConnectors();
  // Every connector Vera can actually use, connected or not — not just the
  // live ones. Hiding the tile on a fresh account was precisely backwards:
  // an empty board is CAUSED by nothing being connected, so the one moment
  // the founder most needs to see this list was the one moment it vanished,
  // leaving no answer on the page to "why is nothing arriving here?".
  const all = (connectors.data?.connectors ?? []).filter((c: ConnectorStatus) => c.implemented);
  if (all.length === 0) return null;

  const liveCount = all.filter((c: ConnectorStatus) => c.status === 'connected').length;
  const brokenCount = all.filter((c: ConnectorStatus) => c.status === 'error').length;

  return (
    <div className="vera-tile">
      <div className="vera-tile-head">
        <span className="vera-label">Connectors</span>
        {brokenCount > 0 ? (
          <span className="vera-tally" style={{ color: 'var(--red)', background: 'transparent', borderColor: 'var(--red)' }}>
            {brokenCount} need{brokenCount === 1 ? 's' : ''} fixing
          </span>
        ) : (
          <span className="vera-tally">{liveCount}/{all.length} on</span>
        )}
      </div>
      <div className="vera-tile-body" style={{ display: 'grid', gap: '10px' }}>
        {/* Says plainly what the board depends on. Without this, a founder
            with several active chats reasonably expects the board to fill
            up from them — it never will, because chats don't feed it. */}
        <p className="vera-t-support" style={{ margin: '0 0 2px' }}>
          {liveCount === 0
            ? "Nothing is connected, so nothing arrives here on its own. Your chats don't feed this board — connectors and workflows do."
            : 'These are what Asher can see and send through.'}
        </p>

        {all.map((c: ConnectorStatus) => {
          const Icon = CONNECTOR_ICON[c.type] ?? Plug;
          const broken = c.status === 'error';
          const connected = c.status === 'connected';
          return (
            <span key={c.type} style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
              <span
                className={`vera-socket ${broken ? 'vera-socket-bad' : connected ? 'vera-socket-live' : ''}`}
                style={{ width: 24, height: 24, opacity: connected || broken ? 1 : 0.45 }}
              >
                <Icon className="w-3 h-3" />
              </span>
              <span
                className="vera-t-support"
                style={{ color: broken ? 'var(--red)' : connected ? 'var(--v7-text-dim)' : 'var(--v7-text-mute)', minWidth: 0, flex: 1 }}
              >
                {broken ? `${c.label} — needs reconnecting` : c.label}
              </span>
              {!connected && (
                <button
                  type="button"
                  onClick={() => startConnectorAuth(c.type)}
                  className="vera-key vera-key-3"
                  style={{ flexShrink: 0, padding: '3px 9px', fontSize: '10.5px' }}
                >
                  {broken ? 'Reconnect' : 'Connect'}
                </button>
              )}
            </span>
          );
        })}

        <button
          type="button"
          onClick={() => navigate('/vera/workflows')}
          className="vera-key vera-key-3"
          style={{ marginTop: '2px', justifyContent: 'flex-start' }}
        >
          Manage connections & workflows
        </button>
      </div>
    </div>
  );
}

/**
 * Open / Completed switch. Rendered in both board styles, so the split
 * behaves identically whichever skin is on.
 *
 * The completed count is shown but never badged — done work is a place to
 * look, not something demanding attention, and giving it a count chip that
 * looks like the pending tally would invert exactly the priority this split
 * exists to establish.
 */
function QueueTabs({ tab, onChange, openCount, doneCount, palette }: {
  tab: 'open' | 'done';
  onChange: (t: 'open' | 'done') => void;
  openCount: number;
  doneCount: number;
  palette?: Palette;
}) {
  const tabs: { id: 'open' | 'done'; label: string; count: number }[] = [
    { id: 'open', label: 'Needs you', count: openCount },
    { id: 'done', label: 'Completed', count: doneCount },
  ];

  return (
    <div style={{ display: 'flex', gap: '6px', marginBottom: '16px' }}>
      {tabs.map((t) => {
        const active = tab === t.id;
        const accent = palette?.teal ?? 'var(--v7-cyan)';
        const border = palette?.paperEdge ?? 'var(--v7-border)';
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => onChange(t.id)}
            style={{
              fontFamily: "var(--v7-font-mono, 'IBM Plex Mono', monospace)",
              fontSize: '10.5px',
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              padding: '6px 12px',
              borderRadius: '20px',
              cursor: 'pointer',
              transition: 'color 220ms ease, border-color 220ms ease, background 220ms ease',
              background: active ? (palette?.tealDim ?? 'var(--v7-cyan-soft)') : 'transparent',
              border: `1px solid ${active ? accent : border}`,
              color: active ? accent : (palette?.muted ?? 'var(--v7-text-mute)'),
            }}
          >
            {t.label}{t.count > 0 ? ` (${t.count})` : ''}
          </button>
        );
      })}
    </div>
  );
}

export function CommandCenterSection({ theme, onBack, onOpenThread, onContinueInChat, onOpenChatById }: {
  theme: VenusTheme;
  onBack: () => void;
  // Jump to the chat a saved analysis came out of.
  onOpenThread?: (a: SavedAnalysis) => void;
  // Hand a mini-Vera exchange over to a real chat thread.
  onContinueInChat?: (messages: ChatMessage[]) => void;
  // Open a chat by its server id — used by a decision follow-up to get back
  // to the conversation the decision was actually made in.
  onOpenChatById?: (serverChatId: number) => void;
}) {
  const { skin } = useVeraSkin();
  // Every identity is a real design now (classic, which was the absence of
  // one, is gone), so this is constant true. Kept as a named flag because many
  // style branches read it; collapsing those is a separate change.
  const skinned = true;
  const palette = theme === 'light' ? LIGHT : DARK;
  const isLight = theme === 'light';
  const { data, isLoading } = useQueue();
  const dailyBrief = useDailyBrief();
  const [recentlyAdded, setRecentlyAdded] = useState<Set<number>>(new Set());
  const sectionRefs = useRef<Record<Category, HTMLDivElement | null>>({ drafts: null, decisions: null, workflows: null, notes: null });
  // 'board' and 'book' are two spreads of the same notebook, not two routes —
  // see SavedAnalysisBook.tsx. Reading saved work is a page turn away from
  // the board rather than a navigation that would lose its scroll position.
  const [view, setView] = useState<'board' | 'book'>('board');
  const savedAnalyses = useMemo(() => getSavedAnalyses(), [view]);
  // Counts per type, in the book's tab order so the board's dots and the
  // book's tabs read in the same sequence.
  const savedTypeCounts = useMemo(() => {
    const counts = new Map<SavedAnalysisType, number>();
    for (const s of savedAnalyses) counts.set(s.type, (counts.get(s.type) ?? 0) + 1);
    return SAVED_TYPE_ORDER.filter((t) => counts.has(t)).map((t) => [t, counts.get(t)!] as const);
  }, [savedAnalyses]);

  // Resolved rows used to stay in place, struck through, in the same list as
  // live work — so the board's length grew with everything the founder had
  // already dealt with, and "what still needs me" got harder to find the more
  // they used it. Done work moves to its own tab.
  const [hidden, setHidden] = useState<Set<number>>(readHidden);
  const [queueTab, setQueueTab] = useState<'open' | 'done'>('open');

  const hideItem = (id: number) => {
    setHidden((prev) => {
      const next = new Set(prev).add(id);
      writeHidden(next);
      return next;
    });
  };

  const allItems = data?.items ?? [];
  const visible = allItems.filter((i) => !hidden.has(i.id));
  const openItems = visible.filter((i) => i.status === 'pending');
  const doneItems = visible.filter((i) => i.status !== 'pending');
  const items = queueTab === 'open' ? openItems : doneItems;

  const grouped: Record<Category, QueueItem[]> = { drafts: [], decisions: [], workflows: [], notes: [] };
  for (const item of items) grouped[categorize(item)].push(item);

  // Which section gets the single lifted tile. Derived rather than hardcoded
  // to 'drafts', because an empty drafts section is skipped entirely — pinning
  // the lift to a section that never renders would leave the whole board flat
  // with nothing to look at first.
  const firstPopulatedIndex = (Object.keys(CATEGORY_META) as Category[]).findIndex((c) => grouped[c].length > 0);

  const streak = dailyBrief.data?.stats.queueStreakDays ?? 0;
  const dateLabel = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  const boardName = theme === 'light' ? 'Whiteboard' : 'Blackboard';

  // overflowY below is load-bearing: Venus.tsx mounts this inside a
  // `flex-1 flex flex-col overflow-hidden` column, so without its own scroll
  // context everything past the fold was simply clipped and unreachable —
  // the board could not be scrolled at all once it held more than a
  // screenful.
  return (
    <div
      style={{ background: palette.bg, minHeight: '100%', flex: 1, overflowY: 'auto', display: 'flex', justifyContent: 'center', padding: '48px 20px 80px', fontFamily: "var(--vera-font-display, 'Fraunces', serif)", color: palette.text }}
    >
      {view === 'book' ? (
        <SavedAnalysisBook
          palette={palette}
          isLight={isLight}
          onBack={() => setView('board')}
          onOpenThread={onOpenThread}
          onContinueInChat={onContinueInChat ?? (() => {})}
        />
      ) : (
      <div style={{ width: '100%', maxWidth: skinned ? '1040px' : '640px' }}>
        <button type="button" onClick={onBack} style={{ fontFamily: "var(--v7-font-mono, 'IBM Plex Mono', monospace)", fontSize: '12px', color: palette.muted, background: 'transparent', border: 'none', padding: 0, textDecoration: 'none', letterSpacing: '0.02em', display: 'inline-flex', alignItems: 'center', gap: '6px', marginBottom: '28px', cursor: 'pointer' }}>
          <ArrowLeft style={{ width: 12, height: 12 }} /> Back to chat
        </button>

        {skinned ? (
          /* ---- Bento board -------------------------------------------
             The queue is genuinely dense — several pieces of pre-drafted
             work each competing for one decision — so it earns a grid,
             unlike the chat entry screen. 8 + 4: pending work in the main
             column, standing state in the rail.

             Exactly one tile carries the lifted tier, and it is the first
             pending item. That is the entire hierarchy: what to look at is
             answered by depth before anything is read. Classic keeps the
             notebook page below, untouched. */
          <div className="vera-bento">
            <div className="vera-bento-main">
              {/* REMOVED: the floating nudge strip that used to sit here.
                  Nudges are written into the board itself now (see
                  ensureNudgeItems in the api-server's routes/queue.ts), so they
                  appear as ordinary items among everything else Vera surfaces.
                  Keeping both would have shown the same prompt twice, and the
                  strip was the half that made the unread badge disagree with
                  the board it pointed at. */}
              <div className="vera-tile" style={{ padding: '20px 22px' }}>
                <p className="vera-t-support" style={{ margin: '0 0 2px' }}>{dateLabel}</p>
                <h1 className="vera-t-title" style={{ margin: '0 0 6px' }}>Today's {boardName}</h1>
                <p className="vera-label" style={{ margin: 0 }}>
                  EVERYTHING ASHER DRAFTED, DECIDED, OR FOUND WHILE YOU WERE AWAY
                </p>
                <div style={{ marginTop: '16px' }}>
                  <QuickAddRow
                    palette={palette}
                    onAdded={(itemId) => {
                      setRecentlyAdded((prev) => new Set(prev).add(itemId));
                      setTimeout(() => setRecentlyAdded((prev) => { const next = new Set(prev); next.delete(itemId); return next; }), 4000);
                    }}
                  />
                </div>
              </div>

              <QueueTabs tab={queueTab} onChange={setQueueTab} openCount={openItems.length} doneCount={doneItems.length} />

              {isLoading && <div className="vera-tile vera-tile-body vera-t-support">Loading…</div>}

              {!isLoading && items.length === 0 && (
                <div className="vera-tile vera-tile-body vera-t-support">
                  {queueTab === 'done'
                    ? 'Nothing completed yet — items you accept or dismiss collect here.'
                    : "Nothing waiting on you. This board fills from connectors and workflows, not from your chats — if it stays empty, connect something in the rail."}
                </div>
              )}

              {(Object.keys(CATEGORY_META) as Category[]).map((cat, catIndex) =>
                grouped[cat].length === 0 ? null : (
                  <div
                    key={cat}
                    ref={(el) => { sectionRefs.current[cat] = el; }}
                    /* Only the very first populated section is lifted — see
                       the one-E2-per-screen rule. */
                    className={`vera-tile${catIndex === firstPopulatedIndex ? ' vera-lift' : ''}`}
                  >
                    <div className="vera-tile-head">
                      <span className="vera-label">{CATEGORY_META[cat].label}</span>
                      {grouped[cat].filter((i) => i.status === 'pending').length > 0 && (
                        <span className="vera-tally">
                          {grouped[cat].filter((i) => i.status === 'pending').length} pending
                        </span>
                      )}
                    </div>
                    <div style={{ padding: '4px 16px 10px' }}>
                      {grouped[cat].map((item) => (
                        <Entry
                          key={item.id}
                          item={item}
                          palette={palette}
                          category={cat}
                          fresh={recentlyAdded.has(item.id)}
                          onHide={hideItem}
                          onOpenChat={onOpenChatById}
                        />
                      ))}
                    </div>
                  </div>
                ),
              )}
            </div>

            <div className="vera-bento-rail">
              {dailyBrief.data?.stats && (
                <div className="vera-tile">
                  <div className="vera-tile-head">
                    <span className="vera-label">Output</span>
                    <span className="vera-tally">
                      {dailyBrief.data.stats.daysActive} {dailyBrief.data.stats.daysActive === 1 ? 'day' : 'days'} active
                    </span>
                  </div>

                  {/* The streak leads, because it is the only figure here
                      that can go DOWN — everything below it is an
                      accumulating total that only ever climbs, and a column
                      of numbers that can't fall reads as decoration.

                      The at-risk state is the one moment this tile is worth
                      interrupting anyone about, so it gets the only colour
                      change on the board — and only then. See streakCaption. */}
                  {(() => {
                    const keptToday = keptStreakToday(dailyBrief.data.stats.activityByDay);
                    const caption = streakCaption(streak, keptToday);
                    const atRisk = caption.state === 'at-risk';
                    return (
                      <div
                        className="vera-streak"
                        style={atRisk ? { color: 'var(--v7-amber, #e0a868)' } : undefined}
                      >
                        <span
                          className="vera-streak-n"
                          style={atRisk ? { color: 'var(--v7-amber, #e0a868)' } : undefined}
                        >
                          {streak}
                        </span>
                        <span style={{ display: 'grid', gap: '2px', minWidth: 0 }}>
                          <span className="vera-t-heading">
                            {caption.label}
                            {atRisk && (
                              <span
                                className="font-mono"
                                style={{
                                  marginLeft: 7,
                                  fontSize: 9,
                                  letterSpacing: '0.12em',
                                  textTransform: 'uppercase',
                                  color: 'var(--v7-amber, #e0a868)',
                                }}
                              >
                                Ends tonight
                              </span>
                            )}
                          </span>
                          <span className="vera-t-support">{caption.note}</span>
                        </span>
                      </div>
                    );
                  })()}

                  {/* …and the week under it says whether that streak was
                      earned steadily or in one sitting, which no total can. */}
                  <div style={{ borderBottom: '1px solid var(--v7-border)' }}>
                    <ActivityWeek days={dailyBrief.data.stats.activityByDay ?? []} />
                  </div>

                  {/* The accumulating record, as structured data rather than
                      prose — this is the one place on the board where every
                      value is directly comparable, so it gets the key/value
                      system instead of a sentence.

                      SCOPE IS NOW STATED, and that is the fix rather than a
                      decoration. Every figure in this tile is a LIFETIME total,
                      while the monthly wrap counts the same-named things for the
                      current calendar month — so the two disagreed on "how many
                      decisions" and the board looked wrong next to a wrap that
                      was right. Nothing was miscomputed; the window was just
                      never named, which is worse, because a number a founder
                      believes is this month's and isn't is a number they can act
                      on wrongly.

                      Same reason the streak above needed the caption it now has:
                      "14 days active" (distinct days ever) sat directly above
                      "Day one" (consecutive days clearing the board), and read
                      as the panel contradicting itself. */}
                  <div className="vera-kv">
                    <div className="vera-kv-row">
                      <span className="k">Decisions</span>
                      <span className="v">{dailyBrief.data.stats.decisionsCaptured}</span>
                    </div>
                    <div className="vera-kv-row">
                      <span className="k">Lessons</span>
                      <span className="v">{dailyBrief.data.stats.lessonsLearned}</span>
                    </div>
                    <div className="vera-kv-row">
                      <span className="k">Automations</span>
                      <span className="v">{dailyBrief.data.stats.automationsCompleted}</span>
                    </div>
                    <div className="vera-kv-row">
                      <span className="k">Active goals</span>
                      <span className="v">{dailyBrief.data.stats.goalsActive}</span>
                    </div>
                    <div className="vera-kv-row">
                      <span className="k">Free time</span>
                      <span className="v">{freeTimeLabel(dailyBrief.data.stats.timeSavedMinutes)}</span>
                    </div>
                  </div>
                  <p className="vera-t-support" style={{ marginTop: 8 }}>
                    Totals since you started — the monthly review counts this month only, so the two won't match.
                  </p>
                </div>
              )}

              <ConnectedTile />

              <div className="vera-tile">
                <div className="vera-tile-head">
                  <span className="vera-label">Kept</span>
                  {savedAnalyses.length > 0 && <span className="vera-tally">{savedAnalyses.length}</span>}
                </div>
                <div className="vera-tile-body">
                  {savedAnalyses.length === 0 ? (
                    <p className="vera-t-support" style={{ margin: 0 }}>Nothing kept yet.</p>
                  ) : (
                    <>
                      {/* Share of the shelf by type — the magnitude bars are
                          the one place the accent appears in a data card. */}
                      {savedTypeCounts.map(([t, count]) => (
                        <div key={t} className="vera-bar-row" style={{ padding: '6px 0' }}>
                          <span style={{ display: 'grid', gap: '4px', minWidth: 0 }}>
                            <span className="vera-t-support" style={{ color: 'var(--v7-text-dim)' }}>{typeLabel(t)}</span>
                            <span className="vera-bar-track">
                              <span
                                className="vera-bar-fill"
                                style={{ width: `${Math.round((count / savedAnalyses.length) * 100)}%`, background: savedTypeColor(t, isLight) }}
                              />
                            </span>
                          </span>
                          <span className="vera-bar-val">{count}</span>
                        </div>
                      ))}
                      <button type="button" onClick={() => setView('book')} className="vera-key vera-key-2" style={{ marginTop: '12px', width: '100%', justifyContent: 'center' }}>
                        Open saved work <ArrowRight style={{ width: 13, height: 13 }} />
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        ) : (
        <div style={{ background: palette.paper, border: `1px solid ${palette.paperEdge}`, borderRadius: '4px 14px 14px 4px', padding: '34px 40px 40px 52px', position: 'relative', boxShadow: '0 30px 60px -30px rgba(0,0,0,0.6)', overflow: 'hidden' }}>
          {/* margin rule — the vertical notebook-page line */}
          <div style={{ position: 'absolute', left: 34, top: 0, bottom: 0, width: 1, background: palette.marginRule }} />
          {/* dog-ear */}
          <div style={{ position: 'absolute', top: 0, right: 0, width: 0, height: 0, borderStyle: 'solid', borderWidth: '0 34px 34px 0', borderColor: `transparent ${palette.dogear} transparent transparent` }} />

          <p style={{ fontStyle: 'italic', fontSize: '13px', color: palette.muted, margin: '0 0 4px' }}>{dateLabel}</p>
          <h1 style={{ fontSize: '28px', fontWeight: 500, margin: '0 0 6px' }}>Today's {boardName}</h1>
          <p style={{ fontFamily: "var(--v7-font-mono, 'IBM Plex Mono', monospace)", fontSize: '11.5px', color: palette.muted, letterSpacing: '0.01em', margin: '0 0 22px' }}>
            EVERYTHING ASHER DRAFTED, DECIDED, OR FOUND WHILE YOU WERE AWAY
          </p>

          {/* The retention hook from the build plan (section 7) — plain
              accumulating counts, never a percentage, so this reads as an
              operating history being built rather than a profile to finish.
              Lives here, not buried in a settings page, since this is the
              one screen a founder is meant to open every day. */}
          {dailyBrief.data?.stats && (
            <StreakBand palette={palette} stats={dailyBrief.data.stats} streak={streak} />
          )}

          {/* SAVED ANALYSIS — sits ABOVE the queue on purpose. It first went
              at the foot of the board, which meant a founder with a busy
              queue had to scroll past everything Vera did overnight to
              reach the things they'd deliberately kept — the busier the
              board, the more buried the shelf. One compact line here costs
              almost nothing and stays reachable no matter how full the
              queue gets. */}
          <div style={{ marginBottom: '24px', paddingBottom: '18px', borderBottom: `1px solid ${palette.line}` }}>
            {savedAnalyses.length === 0 ? (
              <p style={{ fontFamily: "var(--v7-font-mono, 'IBM Plex Mono', monospace)", fontSize: '10px', letterSpacing: '0.05em', color: palette.faint, margin: 0 }}>
                SAVED ANALYSIS · NOTHING KEPT YET
              </p>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  onClick={() => setView('book')}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: '7px',
                    fontFamily: "var(--vera-font-display, 'Fraunces', serif)", fontSize: '14px', fontStyle: 'italic',
                    background: 'transparent', border: 'none', padding: '0 0 2px',
                    color: palette.teal, borderBottom: `1px solid ${palette.tealBorder}`, cursor: 'pointer',
                  }}
                >
                  View saved analysis <ArrowRight style={{ width: 13, height: 13 }} />
                </button>

                <span style={{ display: 'flex', gap: '9px', flexWrap: 'wrap', alignItems: 'center' }}>
                  {savedTypeCounts.map(([t, count]) => (
                    <span
                      key={t}
                      title={`${typeLabel(t)} · ${count}`}
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: '5px',
                        fontFamily: "var(--v7-font-mono, 'IBM Plex Mono', monospace)", fontSize: '10px', color: palette.faint,
                      }}
                    >
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: savedTypeColor(t, isLight) }} />
                      {count}
                    </span>
                  ))}
                </span>
              </div>
            )}
          </div>

          <div style={{ display: 'flex', gap: '4px', marginBottom: '26px', flexWrap: 'wrap' }}>
            {/* Only categories that actually render a section below get a
                jump chip. The sections themselves are skipped when empty
                (see the `grouped[cat].length === 0 ? null` render further
                down), so a chip for an empty category pointed at a ref that
                was never attached and its click silently did nothing. */}
            {(Object.keys(CATEGORY_META) as Category[]).filter((cat) => grouped[cat].length > 0).map((cat) => (
              <button
                key={cat}
                onClick={() => sectionRefs.current[cat]?.scrollIntoView({ behavior: 'smooth' })}
                style={{ fontFamily: "var(--v7-font-mono, 'IBM Plex Mono', monospace)", fontSize: '10.5px', letterSpacing: '0.04em', color: palette.muted, background: 'transparent', border: `1px solid ${palette.paperEdge}`, padding: '6px 11px', borderRadius: '20px', cursor: 'pointer' }}
              >
                {CATEGORY_META[cat].label}
                {grouped[cat].filter((i) => i.status === 'pending').length > 0 && ` (${grouped[cat].filter((i) => i.status === 'pending').length})`}
              </button>
            ))}
          </div>

          <QuickAddRow
            palette={palette}
            onAdded={(itemId) => {
              setRecentlyAdded((prev) => new Set(prev).add(itemId));
              setTimeout(() => setRecentlyAdded((prev) => { const next = new Set(prev); next.delete(itemId); return next; }), 4000);
            }}
          />

          <QueueTabs tab={queueTab} onChange={setQueueTab} openCount={openItems.length} doneCount={doneItems.length} palette={palette} />

          {isLoading && <div style={{ fontSize: '13px', color: palette.muted }}>Loading…</div>}

          {!isLoading && items.length === 0 && (
            <div style={{ fontSize: '13.5px', color: palette.muted, fontStyle: 'italic' }}>
              {queueTab === 'done'
                ? 'Nothing completed yet — items you accept or dismiss collect here.'
                : `Nothing waiting on you. The ${boardName.toLowerCase()} fills from connectors and workflows, not from your chats — if it stays empty, connect something on the Workflows page.`}
            </div>
          )}

          {(Object.keys(CATEGORY_META) as Category[]).map((cat) =>
            grouped[cat].length === 0 ? null : (
              <div key={cat} ref={(el) => { sectionRefs.current[cat] = el; }} style={{ marginBottom: '8px' }}>
                <p style={{ fontFamily: "var(--v7-font-mono, 'IBM Plex Mono', monospace)", fontSize: '10px', letterSpacing: '0.1em', color: palette.faint, margin: '22px 0 4px' }}>
                  {CATEGORY_META[cat].label}
                </p>
                {grouped[cat].map((item) => (
                  <Entry
                    key={item.id}
                    item={item}
                    palette={palette}
                    category={cat}
                    fresh={recentlyAdded.has(item.id)}
                    onHide={hideItem}
                    onOpenChat={onOpenChatById}
                  />
                ))}
              </div>
            ),
          )}

        </div>
        )}
      </div>
      )}
    </div>
  );
}
