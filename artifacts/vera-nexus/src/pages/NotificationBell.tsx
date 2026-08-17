import { useState, useRef, useEffect } from 'react';
import { Bell } from 'lucide-react';
import { useQueue } from '../lib/venusApi';

// Lives ONLY in the collapsed sidebar rail — when the sidebar is expanded,
// the Command Center nav row is already visible with its own unread badge
// (see Venus.tsx's SidebarNavRow badgeCount), so a second bell icon there
// would just duplicate it. Collapsing hides that row entirely, which is
// exactly when this becomes the only way to see there's something waiting
// without expanding the sidebar first. Deliberately thin: the popover
// previews, it never lets you act (accept/edit/reject) from here — that
// stays exclusively Command Center's job so there's one place state
// actually changes, not two.
export function NotificationBell({ className = '', onOpenCommandCenter }: { className?: string; onOpenCommandCenter: () => void }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const { data } = useQueue();

  const pending = (data?.items ?? []).filter((i) => i.status === 'pending');

  // ---- The dot counts UNSEEN, not pending ----
  //
  // It used to show every pending item, which meant the badge sat on a number
  // permanently until the founder cleared the whole board — and a badge that is
  // always lit stops carrying information. It cannot say "something new arrived
  // today", which is the one thing worth interrupting someone for.
  //
  // `unseen` is items that have never been on screen. It clears when the board
  // is actually opened and lights up again when the 6am brief (or a connector
  // poll) puts something new in — so the dot means "there is something here you
  // haven't looked at", every time.
  //
  // The popover below still lists PENDING items, because "what's waiting for a
  // decision" is the right content once you've opened it. Two different
  // questions, two different numbers.
  const count = data?.unseen ?? 0;

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
    onOpenCommandCenter();
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
          // left-full (not right-0) — this button sits in a 44px-wide rail
          // pinned to the very left edge of the viewport; right-aligning a
          // 280px popover against it pushes most of the popover off-screen
          // to the left. Opening to the right of the button instead keeps
          // it fully on-screen.
          className="absolute left-full top-0 ml-2 w-[280px] rounded-xl p-2.5 z-50"
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
