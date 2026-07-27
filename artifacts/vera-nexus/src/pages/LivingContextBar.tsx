import { Mail, MessageSquare, FileSpreadsheet, NotebookText, Ticket, Linkedin, Plug } from 'lucide-react';
import { useGetOnboarding } from '@workspace/api-client-react';
import { useDailyBrief, useConnectors, type ConnectorStatus } from '../lib/venusApi';
import { useVeraSkin } from '../lib/veraSkin';

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

/**
 * Persistent business context — who this is, how the operating record is
 * accumulating, and what Vera can currently see.
 *
 * Every figure here is one the backend actually returns (daily-brief stats,
 * onboarding, connector status). The design mockup carried MRR, subscriber
 * count and repeat rate; none of those exist anywhere in this product, and a
 * context bar whose entire purpose is to be trusted at a glance is the last
 * place to put a number that was invented to make a layout look full. If
 * those metrics arrive later they slot straight into the same row.
 *
 * Renders only under a skin — Classic never had this surface.
 */
export function LivingContextBar() {
  const { skin } = useVeraSkin();
  const { data: onboarding } = useGetOnboarding();
  const dailyBrief = useDailyBrief();
  const connectors = useConnectors();

  if (skin === 'classic') return null;

  const stats = dailyBrief.data?.stats;
  const name = onboarding?.companyName?.trim();

  // Nothing to anchor the bar to yet. Better absent than a row of dashes.
  if (!name && !stats) return null;

  const descriptor = [onboarding?.industry, onboarding?.stage].filter(Boolean).join(' · ');

  const metrics: Array<{ k: string; v: string }> = [];
  if (stats) {
    if (stats.goalsActive > 0) metrics.push({ k: 'Active goals', v: String(stats.goalsActive) });
    if (stats.decisionsCaptured > 0) metrics.push({ k: 'Decisions', v: String(stats.decisionsCaptured) });
    if (stats.automationsCompleted > 0) metrics.push({ k: 'Automations', v: String(stats.automationsCompleted) });
    if (stats.queueStreakDays > 0) metrics.push({ k: 'Streak', v: `${stats.queueStreakDays}d` });
  }

  const live = (connectors.data?.connectors ?? []).filter(
    (c: ConnectorStatus) => c.status === 'connected' || c.status === 'error',
  );

  return (
    <div className="vera-ctx">
      <div className="vera-ctx-id">
        <span className="vera-socket vera-socket-live">
          <Plug className="w-3.5 h-3.5" />
        </span>
        <span style={{ display: 'grid', gap: '1px', minWidth: 0 }}>
          <span
            style={{
              fontSize: '14px',
              fontWeight: 600,
              color: 'var(--v7-text)',
              lineHeight: 1.25,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {name || 'Your business'}
          </span>
          {descriptor && <span className="vera-ctx-k">{descriptor}</span>}
        </span>
      </div>

      {metrics.length > 0 && (
        <div className="vera-ctx-metrics">
          {metrics.map((m) => (
            <div key={m.k} className="vera-ctx-m">
              <span className="vera-ctx-k">{m.k}</span>
              <span className="vera-ctx-v">{m.v}</span>
            </div>
          ))}
        </div>
      )}

      {live.length > 0 && (
        <div className="vera-ctx-conn">
          {live.map((c: ConnectorStatus) => {
            const Icon = CONNECTOR_ICON[c.type] ?? Plug;
            const broken = c.status === 'error';
            return (
              <span
                key={c.type}
                className={`vera-socket ${broken ? 'vera-socket-bad' : 'vera-socket-live'}`}
                style={{ width: 26, height: 26 }}
                title={broken ? `${c.label} — needs reconnecting` : `${c.label} — connected`}
              >
                <Icon className="w-3 h-3" />
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}
