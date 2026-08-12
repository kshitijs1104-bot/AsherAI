/* ---------------------------------------------------------------------------
 * Fixtures for the design prototype.
 *
 * Card shapes match the live VenusCard schema in pages/Venus.tsx exactly
 * (analysis.points, risk.risks, roadmap.phases, decision.options) so the
 * renderers in views/CausalTrace.tsx port back without a schema change.
 * The workflow, dossier and connector shapes mirror lib/venusApi.ts.
 * ------------------------------------------------------------------------ */

export type CardType = 'analysis' | 'risk' | 'decision' | 'roadmap';

export interface AnalysisPoint { label: string; value: string; spark?: boolean }
export interface RiskItem { name: string; impact: string; mitigation: string }
export interface DecisionOption {
  name: string;
  chosen: boolean;
  reasoning: string;
  scores: Record<string, string>;
}
export interface RoadmapPhase {
  period: string;
  title: string;
  goal: string;
  actions: string[];
  metric: string;
}

export interface VeraCard {
  type: CardType;
  kind: string;
  title: string;
  collapsed?: boolean;
  content: {
    points?: AnalysisPoint[];
    risks?: RiskItem[];
    recommendation?: string;
    options?: DecisionOption[];
    phases?: RoadmapPhase[];
  };
}

export const CAUSE_CARD: VeraCard = {
  type: 'analysis',
  kind: 'Cause chain',
  title: 'What moved paid-search CAC',
  content: {
    points: [
      { label: 'The number', value: '`$412` → `$551` blended CAC on paid search, a **34% rise** since 12 May.', spark: true },
      { label: 'Where it moved', value: 'Non-brand only. Brand CAC is flat at `$88` and has not moved all quarter.' },
      { label: 'Cost vs. rate', value: 'CPC is up `11%`. Landing→trial conversion is down `19%`. **Conversion is doing most of the damage**, not auction pressure.' },
      { label: 'What changed', value: 'You shipped the pricing-page test on 12 May. Non-brand traffic lands on that page; brand traffic goes to `/`. That is the split the data draws.' },
      { label: 'Confidence', value: 'High on the timing — the break is on the deploy date. Medium on magnitude: three weeks of post-change data, one seasonal week inside it.' },
    ],
  },
};

export const RISK_CARD: VeraCard = {
  type: 'risk',
  kind: 'Exposure',
  title: 'What this costs while it runs',
  content: {
    risks: [
      {
        name: 'The test is still splitting traffic 50/50',
        impact: 'High',
        mitigation: 'At current spend the variant burns roughly `$1,900` a day at the worse conversion rate. Every day of "waiting for significance" is a real invoice.',
      },
      {
        name: 'Q3 plan is built on May CAC',
        impact: 'Medium',
        mitigation: 'The plan assumes `$412`. At `$551` the same budget lands about **900 fewer trials** by 30 September — which is the goal you set, not a rounding error.',
      },
      {
        name: 'A 7-day attribution window may be hiding recovery',
        impact: 'Low',
        mitigation: 'If non-brand buyers simply got slower, part of the drop is lag rather than loss. Worth a 30-day-window re-read before you call the variant dead.',
      },
    ],
  },
};

export const DECISION_CARD: VeraCard = {
  type: 'decision',
  kind: 'Decision',
  title: 'What to do about the variant',
  content: {
    recommendation: 'Cut the pricing-page variant to **10% of traffic today**. You keep collecting signal, and you stop paying full price for the worse arm.',
    options: [
      {
        name: 'Kill the variant now',
        chosen: false,
        reasoning: 'Fastest way to stop the bleed, but you throw away three weeks of spend and still will not know whether the page or the seasonality did it.',
        scores: { cost_to_reverse: 'High', time_to_signal: 'Never', cash_saved: '$1.9k/day' },
      },
      {
        name: 'Cut to 10% and keep running',
        chosen: true,
        reasoning: 'Recovers about `$1,700` a day immediately and still reaches significance — roughly five weeks out instead of two. Given you need the answer before Q3 planning locks, that timing still works.',
        scores: { cost_to_reverse: 'Low', time_to_signal: '~5 weeks', cash_saved: '$1.7k/day' },
      },
      {
        name: 'Let it run to significance',
        chosen: false,
        reasoning: 'Cleanest statistics, worst economics. Two more weeks at `$1,900` a day to sharpen a conclusion you can already act on.',
        scores: { cost_to_reverse: 'Low', time_to_signal: '~2 weeks', cash_saved: '$0' },
      },
    ],
  },
};

export const ROADMAP_CARD: VeraCard = {
  type: 'roadmap',
  kind: 'Sequence',
  title: 'Getting CAC back under $450',
  collapsed: true,
  content: {
    phases: [
      {
        period: 'This week',
        title: 'Cut the arm, re-read the window',
        goal: 'Drop the variant to 10% and re-pull non-brand conversion on a 30-day window to separate lag from loss.',
        actions: [
          'Set the split to 90/10 in the experiment config',
          'Re-pull 12 Apr–10 Jun on 30-day click',
          'Move the Q3 model onto a $520 placeholder until this resolves',
        ],
        metric: 'Daily paid spend at the worse arm → under $250',
      },
      {
        period: 'Weeks 2–4',
        title: 'Fix the landing mismatch',
        goal: 'Non-brand visitors arrive cold and hit pricing first. Give that traffic a page that answers "what is this" before "what does it cost".',
        actions: [
          'Route non-brand to a dedicated explainer, pricing one scroll down',
          'Hold brand traffic on the current page as the control',
        ],
        metric: 'Landing→trial back above 4.1%',
      },
      {
        period: 'By 30 Sep',
        title: 'Hold the goal',
        goal: 'Blended paid-search CAC under $450 with non-brand volume flat or better — not by cutting the channel down to brand terms.',
        actions: [
          'Weekly CAC-by-cohort check in the Command Centre',
          'Re-baseline the Q3 model once the test calls',
        ],
        metric: 'Blended CAC ≤ $450 · non-brand trials ≥ 780/mo',
      },
    ],
  },
};

export interface Turn {
  id: string;
  question: string;
  steps: string[];
  answer: string;
  cards: VeraCard[];
  sources: string[];
}

export const TURNS: Record<string, Turn> = {
  cac: {
    id: 'cac',
    question: 'CAC on paid search is up 34% since May and nobody can tell me why.',
    steps: [
      'Reading Google Ads, Stripe and your Dossier',
      'Splitting brand from non-brand spend',
      'Testing every change shipped in the window',
      'Checking the 12 May deploy against the break point',
    ],
    answer: 'It is not the auction — it is your own pricing page. The rise sits **entirely in non-brand search**, and it starts on the day you shipped the pricing test. Brand CAC never moved. Clicks got `11%` dearer; conversion fell `19%`. The second number is the one costing you money, and it is a decision you made rather than something the market did to you.',
    cards: [CAUSE_CARD, RISK_CARD],
    sources: ['Google Ads', 'Stripe', 'Dossier', '2 uploaded files', '41 events since 12 Apr'],
  },
  act: {
    id: 'act',
    question: 'So what do I actually do this week?',
    steps: [
      'Pricing the wait against the signal',
      'Re-reading your 30 Sep CAC goal',
      'Sequencing against Q3 planning lock',
    ],
    answer: 'Stop paying full price for the arm you already suspect. Cut the variant to **10% of traffic today** — you keep the experiment alive, you recover about `$1,700` a day, and you still have an answer before Q3 planning locks. Then fix the mismatch underneath it: non-brand visitors are landing on pricing before they know what you sell.',
    cards: [DECISION_CARD, ROADMAP_CARD],
    sources: ['Google Ads', 'this thread', 'Goal: CAC under $450 by 30 Sep'],
  },
};

export interface HistoryGroup { when: string; items: { id: string; title: string; time: string; active?: boolean }[] }

export const HISTORY: HistoryGroup[] = [
  {
    when: 'Today',
    items: [
      { id: 'h1', title: 'Paid search CAC — the May drift', time: '06:14', active: true },
      { id: 'h2', title: 'Q3 roadmap re-baseline', time: '05:02' },
    ],
  },
  {
    when: 'Yesterday',
    items: [
      { id: 'h3', title: 'Pricing page test — first read', time: '18:40' },
      { id: 'h4', title: 'Churn in the 12-month cohort', time: '14:22' },
      { id: 'h5', title: 'Who actually renewed in June', time: '09:15' },
    ],
  },
  {
    when: 'Last 7 days',
    items: [
      { id: 'h6', title: 'Series A narrative — what reads thin', time: '11 Aug' },
      { id: 'h7', title: "Mercury's pricing move, and whether it matters", time: '10 Aug' },
      { id: 'h8', title: 'Hiring plan against runway', time: '09 Aug' },
      { id: 'h9', title: 'Why enterprise trials stall at day 9', time: '08 Aug' },
    ],
  },
];

/* --- Workflow Hub -------------------------------------------------------- */

export type WorkflowState = 'active' | 'paused' | 'ghost';

export interface WorkflowTemplateFixture {
  id: string;
  name: string;
  description: string;
  cronLabel: string;
  connectors: { key: string; label: string }[];
  connectorsReady: boolean;
  state: WorkflowState;
  lastRun: string;
  queued: number;
}

export const WORKFLOWS: WorkflowTemplateFixture[] = [
  {
    id: 'wf-cac',
    name: 'Weekly CAC by cohort',
    description: 'Re-pulls acquisition cost split by channel and cohort, and flags any channel that drifts more than 10%.',
    cronLabel: 'Mon 06:00',
    connectors: [{ key: 'sheets', label: 'Sheets' }, { key: 'gmail', label: 'Gmail' }],
    connectorsReady: true,
    state: 'active',
    lastRun: 'Today 06:14',
    queued: 3,
  },
  {
    id: 'wf-brief',
    name: 'Overnight brief',
    description: 'Runs the standing questions while you sleep and leaves one summary at the top of your queue.',
    cronLabel: 'Daily 05:30',
    connectors: [{ key: 'calendar', label: 'Calendar' }, { key: 'notion', label: 'Notion' }],
    connectorsReady: true,
    state: 'active',
    lastRun: 'Today 05:31',
    queued: 1,
  },
  {
    id: 'wf-renewal',
    name: 'Renewal risk sweep',
    description: 'Scores every account inside 60 days of renewal against usage decline and support volume.',
    cronLabel: 'Thu 08:00',
    connectors: [{ key: 'jira', label: 'Jira' }],
    connectorsReady: true,
    state: 'paused',
    lastRun: '07 Aug 08:00',
    queued: 0,
  },
  {
    id: 'wf-competitor',
    name: 'Competitor pricing watch',
    description: 'Watches named competitors for pricing and packaging changes, and tells you what it means for your own page.',
    cronLabel: 'Daily 07:00',
    connectors: [{ key: 'slack', label: 'Slack' }, { key: 'linkedin', label: 'LinkedIn' }],
    connectorsReady: false,
    state: 'ghost',
    lastRun: 'Never run',
    queued: 0,
  },
];

/* --- Dossier Storage ----------------------------------------------------- */

export interface DossierField { key: string; label: string; value: string | null }

export const DOSSIER_FIELDS: DossierField[] = [
  { key: 'stage', label: 'Stage', value: 'Seed, 14 months post-raise' },
  { key: 'model', label: 'Business model', value: 'Annual SaaS, self-serve trial into sales-assisted close' },
  { key: 'icp', label: 'Who it is for', value: 'Finance and ops leads at 50–400 person B2B companies' },
  { key: 'acv', label: 'Average contract value', value: '$14,200' },
  { key: 'runway', label: 'Runway', value: '19 months at current burn' },
  { key: 'team', label: 'Team size', value: '11 — 6 engineering, 3 GTM, 2 founders' },
  { key: 'channel', label: 'Primary channel', value: 'Paid search, then founder-led outbound' },
  { key: 'moat', label: 'What is defensible', value: 'The causal graph built from a customer\'s own history — it gets more accurate the longer they stay' },
  { key: 'board', label: 'Board cadence', value: null },
  { key: 'pricing_floor', label: 'Pricing floor', value: null },
  { key: 'churn_def', label: 'How you define churn', value: null },
];

export interface WrapStat {
  label: string;
  value: string;
  previous: string | null;
  changePct: number | null;
  good: boolean;
}

export const WRAP_STATS: WrapStat[] = [
  { label: 'Decisions closed', value: '14', previous: '9', changePct: 56, good: true },
  { label: 'Blended CAC', value: '$551', previous: '$412', changePct: 34, good: false },
  { label: 'Trials started', value: '612', previous: '705', changePct: -13, good: false },
  { label: 'Net revenue retention', value: '108%', previous: '104%', changePct: 4, good: true },
];

export interface WrapTile { label: string; body: string; span: 1 | 2 }

export const WRAP_TILES: WrapTile[] = [
  {
    label: 'One thing to change',
    body: 'Stop running the pricing test at full traffic. It is the single largest controllable line in the month, and you already have enough signal to act.',
    span: 2,
  },
  {
    label: 'What you spent it on',
    body: 'Paid search took 61% of spend, up from 48%. Content and events were flat. Nothing was cut to pay for the increase — it came out of runway.',
    span: 1,
  },
  {
    label: 'Goals you closed',
    body: 'Two of four. NRR above 105% landed early. The CAC goal slipped and is the one carrying into September.',
    span: 1,
  },
  {
    label: 'Busiest day',
    body: '22 July — 9 decisions logged, 3 of them reversed within a week. Worth asking what made that day different.',
    span: 1,
  },
  {
    label: 'What you learned',
    body: 'Brand and non-brand behave like two different businesses. Every metric you read blended hid that for eleven weeks.',
    span: 1,
  },
  {
    label: 'The month in one line',
    body: 'You grew retention and lost efficiency, and the second one was self-inflicted.',
    span: 2,
  },
];

export const WRAP_PERIODS = ['2026-08', '2026-07', '2026-06', '2026-05', '2026-04', '2026-03'];

/* --- Data Connections ---------------------------------------------------- */

export type ConnectorState = 'connected' | 'disconnected' | 'error' | 'soon';

export interface ConnectorFixture {
  type: string;
  label: string;
  category: string;
  state: ConnectorState;
  detail: string;
  lastSync: string | null;
  records: string | null;
}

export const CONNECTORS: ConnectorFixture[] = [
  { type: 'stripe', label: 'Stripe', category: 'Revenue', state: 'connected', detail: 'Charges, subscriptions and refunds since Jan 2025', lastSync: '4 minutes ago', records: '18,402 events' },
  { type: 'gads', label: 'Google Ads', category: 'Acquisition', state: 'connected', detail: 'Spend, clicks and conversions by campaign and keyword', lastSync: '11 minutes ago', records: '2,930 rows' },
  { type: 'sheets', label: 'Google Sheets', category: 'Planning', state: 'connected', detail: 'Your Q3 model and the hiring plan tab', lastSync: '2 hours ago', records: '4 sheets' },
  { type: 'gmail', label: 'Gmail', category: 'Comms', state: 'connected', detail: 'Threads with customers, read-only and never sent from', lastSync: '38 minutes ago', records: '1,204 threads' },
  { type: 'calendar', label: 'Google Calendar', category: 'Comms', state: 'connected', detail: 'Meeting volume and who you actually spend time with', lastSync: '1 hour ago', records: '316 events' },
  { type: 'notion', label: 'Notion', category: 'Planning', state: 'error', detail: 'Token expired on 09 Aug — reconnect to resume the roadmap sync', lastSync: 'Failed 3 days ago', records: null },
  { type: 'slack', label: 'Slack', category: 'Comms', state: 'disconnected', detail: 'Channel activity and the questions your team asks most', lastSync: null, records: null },
  { type: 'jira', label: 'Jira', category: 'Delivery', state: 'disconnected', detail: 'Ticket throughput and what actually shipped against the roadmap', lastSync: null, records: null },
  { type: 'whatsapp', label: 'WhatsApp Business', category: 'Comms', state: 'disconnected', detail: 'Needs a phone number ID and permanent token from Meta Business', lastSync: null, records: null },
  { type: 'linkedin', label: 'LinkedIn', category: 'Acquisition', state: 'soon', detail: 'Company page and outbound performance', lastSync: null, records: null },
];
