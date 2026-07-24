import { useEffect, useRef, useState } from 'react';
import { Plus, Image, Plug, ChevronLeft } from 'lucide-react';
import { ConnectorPicker } from './ConnectorPicker';

// Replaces the bare paperclip button — a founder had no way to reach
// connectors from inside the chat itself before this (Command Center was
// the only place). "+" opens exactly two options for now (images/files,
// connectors) rather than growing into a crowded command palette; more
// options can be added to this same list later without a redesign.
export function AttachMenu({ onPickFiles, className = '', iconClassName = 'w-4 h-4', style }: { onPickFiles: () => void; className?: string; iconClassName?: string; style?: React.CSSProperties }) {
  const [open, setOpen] = useState(false);
  const [showConnectors, setShowConnectors] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClickAway = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) { setOpen(false); setShowConnectors(false); }
    };
    document.addEventListener('mousedown', handleClickAway);
    return () => document.removeEventListener('mousedown', handleClickAway);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        title="Add images, files, or connectors"
        onClick={() => setOpen((v) => !v)}
        className={className}
        style={style}
      >
        <Plus className={iconClassName} />
      </button>

      {open && (
        <div
          className="absolute bottom-full left-0 mb-2 w-[260px] rounded-xl p-1.5 z-50"
          style={{ background: 'var(--v7-bg-raised, var(--surface2))', border: '1px solid var(--v7-border, var(--border))', boxShadow: '0 12px 32px -8px rgba(0,0,0,0.4)' }}
        >
          {!showConnectors ? (
            <>
              <button
                onClick={() => { onPickFiles(); setOpen(false); }}
                className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[13px] font-medium text-left"
                style={{ color: 'var(--v7-text-dim, var(--text))' }}
              >
                <Image className="w-4 h-4" style={{ color: 'var(--v7-cyan, var(--indigo))' }} />
                Photos & files
              </button>
              <button
                onClick={() => setShowConnectors(true)}
                className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[13px] font-medium text-left"
                style={{ color: 'var(--v7-text-dim, var(--text))' }}
              >
                <Plug className="w-4 h-4" style={{ color: 'var(--v7-cyan, var(--indigo))' }} />
                Connectors
              </button>
            </>
          ) : (
            <div className="p-1.5">
              <button
                onClick={() => setShowConnectors(false)}
                className="flex items-center gap-1 text-[11.5px] font-medium mb-2"
                style={{ color: 'var(--v7-text-mute, var(--dim))' }}
              >
                <ChevronLeft className="w-3.5 h-3.5" /> Back
              </button>
              <ConnectorPicker />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
