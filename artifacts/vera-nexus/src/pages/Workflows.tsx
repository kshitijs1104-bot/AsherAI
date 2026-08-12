import { useLocation } from 'wouter';
import {
  ArrowLeft, Workflow as WorkflowIcon, Play, Pause, Trash2, Zap, Plug, Clock, Inbox,
  Mail, FileSpreadsheet, Calendar, NotebookText, Ticket, Linkedin, MessageCircle, Sparkles,
} from 'lucide-react';
import {
  useWorkflowTemplates, useWorkflows, useActivateWorkflow, useSetWorkflowStatus, useDeleteWorkflow, useRunWorkflowNow,
  startConnectorAuth, type WorkflowTemplate, type WorkflowRow,
} from '../lib/venusApi';
import { VenusThemeToggle } from './VenusThemeToggle';
import { useVenusTheme } from '../lib/venusTheme';

const CONNECTOR_ICON: Record<string, typeof Mail> = {
  gmail: Mail,
  slack: Mail,
  sheets: FileSpreadsheet,
  calendar: Calendar,
  notion: NotebookText,
  jira: Ticket,
  linkedin: Linkedin,
  whatsapp: MessageCircle,
};

// The n8n-style node-chain visual (see the reference screenshot) reskinned
// to this app's own palette — a rounded-square icon box, not n8n's flat
// service-logo tiles. "ghost" = not yet activated: dashed border, dimmed,
// same layout position a solid node will animate into once activated.
function NodeBox({ icon: Icon, label, ghost }: { icon: typeof Mail; label: string; ghost?: boolean }) {
  return (
    <div className="flex flex-col items-center gap-1.5 shrink-0" style={{ width: '76px' }}>
      <div
        className="w-11 h-11 rounded-2xl flex items-center justify-center transition-all duration-300"
        style={{
          background: ghost ? 'transparent' : 'var(--v7-cyan-soft)',
          border: `1.5px ${ghost ? 'dashed' : 'solid'} ${ghost ? 'var(--v7-border, rgba(255,255,255,0.16))' : 'var(--v7-cyan-strong)'}`,
          opacity: ghost ? 0.55 : 1,
          boxShadow: ghost ? 'none' : '0 0 18px -4px var(--v7-cyan-strong)',
        }}
      >
        <Icon className="w-[18px] h-[18px]" style={{ color: ghost ? 'var(--v7-text-mute)' : 'var(--v7-cyan)' }} />
      </div>
      <span className="text-[10px] font-medium text-center leading-tight" style={{ color: ghost ? 'var(--v7-text-mute)' : 'var(--v7-text-dim)' }}>
        {label}
      </span>
    </div>
  );
}

// The animated "data flowing through the pipe" connector — a repeating
// dashed gradient whose background-position keeps advancing (see the
// flowDash keyframes below), instead of a static line. Ghost chains get a
// plain still dashed line since there's nothing actually running yet.
function FlowLine({ ghost }: { ghost?: boolean }) {
  return (
    <div
      className="flex-1 self-center"
      style={{
        height: '2px',
        marginBottom: '18px',
        minWidth: '20px',
        backgroundImage: `repeating-linear-gradient(90deg, ${ghost ? 'var(--v7-border, rgba(255,255,255,0.2))' : 'var(--v7-cyan)'} 0 6px, transparent 6px 14px)`,
        backgroundSize: '20px 2px',
        animation: ghost ? 'none' : 've-flow-dash 0.9s linear infinite',
        opacity: ghost ? 0.5 : 0.9,
      }}
    />
  );
}

function WorkflowCard({ template, workflow }: { template: WorkflowTemplate; workflow: WorkflowRow | undefined }) {
  const activate = useActivateWorkflow();
  const setStatus = useSetWorkflowStatus();
  const remove = useDeleteWorkflow();
  const runNow = useRunWorkflowNow();
  const isGhost = !workflow;
  const isActive = workflow?.status === 'active';

  const connectorIcons = template.requiredConnectors.length > 0
    ? template.requiredConnectors.map((c) => CONNECTOR_ICON[c] ?? Plug)
    : [Sparkles];

  return (
    <div
      className="rounded-2xl p-4 transition-all duration-300"
      style={{
        background: isGhost ? 'transparent' : 'var(--v7-bg-raised)',
        border: `1px ${isGhost ? 'dashed' : 'solid'} ${isGhost ? 'var(--v7-border, rgba(255,255,255,0.16))' : 'var(--v7-border, rgba(255,255,255,0.08))'}`,
      }}
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <div className="text-[13.5px] font-semibold" style={{ color: isGhost ? 'var(--v7-text-dim)' : 'var(--v7-text)' }}>{template.name}</div>
          <div className="text-[11.5px] mt-0.5" style={{ color: 'var(--v7-text-mute)' }}>{template.description}</div>
        </div>
        {workflow && (
          <span
            className="text-[9.5px] font-mono uppercase px-1.5 py-0.5 rounded shrink-0"
            style={{ background: isActive ? 'var(--v7-cyan-soft)' : 'var(--v7-bg-raised-2)', color: isActive ? 'var(--v7-cyan)' : 'var(--v7-text-mute)' }}
          >
            {workflow.status}
          </span>
        )}
      </div>

      {/* The node chain: Trigger -> Connector(s) -> Outcome */}
      <div className="flex items-start mb-3" style={{ padding: '4px 0' }}>
        <NodeBox icon={Clock} label={template.cronLabel} ghost={isGhost || !isActive} />
        <FlowLine ghost={isGhost || !isActive} />
        {connectorIcons.map((Icon, i) => (
          <span key={i} className="flex items-center">
            <NodeBox icon={Icon} label={template.requiredConnectors[i] ?? 'Vera'} ghost={isGhost || !isActive} />
            {i < connectorIcons.length - 1 && <FlowLine ghost={isGhost || !isActive} />}
          </span>
        ))}
        <FlowLine ghost={isGhost || !isActive} />
        <NodeBox icon={Inbox} label="Queue" ghost={isGhost || !isActive} />
      </div>

      {!template.connectorsReady && (
        <div className="flex flex-wrap items-center gap-1.5 mb-3">
          {template.requiredConnectors.map((c) => (
            <button
              key={c}
              onClick={() => startConnectorAuth(c)}
              className="flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-md"
              style={{ background: 'var(--v7-cyan-soft)', border: '1px solid var(--v7-cyan-strong)', color: 'var(--v7-cyan)' }}
            >
              <Plug className="w-3 h-3" />
              Connect {c}
            </button>
          ))}
        </div>
      )}

      <div className="flex items-center gap-1.5">
        {!workflow ? (
          <button
            disabled={!template.connectorsReady || activate.isPending}
            onClick={() => activate.mutate(template.id)}
            className="text-[11.5px] font-semibold px-2.5 py-1.5 rounded-md disabled:opacity-40"
            style={{ background: 'var(--v7-cyan-soft)', border: '1px solid var(--v7-cyan-strong)', color: 'var(--v7-cyan)' }}
          >
            Activate
          </button>
        ) : (
          <>
            <button
              disabled={runNow.isPending}
              onClick={() => runNow.mutate(workflow.id)}
              title="Run now"
              className="flex items-center gap-1 text-[11.5px] font-medium px-2.5 py-1.5 rounded-md"
              style={{ border: '1px solid var(--v7-border, rgba(255,255,255,0.08))', color: 'var(--v7-text-dim)' }}
            >
              <Zap className="w-3 h-3" />
              {runNow.isPending ? 'Running…' : 'Run now'}
            </button>
            <button
              disabled={setStatus.isPending}
              onClick={() => setStatus.mutate({ id: workflow.id, status: workflow.status === 'active' ? 'paused' : 'active' })}
              title={workflow.status === 'active' ? 'Pause' : 'Resume'}
              className="flex items-center gap-1 text-[11.5px] font-medium px-2.5 py-1.5 rounded-md"
              style={{ border: '1px solid var(--v7-border, rgba(255,255,255,0.08))', color: 'var(--v7-text-dim)' }}
            >
              {workflow.status === 'active' ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
              {workflow.status === 'active' ? 'Pause' : 'Resume'}
            </button>
            <button
              disabled={remove.isPending}
              onClick={() => remove.mutate(workflow.id)}
              title="Remove"
              className="ml-auto"
              style={{ color: 'var(--v7-text-mute)' }}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </>
        )}
      </div>
      {runNow.isSuccess && runNow.data && (
        <div className="text-[11px] mt-2" style={{ color: 'var(--v7-text-mute)' }}>
          {runNow.data.created > 0 ? `Created ${runNow.data.created} queue item${runNow.data.created === 1 ? '' : 's'}.` : 'Ran — nothing new to surface.'}
        </div>
      )}
    </div>
  );
}

// Dark: a deep indigo/violet nebula with two slowly-drifting glows plus a
// faint twinkling starfield. Light: the same structure with a softer
// "aurora" palette instead of just a dimmed version of the dark scene —
// both built from plain CSS (radial-gradient blobs + a repeating-dot
// starfield texture), no images, no canvas/WebGL.
// Dark reads as a night sky without help — glowing blobs on near-black look
// like nebulae by default. Light doesn't get that for free: the same
// low-alpha blobs and a dimmed star-dot grid just read as flecks of dirt on
// a white page, which is what a founder actually flagged this background
// for. Rather than dimming the dark version, light gets its own reading of
// the same structure — a brighter sky wash, richer blobs (opacity roughly
// doubled, since a light ground swallows colour that a dark one doesn't),
// a third drifting gloss layer for depth, and a fine ink line-grid instead
// of dust — a chart on paper rather than a nebula turned down.
function CosmicBackground({ light }: { light: boolean }) {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none" style={{ zIndex: 0 }}>
      <div
        className="absolute inset-0"
        style={{ background: light ? 'linear-gradient(180deg, #f4f6fd 0%, #e3e8fa 55%, #dbe2f7 100%)' : 'linear-gradient(180deg, #0a0a16 0%, #0c0a1a 100%)' }}
      />
      <div
        className="absolute rounded-full"
        style={{
          width: '520px', height: '520px', top: '-160px', left: '-120px',
          background: light ? 'radial-gradient(circle, rgba(91,79,232,0.30), transparent 70%)' : 'radial-gradient(circle, rgba(91,79,232,0.35), transparent 70%)',
          filter: 'blur(10px)',
          animation: 've-drift-a 22s ease-in-out infinite',
        }}
      />
      <div
        className="absolute rounded-full"
        style={{
          width: '460px', height: '460px', bottom: '-140px', right: '-100px',
          background: light ? 'radial-gradient(circle, rgba(0,229,176,0.26), transparent 70%)' : 'radial-gradient(circle, rgba(0,229,176,0.22), transparent 70%)',
          filter: 'blur(10px)',
          animation: 've-drift-b 26s ease-in-out infinite',
        }}
      />
      {light && (
        // Exists only on paper — without it the page reads as two flat
        // blobs on white. A slow third drift, off-beat from the other two
        // (18s vs 22s/26s), keeps the sky from ever fully settling.
        <div
          className="absolute rounded-full"
          style={{
            width: '640px', height: '380px', top: '-120px', right: '4%',
            background: 'radial-gradient(circle, rgba(255,205,120,0.16), transparent 70%)',
            filter: 'blur(14px)',
            animation: 've-drift-c 18s ease-in-out infinite',
          }}
        />
      )}
      <div
        className="absolute inset-0"
        style={
          light
            ? {
                backgroundImage:
                  'linear-gradient(rgba(50,56,110,0.09) 1px, transparent 1px), linear-gradient(90deg, rgba(50,56,110,0.09) 1px, transparent 1px)',
                backgroundSize: '34px 34px',
                opacity: 0.55,
                animation: 've-twinkle 6s ease-in-out infinite',
              }
            : {
                backgroundImage: 'radial-gradient(1px 1px, rgba(255,255,255,0.5) 1px, transparent 0)',
                backgroundSize: '28px 28px',
                opacity: 0.35,
                animation: 've-twinkle 5s ease-in-out infinite',
              }
        }
      />
    </div>
  );
}

export function WorkflowsPage() {
  const [, navigate] = useLocation();
  const { theme, toggle: toggleTheme } = useVenusTheme();
  const { data: templatesData, isLoading, isError, error } = useWorkflowTemplates();
  const { data: workflowsData } = useWorkflows();

  const templates = templatesData?.templates ?? [];
  const workflowByTemplate = new Map((workflowsData?.workflows ?? []).map((w) => [w.templateId, w]));

  return (
    // Same omission the Dossier route had: without an explicit background
    // the page falls through to <body>'s dark colour and light mode renders
    // as light cards on a black page.
    <div className={`relative min-h-screen w-full ${theme === 'light' ? 'v7-light' : ''}`} style={{ background: 'var(--v7-bg)', color: 'var(--v7-text)', fontFamily: 'var(--v7-font-round)' }}>
      <style>{`
        @keyframes ve-flow-dash { from { background-position: 0 0; } to { background-position: 20px 0; } }
        @keyframes ve-drift-a { 0%, 100% { transform: translate(0, 0); } 50% { transform: translate(30px, 20px); } }
        @keyframes ve-drift-b { 0%, 100% { transform: translate(0, 0); } 50% { transform: translate(-25px, -18px); } }
        @keyframes ve-drift-c { 0%, 100% { transform: translate(0, 0) scale(1); } 50% { transform: translate(18px, -22px) scale(1.06); } }
        @keyframes ve-twinkle { 0%, 100% { opacity: 0.35; } 50% { opacity: 0.15; } }
      `}</style>
      <CosmicBackground light={theme === 'light'} />

      <div className="relative max-w-2xl mx-auto px-6 py-8" style={{ zIndex: 1 }}>
        <div className="flex items-center justify-between mb-6">
          <button
            onClick={() => navigate('/vera')}
            className="flex items-center gap-1.5 text-[13px] font-medium"
            style={{ color: 'var(--v7-text-mute)' }}
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Back to Vera
          </button>
          <VenusThemeToggle theme={theme} onToggle={toggleTheme} />
        </div>

        <div className="flex items-center gap-2 mb-1">
          <WorkflowIcon className="w-4 h-4" style={{ color: 'var(--v7-cyan)' }} />
          <h1 className="text-[19px] font-extrabold">Workflows</h1>
        </div>
        <p className="text-[13px] mb-6" style={{ color: 'var(--v7-text-mute)' }}>
          Activate a template and Vera runs it on schedule — results show up in your queue.
        </p>

        {isLoading && <div className="text-[13px]" style={{ color: 'var(--v7-text-mute)' }}>Loading…</div>}

        {isError && (
          <div className="text-[13px] rounded-xl p-4 mb-4" style={{ background: 'var(--v7-bg-raised, rgba(0,0,0,0.2))', color: 'var(--red, #e5555c)' }}>
            {error instanceof Error ? error.message : 'Failed to load workflow templates'}
          </div>
        )}

        <div className="space-y-3">
          {templates.map((t) => (
            <WorkflowCard key={t.id} template={t} workflow={workflowByTemplate.get(t.id)} />
          ))}
        </div>
      </div>
    </div>
  );
}
