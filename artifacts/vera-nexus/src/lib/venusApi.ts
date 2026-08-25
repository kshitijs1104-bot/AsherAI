import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

// Raw-fetch helpers for backend routes that predate/sit outside the
// generated OpenAPI client (@workspace/api-client-react) — same pattern
// already used by GoalPanel's reportSubTaskOutcome and Venus.tsx's
// company-report call. Cookies carry the Clerk session for same-origin
// requests, so no bearer token needs attaching here.
async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!response.ok) {
    // Surface the backend's own error message when there is one (e.g. "Connect
    // LinkedIn first", "Gmail isn't connected — reconnect it to send this.") —
    // several connector-backed actions can now fail for a real, actionable
    // reason instead of just a generic HTTP status.
    const message = await response
      .json()
      .then((body) => (typeof body?.error === 'string' ? body.error : null))
      .catch(() => null);
    throw new Error(message ?? `Request failed with status ${response.status}`);
  }
  return response.json();
}

// ---- Goals (cross-chat) ----

export interface GoalSubTask {
  id: number;
  cardType: 'decision' | 'roadmap';
  summary: string;
  status: 'open' | 'resolved' | 'abandoned';
  outcomeSentiment: 'positive' | 'negative' | 'mixed' | null;
}

export interface GoalWithChat {
  id: number;
  chatId: number;
  title: string;
  successMetric: string;
  valueInr: number;
  deadline: string;
  status: 'active' | 'completed' | 'abandoned';
  evidenceScore: number;
  position: number;
  risk: 'on_track' | 'at_risk' | 'off_track';
  chatTitle: string;
  subTasks: GoalSubTask[];
}

export function useGoals() {
  return useQuery({
    queryKey: ['/api/goals'],
    queryFn: () => apiFetch<{ goals: GoalWithChat[] }>('/api/goals'),
  });
}

// ---- Decision Memory ----

export interface VenusDecisionRow {
  id: number;
  chatId: number | null;
  query: string;
  cardType: 'decision' | 'roadmap';
  recommendationSummary: string;
  status: 'open' | 'resolved' | 'abandoned';
  outcome: string | null;
  lesson: string | null;
  outcomeSentiment: 'positive' | 'negative' | 'mixed' | null;
  decisionType: string | null;
  archived: boolean;
  reinforcedCount: number;
  createdAt: string;
  resolvedAt: string | null;
}

export interface DecisionFilters {
  status?: 'open' | 'resolved' | 'abandoned';
  decisionType?: string;
  includeArchived?: boolean;
}

export function useDecisions(filters: DecisionFilters) {
  const params = new URLSearchParams();
  if (filters.status) params.set('status', filters.status);
  if (filters.decisionType) params.set('decisionType', filters.decisionType);
  if (filters.includeArchived) params.set('includeArchived', 'true');
  const qs = params.toString();

  return useQuery({
    queryKey: ['/api/ai/decisions', filters],
    queryFn: () => apiFetch<{ decisions: VenusDecisionRow[] }>(`/api/ai/decisions${qs ? `?${qs}` : ''}`),
  });
}

export function useArchiveDecision() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => apiFetch(`/api/ai/decisions/${id}/archive`, { method: 'PATCH' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['/api/ai/decisions'] }),
  });
}

// ---- Roadmap Tracker ----

export interface RoadmapAction {
  text: string;
  status: 'pending' | 'done' | 'skipped';
  completedAt?: string;
}

export interface RoadmapPhase {
  period: string;
  title: string;
  metric?: string;
  actions: RoadmapAction[];
}

export interface RoadmapWithPhases {
  id: number;
  chatId: number;
  title: string;
  horizon: string | null;
  status: 'active' | 'superseded' | 'archived';
  phases: RoadmapPhase[];
}

export function useRoadmap(chatId: number | undefined) {
  return useQuery({
    queryKey: ['/api/chats', chatId, 'roadmap'],
    queryFn: () => apiFetch<RoadmapWithPhases>(`/api/chats/${chatId}/roadmap`),
    enabled: !!chatId,
    // A chat with no roadmap yet 404s — that's an expected, common state
    // (most chats never produce a roadmap card), not a real failure worth
    // retrying or surfacing as an error.
    retry: false,
  });
}

export function useSetRoadmapActionStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { roadmapId: number; phaseIndex: number; actionIndex: number; status: RoadmapAction['status'] }) =>
      apiFetch<RoadmapWithPhases>(`/api/roadmaps/${input.roadmapId}/actions`, {
        method: 'PATCH',
        body: JSON.stringify({ phaseIndex: input.phaseIndex, actionIndex: input.actionIndex, status: input.status }),
      }),
    onSuccess: (updated) => {
      queryClient.setQueryData(['/api/chats', updated.chatId, 'roadmap'], updated);
    },
  });
}

// ---- Company Memory (facts) ----

export interface CompanyFact {
  id: number;
  factText: string;
  factType: string;
  sourceType: string;
  createdAt: string;
}

export function useCompanyFacts() {
  return useQuery({
    queryKey: ['/api/company-facts'],
    queryFn: () => apiFetch<{ facts: CompanyFact[] }>('/api/company-facts'),
  });
}

export function useAddCompanyFact() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { factText: string; sourceType: 'checkin' | 'manual'; factType?: string }) =>
      apiFetch<{ fact: CompanyFact }>('/api/company-facts', { method: 'POST', body: JSON.stringify(input) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['/api/company-facts'] }),
  });
}

// ---- Daily Brief (Decision Inbox rollup) ----

export interface DailyBriefDecision {
  id: number;
  chatId: number | null;
  query: string;
  recommendationSummary: string;
  reinforcedCount: number;
}

export interface DailyBriefRisk {
  id: number;
  chatId: number;
  title: string;
  risk: 'on_track' | 'at_risk' | 'off_track';
  deadline: string;
}

export interface DailyBriefBlockedTask {
  roadmapId: number;
  roadmapTitle: string;
  phasePeriod: string;
  actionText: string;
}

export interface DailyBriefAssumptionChange {
  previousText: string | null;
  currentText: string;
  changedAt: string | null;
}

// One column of the board's week strip. See getUsageStats on the server —
// the same activity the totals below are summed from, sliced by UTC day.
export interface UsageDay {
  date: string;
  weekday: number;
  touches: number;
  actions: number;
}

export interface DailyBriefStats {
  decisionsResolved: number;
  goalsCompleted: number;
  goalsActive: number;
  daysActive: number;
  valueTrackedInr: number;
  decisionsCaptured: number;
  lessonsLearned: number;
  automationsCompleted: number;
  timeSavedMinutes: number;
  queueStreakDays: number;
  // Optional on purpose: a server that predates the week strip returns a
  // brief without it, and the board should render its counters rather than
  // crash on an older deploy.
  activityByDay?: UsageDay[];
}

export interface DailyBrief {
  topDecision: DailyBriefDecision | null;
  biggestRisk: DailyBriefRisk | null;
  blockedTask: DailyBriefBlockedTask | null;
  assumptionChange: DailyBriefAssumptionChange | null;
  stats: DailyBriefStats;
}

export function useDailyBrief() {
  return useQuery({
    queryKey: ['/api/daily-brief'],
    queryFn: () => apiFetch<DailyBrief>('/api/daily-brief'),
  });
}

// ---- Command Center queue ----

export type QueueItemStatus = 'pending' | 'accepted' | 'edited' | 'rejected' | 'dismissed';

export interface QueueItem {
  id: number;
  userId: string;
  type: string;
  source: string;
  title: string;
  body: string;
  draftContent: string | null;
  status: QueueItemStatus;
  createdAt: string;
  resolvedAt: string | null;
  // Both were always returned by GET /api/queue (the route selects whole
  // rows) but went undeclared here, so the board couldn't use them. They are
  // what lets a row point back at the thing it came from: `externalId` on a
  // decision follow-up is `decision-<id>`, which is the only link between a
  // board row and the chat the decision was made in.
  externalId: string | null;
  metadataJson: string | null;
  /** Null until the board has actually been on screen — drives the dot. */
  seenAt: string | null;
}

export function useQueue() {
  return useQuery({
    queryKey: ['/api/queue'],
    // `unseen` is counted server-side rather than derived from `items`, because
    // the list is capped at 50 — deriving it would under-report exactly when a
    // founder has the most waiting.
    queryFn: () => apiFetch<{ items: QueueItem[]; unseen: number }>('/api/queue'),
    // The notification bell polls off this same query — a founder acting on
    // an item in another tab (or a background job dropping in a new one)
    // should clear/update the badge without a manual refresh.
    refetchInterval: 60_000,
  });
}

/**
 * Clears the notification dot. Called when the board is actually SHOWN, never
 * as a side effect of fetching it — TanStack Query refetches on window focus,
 * so marking on read would clear the dot whenever a founder alt-tabbed back to
 * a tab parked on another page, without the items ever being on screen. A dot
 * that clears itself is a dot nobody trusts.
 */
export function useMarkQueueSeen() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<{ marked: number; unseen: number }>('/api/queue/seen', { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['/api/queue'] }),
  });
}

export function useQueueAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: number; action: 'accept' | 'edit' | 'reject' | 'dismiss'; editedContent?: string }) =>
      apiFetch<{ item: QueueItem }>(`/api/queue/${input.id}/action`, {
        method: 'POST',
        body: JSON.stringify({ action: input.action, edited_content: input.editedContent }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/queue'] });
    },
  });
}

export interface QueueResolveProposal {
  name: string;
  arguments: Record<string, unknown>;
}

export interface QueueResolveResponse {
  assistant: string;
  proposal: QueueResolveProposal | null;
  unavailable: boolean;
}

export function useQueueResolveMessage() {
  return useMutation({
    mutationFn: (input: { id: number; message: string; history?: { role: 'user' | 'assistant'; content: string }[] }) =>
      apiFetch<QueueResolveResponse>(`/api/queue/${input.id}/resolve/message`, {
        method: 'POST',
        body: JSON.stringify({ message: input.message, history: input.history ?? [] }),
      }),
  });
}

export function useQueueResolveConfirm() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: number; proposal: QueueResolveProposal }) =>
      apiFetch<{ item: QueueItem; result: unknown }>(`/api/queue/${input.id}/resolve/confirm`, {
        method: 'POST',
        body: JSON.stringify({ name: input.proposal.name, arguments: input.proposal.arguments }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['/api/queue'] }),
  });
}

// ---- Connectors ----

export interface ConnectorStatus {
  type: string;
  label: string;
  implemented: boolean;
  status: 'connected' | 'error' | 'disconnected';
  lastSyncedAt: string | null;
  lastError: string | null;
}

// Publishes an already-approved draft from the chat's draft workspace. The
// text is sent verbatim — nothing is regenerated — so what publishes is
// exactly what the founder read.
export function usePublishDraft() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { channel: 'linkedin'; content: string }) =>
      apiFetch<{ published: boolean; postId: string }>('/api/actions/publish', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/queue'] });
      queryClient.invalidateQueries({ queryKey: ['/api/daily-brief'] });
    },
  });
}

export function useConnectors() {
  return useQuery({
    queryKey: ['/api/connectors'],
    queryFn: () => apiFetch<{ connectors: ConnectorStatus[] }>('/api/connectors'),
  });
}

// A real browser navigation, not a fetch — the server responds with a 302
// to Google's consent screen, which only works as a top-level page load.
export function startConnectorAuth(type: string) {
  window.location.href = `/api/connectors/${type}/auth`;
}

export function useSyncConnector() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (type: string) => apiFetch<{ created: number }>(`/api/connectors/${type}/sync`, { method: 'POST' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/connectors'] });
      queryClient.invalidateQueries({ queryKey: ['/api/queue'] });
    },
  });
}

export function useDisconnectConnector() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (type: string) => apiFetch<{ ok: boolean }>(`/api/connectors/${type}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/connectors'] });
    },
  });
}

// WhatsApp has no OAuth redirect (see the backend's routes/connectors.ts
// comment on /connectors/whatsapp/config) — the founder already holds a
// permanent token + phone number id from their own Meta Business console,
// so "connecting" is just submitting those two values.
export function useConfigureWhatsapp() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { phoneNumberId: string; permanentToken: string }) =>
      apiFetch<{ ok: boolean }>('/api/connectors/whatsapp/config', { method: 'POST', body: JSON.stringify(input) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/connectors'] });
    },
  });
}

// ---- Instant-Use Actions ----

export type InstantActionType = 'draft_reply' | 'sell_this' | 'summarize' | 'follow_up';

// ---- Workflows ----

export interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  requiredConnectors: string[];
  defaultCron: string;
  cronLabel: string;
  activated: boolean;
  connectorsReady: boolean;
}

export interface WorkflowRow {
  id: number;
  userId: string;
  templateId: string;
  name: string;
  status: 'active' | 'paused';
  connectorTypesJson: string;
  scheduleCron: string;
  lastRunAt: string | null;
  createdAt: string;
}

export function useWorkflowTemplates() {
  return useQuery({
    queryKey: ['/api/workflows/templates'],
    queryFn: () => apiFetch<{ templates: WorkflowTemplate[] }>('/api/workflows/templates'),
  });
}

export function useWorkflows() {
  return useQuery({
    queryKey: ['/api/workflows'],
    queryFn: () => apiFetch<{ workflows: WorkflowRow[] }>('/api/workflows'),
  });
}

function invalidateWorkflowQueries(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: ['/api/workflows'] });
  queryClient.invalidateQueries({ queryKey: ['/api/workflows/templates'] });
}

export function useActivateWorkflow() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (templateId: string) =>
      apiFetch<{ workflow: WorkflowRow }>('/api/workflows', { method: 'POST', body: JSON.stringify({ templateId }) }),
    onSuccess: () => invalidateWorkflowQueries(queryClient),
  });
}

export function useSetWorkflowStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: number; status: 'active' | 'paused' }) =>
      apiFetch<{ workflow: WorkflowRow }>(`/api/workflows/${input.id}`, { method: 'PATCH', body: JSON.stringify({ status: input.status }) }),
    onSuccess: () => invalidateWorkflowQueries(queryClient),
  });
}

export function useDeleteWorkflow() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => apiFetch<{ ok: boolean }>(`/api/workflows/${id}`, { method: 'DELETE' }),
    onSuccess: () => invalidateWorkflowQueries(queryClient),
  });
}

export function useRunWorkflowNow() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => apiFetch<{ created: number }>(`/api/workflows/${id}/run`, { method: 'POST' }),
    onSuccess: () => {
      invalidateWorkflowQueries(queryClient);
      queryClient.invalidateQueries({ queryKey: ['/api/queue'] });
    },
  });
}

export function useRunInstantAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { type: InstantActionType; input: string; mode: 'instant' | 'queue'; postTo?: 'linkedin' }) =>
      apiFetch<{ result?: string; queued?: boolean; item?: QueueItem }>(`/api/actions/${input.type}/run`, {
        method: 'POST',
        body: JSON.stringify({ input: input.input, mode: input.mode, postTo: input.postTo }),
      }),
    onSuccess: (_, variables) => {
      if (variables.mode === 'queue') queryClient.invalidateQueries({ queryKey: ['/api/queue'] });
    },
  });
}

// ---- The Dossier (company file + monthly wrap) ----

export interface DossierField {
  key: string;
  label: string;
  value: string | null;
}

export interface DossierQuestion {
  id: string;
  question: string;
  why: string;
  fills?: string;
}

export interface Dossier {
  id: number;
  companyName: string | null;
  oneLine: string | null;
  fields: DossierField[];
  questions: DossierQuestion[];
  answers: Record<string, string>;
  status: string;
  sourceLabel: string | null;
  completeness: number;
  updatedAt: string | null;
}

export function useDossier() {
  return useQuery({
    queryKey: ['/api/dossier'],
    queryFn: () => apiFetch<{ dossier: Dossier | null }>('/api/dossier'),
  });
}

export function useCreateDossier() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { sourceText?: string; attachmentId?: number }) =>
      apiFetch<{ dossier: Dossier }>('/api/dossier', { method: 'POST', body: JSON.stringify(input) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/dossier'] });
      // The file feeds straight into chat context, so anything showing what
      // Vera knows is stale the moment intake completes.
      queryClient.invalidateQueries({ queryKey: ['/api/company-facts'] });
    },
  });
}

export function useSaveDossierAnswers() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { dossierId: number; answers: Record<string, string> }) =>
      apiFetch<{ dossier: Dossier }>(`/api/dossier/${input.dossierId}/answers`, {
        method: 'POST',
        body: JSON.stringify({ answers: input.answers }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/dossier'] });
      queryClient.invalidateQueries({ queryKey: ['/api/company-facts'] });
    },
  });
}

export interface WrapStat {
  key: string;
  label: string;
  value: number;
  previousValue: number | null;
  changePct: number | null;
}

export interface MonthlyWrap {
  periodMonth: string;
  monthLabel: string;
  hasSignal: boolean;
  stats: WrapStat[];
  topics: { topic: string; count: number }[];
  decisionsMade: { query: string; recommendation: string | null; status: string }[];
  goalsClosed: { title: string; status: string }[];
  lessons: string[];
  busiestDay: { date: string; count: number } | null;
  narrative: { headline: string; story: string; oneThingToChange: string } | null;
}

export function useMonthlyWrap(period?: string) {
  return useQuery({
    queryKey: ['/api/dossier/wrap', period ?? 'current'],
    queryFn: () =>
      apiFetch<{ wrap: MonthlyWrap; monthLabel: string }>(
        `/api/dossier/wrap${period ? `?period=${encodeURIComponent(period)}` : ''}`,
      ),
  });
}

// ---- Chat attachments ----

export interface UploadedAttachment {
  id: number;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}

export function useUploadAttachment() {
  return useMutation({
    // Deliberately NOT using apiFetch here — multipart uploads need the
    // browser to set its own `Content-Type: multipart/form-data; boundary=…`
    // header, which apiFetch's hardcoded `application/json` would clobber.
    mutationFn: async (input: { file: File; chatId?: number }) => {
      const formData = new FormData();
      formData.append('file', input.file);
      if (input.chatId) formData.append('chatId', String(input.chatId));

      const response = await fetch('/api/attachments', { method: 'POST', body: formData });
      if (!response.ok) {
        const message = await response.json().then((b) => b?.error).catch(() => null);
        throw new Error(message ?? 'Upload failed');
      }
      return response.json() as Promise<UploadedAttachment>;
    },
  });
}

// ---- Account ----

export interface DeleteAccountResult {
  dataDeleted: boolean;
  accountClosed: boolean;
}

// Backs the "Delete account" control in the General tab of VeraSettingsModal.
// Mirrors api-server/src/routes/account.ts's own two-outcome shape rather than
// collapsing it to a boolean: dataDeleted can be true while accountClosed is
// false (Clerk deletion failed after the data was already gone — see that
// route's comment on why data is deleted before the account), and the caller
// needs to tell those two apart to show the right message.
export function useDeleteAccount() {
  return useMutation({
    mutationFn: () => apiFetch<DeleteAccountResult>('/api/account', { method: 'DELETE' }),
  });
}

// ---- Profile / account identity ----

export interface VeraProfile {
  userId: string;
  /** Vera's display name if set, otherwise the Clerk account name, otherwise null. */
  name: string | null;
  displayName: string | null;
  clerkName: string | null;
  email: string | null;
  imageUrl: string | null;
  memberSince: string | null;
  company: string | null;
  role: string | null;
  teamSize: string | null;
  monthlyRevenue: string | null;
  referralSource: string | null;
  arrivalReason: string | null;
  primaryGoal: string | null;
  stage: string | null;
  industry: string | null;
  country: string | null;
  onboardingCompleted: boolean;
  onboardingCompletedAt: string | null;
}

/** Only the fields the account card lets a founder change. Identity (email,
 *  joined date) is Clerk's and is deliberately not editable from here. */
export interface ProfilePatch {
  displayName?: string | null;
  company?: string | null;
  role?: string | null;
  teamSize?: string | null;
  monthlyRevenue?: string | null;
  primaryGoal?: string | null;
  stage?: string | null;
  industry?: string | null;
  country?: string | null;
}

export function useProfile() {
  return useQuery({
    queryKey: ['/api/profile'],
    queryFn: () => apiFetch<VeraProfile>('/api/profile'),
  });
}

export function useUpdateProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (patch: ProfilePatch) =>
      apiFetch<Partial<VeraProfile>>('/api/profile', { method: 'PATCH', body: JSON.stringify(patch) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/profile'] });
      // The company name and role are read into the model's prompt, so a change
      // here changes what Vera knows — the nudge list is derived from the same
      // state and can go stale in the same breath.
      queryClient.invalidateQueries({ queryKey: ['/api/nudges'] });
    },
  });
}

export interface OnboardingSubmission {
  companyName: string;
  role: string;
  teamSize?: string;
  monthlyRevenue?: string;
  referralSource?: string;
  arrivalReason?: string;
}

// The write the onboarding form never used to make. Its five answers went to
// localStorage and nowhere else, so the one screen every founder completes
// produced nothing anyone could analyse — not even which channel brought them.
export function useSaveOnboarding() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: OnboardingSubmission) =>
      apiFetch<{ ok: boolean }>('/api/profile/onboarding', { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/profile'] });
      queryClient.invalidateQueries({ queryKey: ['/api/nudges'] });
    },
  });
}

// ---- Nudges ----

export interface Nudge {
  kind: string;
  title: string;
  body: string;
  href: string;
  actionLabel: string;
  priority: 'high' | 'normal' | 'low';
}

// Polled rather than pushed: the cadence that matters here is "did something
// become true while I was away", which a refetch answers exactly as well as a
// socket would, without a socket. staleTime keeps a tab switch from re-asking.
export function useNudges() {
  return useQuery({
    queryKey: ['/api/nudges'],
    queryFn: () => apiFetch<{ nudges: Nudge[]; count: number }>('/api/nudges'),
    // Three hours is the nudge cooldown itself (see api-server lib/nudges.ts),
    // so asking more often than every 15 minutes cannot surface anything new —
    // it would only spend requests.
    refetchInterval: 15 * 60 * 1000,
    staleTime: 5 * 60 * 1000,
  });
}

// Reported only once nudges have genuinely been RENDERED. Kept separate from
// the read for that reason: a background poll marking them shown would burn
// the cooldown and the show-ceiling on nudges no human ever saw.
export function useMarkNudgesShown() {
  return useMutation({
    mutationFn: (kinds: string[]) =>
      apiFetch<{ ok: boolean }>('/api/nudges/shown', { method: 'POST', body: JSON.stringify({ kinds }) }),
  });
}

export function useDismissNudge() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (kind: string) =>
      apiFetch<{ ok: boolean }>('/api/nudges/dismiss', { method: 'POST', body: JSON.stringify({ kind }) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['/api/nudges'] }),
  });
}

// ---- Operator: revoking access from an account that already has it ----
//
// "Revoke access" means suspend, and it needs the account's Clerk user id.
// Suspension is enforced on every authenticated request, so it takes effect
// across the product rather than only at the sign-in entry point.

export interface OperatorUserRow {
  userId: string;
  email: string | null;
  createdAt: number | null;
  lastSignInAt: number | null;
  clerkBanned: boolean;
  veraStatus: 'active' | 'suspended' | string;
  veraStatusReason: string | null;
}

/** Search Clerk for an account. `q` empty lists the most recent signups,
 *  which is the common case right after someone reports a problem. */
export function useOperatorUsers(q: string, enabled: boolean) {
  return useQuery({
    queryKey: ['/api/operator/users', q],
    queryFn: () => apiFetch<{ users: OperatorUserRow[] }>(`/api/operator/users${q ? `?q=${encodeURIComponent(q)}` : ''}`),
    enabled,
    retry: false,
  });
}

export function useSetAccountSuspended() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { userId: string; suspend: boolean; reason: string }) =>
      apiFetch<{ userId: string; status: string }>(
        `/api/operator/users/${encodeURIComponent(input.userId)}/${input.suspend ? 'suspend' : 'unsuspend'}`,
        { method: 'POST', body: JSON.stringify({ reason: input.reason }) },
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/operator/users'] });
    },
  });
}
