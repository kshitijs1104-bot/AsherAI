import { useState, useRef, useEffect } from 'react';
import { useLocation } from 'wouter';
import { Bell } from 'lucide-react';
import { useQueue } from '../lib/venusApi';

// Lives next to the theme toggle in Venus.tsx's sidebar header (both the
// collapsed rail and expanded states) — the one piece of Command Center
// chrome that follows the founder into the chat itself, so a new item never
// waits silently until they happen to click back to Vera Nexus and remember
// to check. Deliberately thin: the popover previews, it never lets you act
// (accept/edit/reject) from here — that stays exclusively Command Center's
// job so there's one place state actually changes, not two.
export function NotificationBell({ className = '' }: { className?: string }) {
  const [, navigate] = useLocation();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const { data } = useQueue();

  const pending = (data?.items ?? []).filter((i) => i.status === 'pending');
  const count = pending.length;

  useEffect(() => {
    if (!open) return;
    const handleClickAway = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handleClickAway);
    return () => document.removeEventListener('mousedown', handleClickAway);
  }, [open]);

  const goToCommandCenter = () => {
    setOpen(false);
    navigate('/venus/command-center');
  };

  return (
    <div className="relative" ref={containerRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        title="Command Center updates"
        aria-label={count > 0 ? `${count} items waiting in Command Center` : 'No pending Command Center items'}
        className={`relative p-1.5 rounded-lg shrink-0 ${className}`}
        style={{ color: 'var(--v7-text-mute)' }}
        onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--v7-text-dim)')}
        onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--v7-text-mute)')}
      >
        <Bell className="w-3.5 h-3.5" />
        {count > 0 && (
          <span
            className="absolute top-0.5 right-0.5 flex items-center justify-center rounded-full text-[8.5px] font-bold"
            style={{
              minWidth: '13px',
              height: '13px',
              padding: '0 3px',
              background: 'var(--red, #e5555c)',
              color: '#fff',
              lineHeight: 1,
            }}
          >
            {count > 9 ? '9+' : count}
          </span>
        )}
      </button>

      {open && (
        <div
          className="absolute right-0 mt-2 w-[280px] rounded-xl p-2.5 z-50"
          style={{ background: 'var(--v7-bg-raised)', border: '1px solid var(--v7-border, rgba(255,255,255,0.08))', boxShadow: '0 12px 32px -8px rgba(0,0,0,0.4)' }}
        >
          <div className="text-[10.5px] font-bold uppercase px-1 pb-2" style={{ color: 'var(--v7-text-mute)', fontFamily: 'var(--v7-font-mono)', letterSpacing: '0.06em' }}>
            {count > 0 ? `${count} waiting on you` : 'All caught up'}
          </div>

          {count === 0 && (
            <div className="text-[12px] px-1 pb-1.5" style={{ color: 'var(--v7-text-mute)' }}>
              Nothing pending right now.
            </div>
          )}

          {pending.slice(0, 4).map((item) => (
            <div key={item.id} className="px-1 py-1.5 text-[12px] truncate" style={{ color: 'var(--v7-text-dim)' }}>
              {item.title}
            </div>
          ))}

          <button
            onClick={goToCommandCenter}
            className="w-full mt-1.5 text-[11.5px] font-semibold px-2.5 py-1.5 rounded-md text-center"
            style={{ background: 'var(--v7-cyan-soft)', border: '1px solid var(--v7-cyan-strong)', color: 'var(--v7-cyan)' }}
          >
            Open Command Center
          </button>
        </div>
      )}
    </div>
  );
}
