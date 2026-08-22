import { useEffect } from 'react';
import { X, ExternalLink } from 'lucide-react';

export interface PreviewableAttachment {
  id: number;
  fileName: string;
  mimeType: string;
}

/**
 * Full preview for a file already sent in the chat — opened by clicking its
 * chip in the message history. Mirrors VeraSettingsModal's overlay/card/
 * Escape-to-close shape so every modal in the product behaves the same way
 * rather than each screen inventing its own.
 *
 * Images and PDFs render inline against `/api/attachments/:id` (same-origin,
 * so the Clerk session cookie authenticates the request with no extra work).
 * Everything else — Word, Excel, etc. — has no reliable in-browser renderer,
 * so it gets an honest "can't preview this" with a link to open it directly
 * rather than a broken embed.
 */
export function AttachmentPreviewModal({
  attachment,
  onClose,
}: {
  attachment: PreviewableAttachment | null;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!attachment) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [attachment, onClose]);

  if (!attachment) return null;

  const url = `/api/attachments/${attachment.id}`;
  const isImage = attachment.mimeType.startsWith('image/');
  const isPdf = attachment.mimeType === 'application/pdf';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={attachment.fileName}
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100,
        display: 'grid',
        placeItems: 'center',
        padding: '24px',
        background: 'rgba(0,0,0,0.65)',
        backdropFilter: 'blur(6px)',
        WebkitBackdropFilter: 'blur(6px)',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: '860px',
          maxHeight: '85vh',
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--v7-bg-raised)',
          border: '1px solid var(--v7-border-strong)',
          borderRadius: '16px',
          boxShadow: '0 40px 90px -30px rgba(0,0,0,0.7)',
          fontFamily: 'var(--v7-font-round)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
            padding: '14px 14px 12px 20px',
            flexShrink: 0,
            borderBottom: '1px solid var(--v7-border)',
          }}
        >
          <span
            className="truncate"
            style={{ fontSize: '13.5px', fontWeight: 600, color: 'var(--v7-text)', minWidth: 0 }}
          >
            {attachment.fileName}
          </span>
          <div className="flex items-center gap-1 shrink-0">
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              title="Open in a new tab"
              className="p-1.5 rounded-lg"
              style={{ color: 'var(--v7-text-mute)' }}
              onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--v7-text)')}
              onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--v7-text-mute)')}
            >
              <ExternalLink className="w-4 h-4" />
            </a>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close preview"
              className="p-1.5 rounded-lg"
              style={{ color: 'var(--v7-text-mute)' }}
              onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--v7-text)')}
              onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--v7-text-mute)')}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div
          style={{
            flex: 1,
            overflow: 'auto',
            display: 'flex',
            alignItems: isImage ? 'center' : 'stretch',
            justifyContent: 'center',
            padding: isImage ? '20px' : 0,
            background: isPdf ? '#fff' : 'var(--v7-bg)',
          }}
        >
          {isImage ? (
            <img
              src={url}
              alt={attachment.fileName}
              style={{ maxWidth: '100%', maxHeight: '75vh', borderRadius: '10px' }}
            />
          ) : isPdf ? (
            <iframe src={url} title={attachment.fileName} style={{ width: '100%', height: '75vh', border: 'none' }} />
          ) : (
            <div style={{ padding: '48px 24px', textAlign: 'center' }}>
              <p style={{ fontSize: '13px', marginBottom: '14px', color: 'var(--v7-text-dim)' }}>
                Asher can't preview this file type inline.
              </p>
              <a
                href={url}
                target="_blank"
                rel="noreferrer"
                style={{ fontSize: '13px', fontWeight: 600, color: 'var(--v7-cyan)' }}
              >
                Open {attachment.fileName} in a new tab →
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
