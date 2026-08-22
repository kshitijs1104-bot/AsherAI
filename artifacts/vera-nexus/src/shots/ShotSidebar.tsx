import {
  Plus, LayoutGrid, Target, Map as MapIcon, Workflow as WorkflowIcon,
  PanelLeftClose, Moon, Bell, Settings as SettingsIcon,
} from 'lucide-react';

import { SESSION_TITLES } from './fixtures';

// A non-interactive stand-in for Venus.tsx's <aside>, for the screenshot
// harness only.
//
// It is a copy of that markup rather than the component itself because the
// real sidebar is welded into a 2,400-line page component that owns chat
// sessions, Clerk identity, goal panels and eight pieces of localStorage —
// none of which a camera needs. Every class name, CSS variable and pixel
// value below is lifted verbatim from Venus.tsx, so the photograph is of the
// real design system even though the tree is a stub. If the sidebar is
// restyled, this drifts, and the fix is to re-copy it.

function NavRow({ icon: Icon, label, badge, active }: {
  icon: typeof LayoutGrid;
  label: string;
  badge?: number;
  active?: boolean;
}) {
  return (
    <div
      className="w-full flex items-center gap-[9px] text-[13px] font-medium"
      style={{
        padding: '9px 12px',
        borderRadius: '10px',
        color: active ? 'var(--v7-text)' : 'var(--v7-text-dim)',
        background: active ? 'var(--v7-bg-raised-2)' : 'transparent',
      }}
    >
      <Icon className="w-3.5 h-3.5 shrink-0" />
      <span className="flex-1 truncate text-left">{label}</span>
      {badge !== undefined && (
        <span
          className="shrink-0 text-[10px] font-bold"
          style={{
            fontFamily: 'var(--v7-font-mono)',
            color: 'var(--v7-cyan)',
            background: 'var(--v7-cyan-soft)',
            border: '1px solid var(--v7-cyan-strong)',
            borderRadius: '100px',
            padding: '1px 7px',
          }}
        >
          {badge}
        </span>
      )}
    </div>
  );
}

export function ShotSidebar({ skinned, pendingCount }: { skinned: boolean; pendingCount: number }) {
  return (
    <aside
      className="shots-sidebar w-[260px] flex flex-col shrink-0 h-screen"
      style={{
        background: 'var(--v7-bg-raised)',
        borderRight: '1px solid var(--v7-border)',
        padding: '20px 14px',
      }}
    >
      {/* Brand mark */}
      <div className="flex items-center justify-between" style={{ padding: '2px 8px 14px' }}>
        <div className="flex items-center gap-[8px]">
          <div
            className="w-6 h-6 flex items-center justify-center shrink-0"
            style={{ borderRadius: '9px', background: 'var(--v7-bg-raised-2)', border: '1px solid var(--v7-border-strong)' }}
          >
            <svg viewBox="0 0 24 24" fill="none" className="w-[14px] h-[14px]">
              <circle cx="12" cy="12" r="9.5" stroke="#3a3d47" strokeWidth="0.8" />
              <g transform="rotate(-16 12 12)">
                <path d="M12 4.5L13.6 12H10.4L12 4.5Z" fill="#00e5b0" />
                <path d="M12 19.5L11.1 12H12.9L12 19.5Z" fill="#5b4fe8" />
              </g>
              <circle cx="12" cy="12" r="1.1" fill="var(--v7-bg-raised-2)" stroke="#3a3d47" strokeWidth="0.5" />
            </svg>
          </div>
          <span className="font-extrabold text-[15px]" style={{ letterSpacing: '-0.01em' }}>Asher</span>
        </div>
        <div
          className="flex items-center gap-[5px] font-medium text-[9px] uppercase"
          style={{
            fontFamily: 'var(--v7-font-mono)',
            letterSpacing: '0.05em',
            color: 'var(--v7-text-dim)',
            border: '1px solid var(--v7-border-strong)',
            borderRadius: '100px',
            padding: '3px 8px 3px 7px',
          }}
        >
          <span className="w-[4px] h-[4px] rounded-full" style={{ background: 'var(--v7-cyan)', boxShadow: '0 0 6px var(--v7-cyan)' }} />
          Enterprise
        </div>
      </div>

      {/* Back link + controls */}
      <div className="flex items-center justify-between" style={{ padding: '0 0 22px' }}>
        <span
          className="flex items-center gap-[7px] text-[13px] font-medium"
          style={{ color: 'var(--v7-text-mute)', padding: '8px 8px' }}
        >
          <svg viewBox="0 0 24 24" fill="none" className="w-3.5 h-3.5">
            <path d="M15 5L8 12L15 19" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Back to home
        </span>
        <div className="flex items-center gap-1 shrink-0" style={{ color: 'var(--v7-text-mute)' }}>
          <Moon className="w-3.5 h-3.5" />
          <Bell className="w-3.5 h-3.5" />
          <PanelLeftClose className="w-3.5 h-3.5" />
        </div>
      </div>

      {/* New Analysis — the one hero CTA */}
      <div
        className={skinned ? 'vera-key vera-key-1 vera-newchat mb-[10px]' : 'flex items-center gap-[9px] font-bold text-[13.5px] mb-[10px]'}
        style={
          skinned
            ? undefined
            : {
                background: 'var(--v7-cyan-soft)',
                border: '1px solid var(--v7-cyan-strong)',
                color: 'var(--v7-cyan)',
                padding: '11px 15px',
                borderRadius: '14px',
              }
        }
      >
        <Plus className="w-3.5 h-3.5" />
        New Analysis
      </div>

      <div className="mb-[18px]" style={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
        <NavRow icon={LayoutGrid} label="Command Center" badge={pendingCount} active />
        <NavRow icon={WorkflowIcon} label="Workflows" />
        <div className="vera-label" style={{ padding: '10px 8px 4px' }}>Show above chat</div>
        <NavRow icon={Target} label="Goal panel" />
        <NavRow icon={MapIcon} label="Roadmap panel" />
      </div>

      <div className="flex-1 overflow-hidden min-h-0" style={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
        <div
          className="text-[10.5px] font-bold uppercase px-[10px] pb-2"
          style={{ color: 'var(--v7-text-mute)', fontFamily: 'var(--v7-font-mono)', letterSpacing: '0.07em' }}
        >
          Today
        </div>
        {SESSION_TITLES.map((title, i) => (
          <div
            key={title}
            className="w-full flex items-center text-left text-[13px] font-medium mb-[1px]"
            style={{
              padding: '9px 12px',
              borderRadius: '10px',
              color: i === 0 ? 'var(--v7-text)' : 'var(--v7-text-dim)',
              background: i === 0 ? 'var(--v7-bg-raised-2)' : 'transparent',
            }}
          >
            <span className="truncate flex-1">{title}</span>
          </div>
        ))}
      </div>

      <div style={{ paddingTop: '12px', borderTop: '1px solid var(--v7-border)', display: 'flex', flexDirection: 'column', gap: '1px' }}>
        <NavRow icon={Target} label="Goals" />
        <NavRow icon={SettingsIcon} label="Settings" />
      </div>
    </aside>
  );
}
