import { useState } from 'react';
import {
  Clock, Inbox, Plug, Play, Pause, Zap, Trash2, Mail, FileSpreadsheet, Calendar,
  NotebookText, Ticket, Linkedin, MessageCircle, Sparkles,
} from 'lucide-react';
import { Button, Eyebrow, Label, MONO, PageHead, Panel, Rise, StatusPill } from '../ui';
import { WORKFLOWS, type WorkflowState, type WorkflowTemplateFixture } from '../data';

/* ---------------------------------------------------------------------------
 * Workflow Hub.
 *
 * Information architecture carried over from pages/Workflows.tsx: each
 * template renders a trigger → connector(s) → queue node chain, a ghost
 * (not-yet-activated) state drawn with dashed boundaries, and the same
 * Activate / Run now / Pause / Remove action set.
 * ------------------------------------------------------------------------ */

const CONNECTOR_ICON: Record<string, typeof Mail> = {
  gmail: Mail,
  slack: MessageCircle,
  sheets: FileSpreadsheet,
  calendar: Calendar,
  notion: NotebookText,
  jira: Ticket,
  linkedin: Linkedin,
  whatsapp: MessageCircle,
};

function NodeBox({ icon: Icon, label, dim }: { icon: typeof Mail; label: string; dim: boolean }) {
  return (
    <div className="flex flex-col items-center gap-1.5 shrink-0" style={{ width: 78 }}>
      <div
        className="w-11 h-11 rounded-2xl grid place-items-center"
        style={{
          background: dim ? 'transparent' : 'var(--p-accent-tint)',
          border: `1.5px ${dim ? 'dashed' : 'solid'} ${dim ? 'var(--p-line-2)' : 'var(--p-accent-edge)'}`,
          transition: 'background .3s, border-color .3s',
        }}
      >
        <Icon
          className="w-[18px] h-[18px]"
          strokeWidth={2}
          style={{ color: dim ? 'var(--p-text-2)' : 'var(--p-accent-2)' }}
        />
      </div>
      <span
        className="text-[10px] font-bold text-center leading-tight"
        style={{ fontFamily: MONO, letterSpacing: '.06em', color: 'var(--p-text-2)' }}
      >
        {label}
      </span>
    </div>
  );
}

function FlowLine({ live }: { live: boolean }) {
  return (
    <div
      className={live ? 'vp-flow flex-1 self-center' : 'flex-1 self-center'}
      style={{
        height: 2,
        marginBottom: 20,
        minWidth: 18,
        backgroundImage: `repeating-linear-gradient(90deg, ${live ? 'var(--p-accent-2)' : 'var(--p-line-2)'} 0 6px, transparent 6px 14px)`,
        backgroundSize: '20px 2px',
        opacity: live ? 1 : 0.75,
      }}
      aria-hidden="true"
    />
  );
}

const STATE_LABEL: Record<WorkflowState, string> = {
  active: 'Running',
  paused: 'Paused',
  ghost: 'Not activated',
};

function WorkflowCard({ template, onToggle }: { template: WorkflowTemplateFixture; onToggle: (id: string) => void }) {
  const ghost = template.state === 'ghost';
  const live = template.state === 'active';
  const icons = template.connectors.length > 0 ? template.connectors : [{ key: 'vera', label: 'Vera' }];

  return (
    <Panel
      className="p-4"
      style={
        ghost
          ? { background: 'transparent', border: '1px dashed var(--p-line-2)', boxShadow: 'none' }
          : undefined
      }
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <div className="text-[14px] font-bold leading-[1.35]" style={{ color: 'var(--p-text)', letterSpacing: '-.016em' }}>
            {template.name}
          </div>
          <div className="text-[12.5px] font-medium leading-[1.55] mt-1 max-w-[58ch]" style={{ color: 'var(--p-text-2)' }}>
            {template.description}
          </div>
        </div>
        <StatusPill tone={live ? 'ok' : template.state === 'paused' ? 'warn' : 'idle'}>
          {STATE_LABEL[template.state]}
        </StatusPill>
      </div>

      <div className="flex items-start overflow-x-auto vp-scroll py-1 mb-3">
        <NodeBox icon={Clock} label={template.cronLabel} dim={!live} />
        <FlowLine live={live} />
        {icons.map((c, i) => {
          const Icon = CONNECTOR_ICON[c.key] ?? Sparkles;
          return (
            <span key={c.key} className="flex items-start">
              <NodeBox icon={Icon} label={c.label} dim={!live} />
              {i < icons.length - 1 ? <FlowLine live={live} /> : null}
            </span>
          );
        })}
        <FlowLine live={live} />
        <NodeBox icon={Inbox} label="Queue" dim={!live} />
      </div>

      {!template.connectorsReady ? (
        <div className="flex flex-wrap items-center gap-2 mb-3">
          {template.connectors.map((c) => (
            <button
              key={c.key}
              type="button"
              className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11.5px] font-bold"
              style={{
                background: 'var(--p-accent-tint)',
                border: '1px solid var(--p-accent-edge)',
                color: 'var(--p-accent-2)',
              }}
            >
              <Plug className="w-3 h-3" strokeWidth={2.4} />
              Connect {c.label}
            </button>
          ))}
        </div>
      ) : null}

      <div
        className="flex flex-wrap items-center gap-x-5 gap-y-2 mb-3 pt-3"
        style={{ borderTop: '1px solid var(--p-line)' }}
      >
        <span className="flex items-baseline gap-2">
          <Label>Last run</Label>
          <b className="text-[12px] font-bold" style={{ fontFamily: MONO, fontVariantNumeric: 'tabular-nums', color: 'var(--p-text)' }}>
            {template.lastRun}
          </b>
        </span>
        <span className="flex items-baseline gap-2">
          <Label>In queue</Label>
          <b className="text-[12px] font-bold" style={{ fontFamily: MONO, fontVariantNumeric: 'tabular-nums', color: 'var(--p-text)' }}>
            {template.queued}
          </b>
        </span>
        <span className="flex items-baseline gap-2">
          <Label>Schedule</Label>
          <b className="text-[12px] font-bold" style={{ fontFamily: MONO, color: 'var(--p-text)' }}>
            {template.cronLabel}
          </b>
        </span>
      </div>

      <div className="flex items-center gap-2">
        {ghost ? (
          <Button variant="primary" disabled={!template.connectorsReady}>
            Activate
          </Button>
        ) : (
          <>
            <Button>
              <Zap className="w-3.5 h-3.5" strokeWidth={2.4} />
              Run now
            </Button>
            <Button onClick={() => onToggle(template.id)}>
              {live ? <Pause className="w-3.5 h-3.5" strokeWidth={2.4} /> : <Play className="w-3.5 h-3.5" strokeWidth={2.4} />}
              {live ? 'Pause' : 'Resume'}
            </Button>
            <span className="ml-auto">
              <Button variant="quiet">
                <Trash2 className="w-3.5 h-3.5" strokeWidth={2.2} />
                Remove
              </Button>
            </span>
          </>
        )}
      </div>
    </Panel>
  );
}

export function WorkflowHub() {
  const [rows, setRows] = useState(WORKFLOWS);

  const toggle = (id: string) => {
    setRows((prev) =>
      prev.map((r) =>
        r.id === id ? { ...r, state: r.state === 'active' ? ('paused' as const) : ('active' as const) } : r,
      ),
    );
  };

  const active = rows.filter((r) => r.state === 'active').length;
  const queued = rows.reduce((sum, r) => sum + r.queued, 0);

  return (
    <div className="h-full overflow-y-auto vp-scroll">
      <div className="max-w-[880px] mx-auto px-6 py-8">
        <Rise>
          <PageHead
            eyebrow="Workflow Hub"
            title="Work that runs without you asking"
            blurb="Activate a template and Vera runs it on schedule. Results land in your queue with the same causal trace you would get from asking directly."
            actions={<Button variant="primary">New workflow</Button>}
          />
        </Rise>

        <Rise delay={60}>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-7">
            {[
              { label: 'Running now', value: String(active), tone: 'ok' as const },
              { label: 'Items in queue', value: String(queued), tone: 'accent' as const },
              { label: 'Templates available', value: String(rows.length), tone: 'idle' as const },
            ].map((s) => (
              <Panel key={s.label} className="px-4 py-3.5">
                <Label>{s.label}</Label>
                <div
                  className="text-[26px] font-bold mt-1.5"
                  style={{
                    fontVariantNumeric: 'tabular-nums',
                    letterSpacing: '-.03em',
                    color: s.tone === 'ok' ? 'var(--p-ok)' : s.tone === 'accent' ? 'var(--p-accent-2)' : 'var(--p-text)',
                  }}
                >
                  {s.value}
                </div>
              </Panel>
            ))}
          </div>
        </Rise>

        <Rise delay={110}>
          <div className="mb-3">
            <Eyebrow>Templates</Eyebrow>
          </div>
          <div className="flex flex-col gap-3">
            {rows.map((t) => (
              <WorkflowCard key={t.id} template={t} onToggle={toggle} />
            ))}
          </div>
        </Rise>
      </div>
    </div>
  );
}
