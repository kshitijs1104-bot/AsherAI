// Fixture data for the screenshot harness (see shots.html / main.tsx).
//
// Dev-only. Nothing here is imported by the product bundle — index.html never
// reaches this directory. It exists so the real CommandCenterSection can be
// mounted and photographed without a Clerk session or a running api-server,
// which is what the Remotion ad in scripts/video-ad-remotion is built from.
//
// The shapes are the real ones from venusApi.ts, so a change to the API
// contract breaks the harness at typecheck rather than silently producing
// screenshots of a UI that no longer exists.

import type {
  QueueItem,
  DailyBrief,
  ConnectorStatus,
  UsageDay,
  GoalWithChat,
} from '../lib/venusApi';
import type { SavedAnalysis } from '../lib/venusHistory';

// Everything is dated relative to a fixed hour of *today* rather than a
// hardcoded ISO string, so the board's "8:14 AM" timestamps and its
// "Tuesday, July 28" header always agree with each other no matter when the
// screenshots get re-taken.
function todayAt(hour: number, minute: number): string {
  const d = new Date();
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

function base(id: number): Pick<QueueItem, 'id' | 'userId' | 'resolvedAt' | 'externalId' | 'metadataJson' | 'seenAt'> {
  // externalId/metadataJson are null on every fixture deliberately. A gmail
  // row without metadataJson is one the board reports as un-sendable, which
  // is the honest state for a fixture — these are photographed for the ad and
  // must not show Vera claiming it will send mail from an account that does
  // not exist.
  //
  // seenAt is null so these photograph as UNREAD — which is the state the ad
  // wants (work waiting, notification live), and the honest one for a board
  // nobody has opened.
  return { id, userId: 'shots', resolvedAt: null, externalId: null, metadataJson: null, seenAt: null };
}

/**
 * The overnight board: four sections, work already done, nothing asked for.
 *
 * Every line names a CAPABILITY rather than a customer. These fixtures exist
 * to be photographed for the ad, and the ad is published — so a row says "a
 * thread went quiet and Vera wrote the follow-up", not who, for how much, on
 * what terms. Invented specifics read as real business logic to anyone
 * studying a frame, and none of them are needed to show what the product does.
 *
 * The structure is untouched: source, timestamp, draft body, the accept /
 * edit / dismiss triad, the unprompted-follow-up treatment. That structure is
 * the feature. The contents are not.
 */
export const QUEUE_PENDING: QueueItem[] = [
  {
    ...base(101),
    type: 'draft_reply',
    source: 'gmail',
    title: 'A thread went quiet — reply drafted',
    body: 'Nine days with no answer',
    draftContent:
      'Following up on this one — happy to pick it back up whenever the timing works on your side.\n\nIf it helps, I can send a short summary of where we left off so nobody has to re-read the thread.',
    status: 'pending',
    createdAt: todayAt(6, 12),
  },
  {
    ...base(102),
    type: 'draft_reply',
    source: 'slack',
    title: 'Someone asked for a number you track',
    body: 'Answered from the sheet it lives in',
    draftContent:
      'Pulled the current figures — in line with last month, and the trend has not moved. Full breakdown is in the usual sheet.',
    status: 'pending',
    createdAt: todayAt(7, 3),
  },
  {
    ...base(103),
    type: 'draft_reply',
    source: 'linkedin',
    title: 'A decision you made this week, written up',
    body: 'You said the reasoning was worth sharing',
    draftContent:
      'We changed how we price. Not for the reason you would guess — the numbers pointed the other way.',
    status: 'pending',
    createdAt: todayAt(7, 41),
  },
  {
    ...base(201),
    type: 'decision_followup',
    source: 'gmail',
    title: 'A decision from six weeks ago is now unblocked',
    body: 'The thing you were waiting on shipped on Friday',
    draftContent: null,
    status: 'pending',
    createdAt: todayAt(5, 58),
  },
  {
    ...base(202),
    type: 'decision_followup',
    source: 'notion',
    title: 'A pause you set in spring has no end date',
    body: 'The plan changed around it last week',
    draftContent: null,
    status: 'pending',
    createdAt: todayAt(6, 30),
  },
  {
    ...base(301),
    type: 'automation_suggestion',
    source: 'sheets',
    title: 'You do the same export every Monday at 9',
    body: 'Eleven weeks running. Vera can have it done before you get in.',
    draftContent: null,
    status: 'pending',
    createdAt: todayAt(8, 2),
  },
  {
    ...base(302),
    type: 'goal_risk',
    source: 'jira',
    title: 'A goal is behind by more than a week',
    body: 'The work slipped twice; the date never moved',
    draftContent: null,
    status: 'pending',
    createdAt: todayAt(8, 14),
  },
  {
    ...base(401),
    type: 'insight',
    source: 'gmail',
    title: 'Three conversations stalled on the same question',
    body: 'Same objection, same week',
    draftContent: null,
    status: 'pending',
    createdAt: todayAt(4, 47),
  },
  {
    ...base(402),
    type: 'insight',
    source: 'whatsapp',
    title: 'Something agreed in a chat never reached the plan',
    body: 'Recorded so the two stop disagreeing',
    draftContent: null,
    status: 'pending',
    createdAt: todayAt(5, 20),
  },
];

/**
 * The same board a few seconds later. Only `status` and `resolvedAt` differ —
 * which is exactly what beat 4 of the ad needs: a real pending → done state
 * change photographed from the real component, not a highlight overlay faked
 * on top of one screenshot.
 */
export const QUEUE_RESOLVED: QueueItem[] = QUEUE_PENDING.map((item, i) => ({
  ...item,
  status: i % 3 === 1 ? ('edited' as const) : ('accepted' as const),
  resolvedAt: todayAt(9, 5),
}));

function week(): UsageDay[] {
  const shape = [
    { touches: 6, actions: 3 },
    { touches: 11, actions: 7 },
    { touches: 8, actions: 5 },
    { touches: 14, actions: 9 },
    { touches: 4, actions: 2 },
    { touches: 12, actions: 8 },
    { touches: 9, actions: 6 },
  ];
  const today = new Date();
  return shape.map((s, i) => {
    const d = new Date(today);
    d.setDate(today.getDate() - (6 - i));
    return {
      date: d.toISOString().slice(0, 10),
      weekday: d.getDay(),
      touches: s.touches,
      actions: s.actions,
    };
  });
}

export const DAILY_BRIEF: DailyBrief = {
  topDecision: null,
  biggestRisk: null,
  blockedTask: null,
  assumptionChange: null,
  stats: {
    decisionsResolved: 31,
    goalsCompleted: 7,
    goalsActive: 4,
    daysActive: 96,
    valueTrackedInr: 0,
    decisionsCaptured: 128,
    lessonsLearned: 42,
    automationsCompleted: 316,
    timeSavedMinutes: 380,
    queueStreakDays: 23,
    activityByDay: week(),
  },
};

export const CONNECTORS: ConnectorStatus[] = [
  { type: 'gmail', label: 'Gmail', implemented: true, status: 'connected', lastSyncedAt: todayAt(8, 40), lastError: null },
  { type: 'slack', label: 'Slack', implemented: true, status: 'connected', lastSyncedAt: todayAt(8, 38), lastError: null },
  { type: 'notion', label: 'Notion', implemented: true, status: 'connected', lastSyncedAt: todayAt(8, 12), lastError: null },
  { type: 'sheets', label: 'Google Sheets', implemented: true, status: 'connected', lastSyncedAt: todayAt(7, 55), lastError: null },
  { type: 'jira', label: 'Jira', implemented: true, status: 'connected', lastSyncedAt: todayAt(7, 30), lastError: null },
];

/** Seeds the "Kept" tile, which reads localStorage rather than the API. */
export const SAVED_ANALYSES: SavedAnalysis[] = [
  { id: 's1', type: 'risk', title: 'What happens if funding takes longer', summary: '', savedAt: todayAt(9, 0) },
  { id: 's2', type: 'risk', title: 'How concentrated our revenue really is', summary: '', savedAt: todayAt(9, 0) },
  { id: 's3', type: 'roadmap', title: 'Sequencing the next two quarters', summary: '', savedAt: todayAt(9, 0) },
  { id: 's4', type: 'roadmap', title: 'What ships before launch', summary: '', savedAt: todayAt(9, 0) },
  { id: 's5', type: 'roadmap', title: 'The cut list if the team stays flat', summary: '', savedAt: todayAt(9, 0) },
  { id: 's6', type: 'competitive', title: 'Where we keep losing, and why', summary: '', savedAt: todayAt(9, 0) },
  { id: 's7', type: 'pattern', title: 'The pattern behind customers who leave', summary: '', savedAt: todayAt(9, 0) },
  { id: 's8', type: 'fundraising', title: 'What an investor asks for first', summary: '', savedAt: todayAt(9, 0) },
];

/** Chat titles for the sidebar's history list. */
export const SESSION_TITLES: string[] = [
  'Should we change how we price',
  'When to make the next hire',
  'Why the launch keeps slipping',
  'What is blocking the bigger deals',
  'Rewriting the pricing page',
];

// ---- Goals -----------------------------------------------------------------
// The cross-chat goal list. Same rule as the queue above: these describe the
// SHAPE of a goal — a metric, a deadline, a risk state, sub-tasks resolved
// against it — without publishing anything that reads as a real target.

function inDays(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString();
}

export const GOALS: GoalWithChat[] = [
  {
    id: 1, chatId: 11, title: 'Get to predictable monthly revenue',
    successMetric: 'Three months of growth without a one-off',
    valueInr: 0, deadline: inDays(38), status: 'active', evidenceScore: 74,
    position: 0.72, risk: 'on_track', chatTitle: 'Should we change how we price',
    subTasks: [
      { id: 1, cardType: 'decision', summary: 'Settle the pricing floor', status: 'resolved', outcomeSentiment: 'positive' },
      { id: 2, cardType: 'roadmap', summary: 'Rewrite the pricing page', status: 'open', outcomeSentiment: null },
    ],
  },
  {
    id: 2, chatId: 12, title: 'Ship the thing that keeps slipping',
    successMetric: 'In front of customers, not in a branch',
    valueInr: 0, deadline: inDays(21), status: 'active', evidenceScore: 41,
    position: 0.45, risk: 'at_risk', chatTitle: 'Why the launch keeps slipping',
    subTasks: [
      { id: 3, cardType: 'roadmap', summary: 'Unblock the dependency', status: 'resolved', outcomeSentiment: 'positive' },
      { id: 4, cardType: 'decision', summary: 'Cut scope or move the date', status: 'open', outcomeSentiment: null },
    ],
  },
  {
    id: 3, chatId: 13, title: 'Stop losing the bigger deals late',
    successMetric: 'No more stalls at the same question',
    valueInr: 0, deadline: inDays(9), status: 'active', evidenceScore: 58,
    position: 0.28, risk: 'off_track', chatTitle: 'What is blocking the bigger deals',
    subTasks: [
      { id: 5, cardType: 'decision', summary: 'Answer the objection once, properly', status: 'open', outcomeSentiment: null },
    ],
  },
  {
    id: 4, chatId: 14, title: 'Make onboarding stick',
    successMetric: 'Most new accounts reach first value',
    valueInr: 0, deadline: inDays(-4), status: 'completed', evidenceScore: 91,
    position: 1, risk: 'on_track', chatTitle: 'Rewriting the pricing page',
    subTasks: [],
  },
];

/** The prompt sitting above Vera's thinking indicator. */
export const CHAT_PROMPT = 'What should I be worried about this week?';
