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

export type QueueItemStatus = 'pending' | 'accepted' | 'edited' | 'rejected';

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
}

export function useQueue() {
  return useQuery({
    queryKey: ['/api/queue'],
    queryFn: () => apiFetch<{ items: QueueItem[] }>('/api/queue'),
    // The notification bell polls off this same query — a founder acting on
    // an item in another tab (or a background job dropping in a new one)
    // should clear/update the badge without a manual refresh.
    refetchInterval: 60_000,
  });
}

export function useQueueAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: number; action: 'accept' | 'edit' | 'reject'; editedContent?: string }) =>
      apiFetch<{ item: QueueItem }>(`/api/queue/${input.id}/action`, {
        method: 'POST',
        body: JSON.stringify({ action: input.action, edited_content: input.editedContent }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/queue'] });
    },
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
