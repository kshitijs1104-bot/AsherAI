import { useState } from 'react';
import { useLocation } from 'wouter';
import { ArrowLeft, LayoutGrid, Check, Pencil, X, Mail, FileSpreadsheet, Sparkles, Workflow, Inbox, Plug, RefreshCw, Unlink, Calendar, NotebookText, Ticket, Linkedin, MessageCircle } from 'lucide-react';
import {
  useQueue, useQueueAction, useConnectors, useSyncConnector, useDisconnectConnector, useConfigureWhatsapp, startConnectorAuth, useDailyBrief,
  type QueueItem, type QueueItemStatus, type ConnectorStatus,
} from '../lib/venusApi';
import { VenusThemeToggle } from './VenusThemeToggle';
import { useVenusTheme } from '../lib/venusTheme';
import { QuickActions } from './QuickActions';
import { StatsStrip } from './TodayCard';

// Command Center is a LIST of things Vera already did, not a dashboard menu
// and not a prompt box — every row here is an output (a drafted reply, an
// insight it found, an automation it's suggesting) waiting on a founder
// yes/edit/no. Source attribution (source badge below) is what will let
// this same list absorb connector and workflow output later without any
// layout change once those land.
const SOURCE_ICON: Record<string, typeof Mail> = {
  gmail: Mail,
  slack: Mail,
  sheets: FileSpreadsheet,
  calendar: Calendar,
  notion: NotebookText,
  jira: Ticket,
  linkedin: Linkedin,
  whatsapp: MessageCircle,
  workflow: Workflow,
};

function sourceIcon(source: string) {
  return SOURCE_ICON[source] ?? Sparkles;
}

function sourceLabel(source: string): string {
  if (source.startsWith('workflow:')) return source.slice('workflow:'.length).replace(/-/g, ' ');
  if (source.startsWith('connector:')) return source.slice('connector:'.length);
  return source;
}

const RESOLVED_LABEL: Partial<Record<QueueItemStatus, string>> = {
  accepted: 'Accepted',
  edited: 'Edited & sent',
  rejected: 'Rejected',
};

function QueueCard({ item }: { item: QueueItem }) {
  const action = useQueueAction();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.draftContent ?? '');
  const isPending = item.status === 'pending';
  const Icon = sourceIcon(item.source);

  const handleAccept = () => action.mutate({ id: item.id, action: 'accept' });
  const handleReject = () => action.mutate({ id: item.id, action: 'reject' });
  const handleSubmitEdit = () => {
    if (!draft.trim()) return;
    action.mutate({ id: item.id, action: 'edit', editedContent: draft.trim() }, { onSuccess: () => setEditing(false) });
  };

  return (
    <div
      className="rounded-xl p-4"
      style={{ background: 'var(--v7-bg-raised)', border: '1px solid var(--v7-border, rgba(255,255,255,0.08))' }}
    >
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <span
            className="w-5 h-5 rounded-md flex items-center justify-center shrink-0"
            style={{ background: 'var(--v7-cyan-soft)' }}
          >
            <Icon className="w-3 h-3" style={{ color: 'var(--v7-cyan)' }} />
          </span>
          <span
            className="text-[9.5px] font-mono uppercase px-1.5 py-0.5 rounded shrink-0"
            style={{ background: 'var(--v7-bg-raised-2)', color: 'var(--v7-text-mute)' }}
          >
            {sourceLabel(item.source)}
          </span>
        </div>
        {!isPending && (
          <span className="text-[10.5px] font-semibold shrink-0" style={{ color: 'var(--v7-text-mute)' }}>
            {RESOLVED_LABEL[item.status]}
          </span>
        )}
      </div>

      <div className="text-[13.5px] font-semibold mb-1" style={{ color: 'var(--v7-text)' }}>{item.title}</div>
      <div className="text-[12.5px] mb-2" style={{ color: 'var(--v7-text-dim)' }}>{item.body}</div>

      {isPending && item.draftContent && !editing && (
        <div
          className="text-[12px] whitespace-pre-wrap rounded-lg p-2.5 mb-2.5"
          style={{ background: 'var(--v7-bg-raised-2)', color: 'var(--v7-text-dim)' }}
        >
          {item.draftContent}
        </div>
      )}

      {isPending && editing && (
        <div className="mb-2.5">
          <textarea
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={5}
            className="w-full text-[12px] rounded-lg p-2.5 outline-none"
            style={{ background: 'var(--v7-bg-raised-2)', color: 'var(--v7-text)', border: '1px solid var(--v7-cyan-strong)' }}
          />
        </div>
      )}

      {isPending && (
        <div className="flex items-center gap-1.5">
          {editing ? (
            <>
              <button
                disabled={!draft.trim() || action.isPending}
                onClick={handleSubmitEdit}
                className="flex items-center gap-1 text-[11.5px] font-semibold px-2.5 py-1.5 rounded-md"
                style={{ background: 'var(--v7-cyan-soft)', border: '1px solid var(--v7-cyan-strong)', color: 'var(--v7-cyan)' }}
              >
                <Check className="w-3 h-3" />
                Save & send
              </button>
              <button
                onClick={() => { setEditing(false); setDraft(item.draftContent ?? ''); }}
                className="text-[11.5px] font-medium px-2.5 py-1.5"
                style={{ color: 'var(--v7-text-mute)' }}
              >
                Cancel
              </button>
            </>
          ) : (
            <>
              <button
                disabled={action.isPending}
                onClick={handleAccept}
                className="flex items-center gap-1 text-[11.5px] font-semibold px-2.5 py-1.5 rounded-md"
                style={{ background: 'var(--v7-cyan-soft)', border: '1px solid var(--v7-cyan-strong)', color: 'var(--v7-cyan)' }}
              >
                <Check className="w-3 h-3" />
                Accept
              </button>
              {item.draftContent && (
                <button
                  disabled={action.isPending}
                  onClick={() => setEditing(true)}
                  className="flex items-center gap-1 text-[11.5px] font-medium px-2.5 py-1.5 rounded-md"
                  style={{ border: '1px solid var(--v7-border, rgba(255,255,255,0.08))', color: 'var(--v7-text-dim)' }}
                >
                  <Pencil className="w-3 h-3" />
                  Edit
                </button>
              )}
              <button
                disabled={action.isPending}
                onClick={handleReject}
                className="flex items-center gap-1 text-[11.5px] font-medium px-2.5 py-1.5 rounded-md"
                style={{ color: 'var(--v7-text-mute)' }}
              >
                <X className="w-3 h-3" />
                Dismiss
              </button>
            </>
          )}
        </div>
      )}

      {action.isError && (
        <div className="text-[11.5px] mt-2" style={{ color: 'var(--red, #e5555c)' }}>
          {action.error instanceof Error ? action.error.message : 'Failed — try again.'}
        </div>
      )}
    </div>
  );
}

// Compact status row, not a settings page — one place a founder sees which
// services Vera can currently poll for them, and can connect/disconnect
// without leaving Command Center. Unimplemented types (see registry.ts on
// the backend) render disabled with "Coming soon" so the list is honest
// about what actually works today rather than offering a dead button.
// WhatsApp isn't OAuth (see venusApi.ts's useConfigureWhatsapp) — the founder
// pastes a phone number id + permanent token they already generated in their
// own Meta Business console, instead of a redirect. Rendered inline, same
// spot the "Connect" button would otherwise be.
function WhatsappConfigForm({ onDone }: { onDone: () => void }) {
  const [phoneNumberId, setPhoneNumberId] = useState('');
  const [permanentToken, setPermanentToken] = useState('');
  const configure = useConfigureWhatsapp();

  const handleSubmit = () => {
    if (!phoneNumberId.trim() || !permanentToken.trim()) return;
    configure.mutate({ phoneNumberId: phoneNumberId.trim(), permanentToken: permanentToken.trim() }, { onSuccess: onDone });
  };

  return (
    <div className="rounded-xl p-3 w-full" style={{ background: 'var(--v7-bg-raised-2)' }}>
      <div className="text-[11px] mb-2" style={{ color: 'var(--v7-text-mute)' }}>
        From your Meta Business console's WhatsApp Cloud API setup:
      </div>
      <input
        value={phoneNumberId}
        onChange={(e) => setPhoneNumberId(e.target.value)}
        placeholder="Phone number ID"
        className="w-full text-[12px] rounded-md px-2 py-1.5 mb-1.5 outline-none"
        style={{ background: 'var(--v7-bg-raised)', color: 'var(--v7-text)', border: '1px solid var(--v7-border, rgba(255,255,255,0.08))' }}
      />
      <input
        type="password"
        value={permanentToken}
        onChange={(e) => setPermanentToken(e.target.value)}
        placeholder="Permanent access token"
        className="w-full text-[12px] rounded-md px-2 py-1.5 mb-2 outline-none"
        style={{ background: 'var(--v7-bg-raised)', color: 'var(--v7-text)', border: '1px solid var(--v7-border, rgba(255,255,255,0.08))' }}
      />
      <div className="flex items-center gap-1.5">
        <button
          disabled={!phoneNumberId.trim() || !permanentToken.trim() || configure.isPending}
          onClick={handleSubmit}
          className="text-[11.5px] font-semibold px-2.5 py-1.5 rounded-md"
          style={{ background: 'var(--v7-cyan-soft)', border: '1px solid var(--v7-cyan-strong)', color: 'var(--v7-cyan)' }}
        >
          {configure.isPending ? 'Saving…' : 'Save'}
        </button>
        <button onClick={onDone} className="text-[11.5px]" style={{ color: 'var(--v7-text-mute)' }}>
          Cancel
        </button>
      </div>
      {configure.isError && (
        <div className="text-[11px] mt-1.5" style={{ color: 'var(--red, #e5555c)' }}>
          {configure.error instanceof Error ? configure.error.message : 'Failed — try again.'}
        </div>
      )}
    </div>
  );
}

function ConnectorChip({ connector }: { connector: ConnectorStatus }) {
  const sync = useSyncConnector();
  const disconnect = useDisconnectConnector();
  const [configuringWhatsapp, setConfiguringWhatsapp] = useState(false);
  const isConnected = connector.status === 'connected';
  const isError = connector.status === 'error';

  if (!connector.implemented) {
    return (
      <div
        className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[11.5px] font-medium opacity-50"
        style={{ background: 'var(--v7-bg-raised-2)', color: 'var(--v7-text-mute)' }}
        title="Coming soon"
      >
        <Plug className="w-3 h-3" />
        {connector.label}
      </div>
    );
  }

  if (connector.type === 'whatsapp' && configuringWhatsapp) {
    return <WhatsappConfigForm onDone={() => setConfiguringWhatsapp(false)} />;
  }

  return (
    <div
      className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[11.5px] font-medium"
      style={{
        background: isConnected ? 'var(--v7-cyan-soft)' : 'var(--v7-bg-raised-2)',
        border: `1px solid ${isError ? 'var(--red, #e5555c)' : isConnected ? 'var(--v7-cyan-strong)' : 'transparent'}`,
        color: isConnected ? 'var(--v7-cyan)' : 'var(--v7-text-dim)',
      }}
    >
      <span
        className="w-1.5 h-1.5 rounded-full shrink-0"
        style={{ background: isError ? 'var(--red, #e5555c)' : isConnected ? 'var(--v7-cyan)' : 'var(--v7-text-mute)' }}
      />
      {connector.label}
      {isConnected ? (
        <span className="flex items-center gap-1">
          {/* Posting-only connectors have nothing to sync — see poll.ts */}
          {connector.type !== 'linkedin' && connector.type !== 'whatsapp' && (
            <button
              title="Sync now"
              disabled={sync.isPending}
              onClick={() => sync.mutate(connector.type)}
              style={{ color: 'inherit' }}
            >
              <RefreshCw className={`w-3 h-3 ${sync.isPending ? 'animate-spin' : ''}`} />
            </button>
          )}
          <button title="Disconnect" disabled={disconnect.isPending} onClick={() => disconnect.mutate(connector.type)} style={{ color: 'inherit' }}>
            <Unlink className="w-3 h-3" />
          </button>
        </span>
      ) : connector.type === 'whatsapp' ? (
        <button onClick={() => setConfiguringWhatsapp(true)} className="font-semibold" style={{ color: 'var(--v7-cyan)' }}>
          Connect
        </button>
      ) : (
        <button onClick={() => startConnectorAuth(connector.type)} className="font-semibold" style={{ color: 'var(--v7-cyan)' }}>
          Connect
        </button>
      )}
    </div>
  );
}

function ConnectorsPanel() {
  const { data } = useConnectors();
  const connectors = data?.connectors ?? [];
  if (connectors.length === 0) return null;

  return (
    <div className="mb-7">
      <div
        className="text-[10.5px] font-bold uppercase px-0.5 pb-2.5"
        style={{ color: 'var(--v7-text-mute)', fontFamily: 'var(--v7-font-mono)', letterSpacing: '0.07em' }}
      >
        Connectors
      </div>
      <div className="flex flex-wrap gap-1.5">
        {connectors.map((c) => (
          <ConnectorChip key={c.type} connector={c} />
        ))}
      </div>
    </div>
  );
}

export function CommandCenterPage() {
  const [, navigate] = useLocation();
  const { theme, toggle: toggleTheme } = useVenusTheme();
  const { data, isLoading } = useQueue();
  const dailyBrief = useDailyBrief();

  const items = data?.items ?? [];
  const pending = items.filter((i) => i.status === 'pending');
  const resolved = items.filter((i) => i.status !== 'pending');

  return (
    <div className={`min-h-screen w-full ${theme === 'light' ? 'v7-light' : ''}`} style={{ background: 'var(--v7-bg)', color: 'var(--v7-text)', fontFamily: 'var(--v7-font-round)' }}>
      <div className="max-w-2xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <button
            onClick={() => navigate('/venus')}
            className="flex items-center gap-1.5 text-[13px] font-medium"
            style={{ color: 'var(--v7-text-mute)' }}
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Back to Vera
          </button>
          <VenusThemeToggle theme={theme} onToggle={toggleTheme} />
        </div>

        <div className="flex items-center gap-2 mb-1">
          <LayoutGrid className="w-4 h-4" style={{ color: 'var(--v7-cyan)' }} />
          <h1 className="text-[19px] font-extrabold">Command Center</h1>
        </div>
        <p className="text-[13px] mb-4" style={{ color: 'var(--v7-text-mute)' }}>
          Everything Vera drafted, decided, or found while you were away.
        </p>

        {dailyBrief.data?.stats && <StatsStrip stats={dailyBrief.data.stats} />}

        <ConnectorsPanel />
        <QuickActions />

        {isLoading && <div className="text-[13px]" style={{ color: 'var(--v7-text-mute)' }}>Loading…</div>}

        {!isLoading && pending.length === 0 && (
          <div
            className="flex items-center gap-2.5 text-[13px] rounded-xl p-4 mb-6"
            style={{ background: 'var(--v7-bg-raised)', color: 'var(--v7-text-mute)' }}
          >
            <Inbox className="w-4 h-4 shrink-0" />
            Queue is clear — nothing waiting on you right now.
          </div>
        )}

        {pending.length > 0 && (
          <div className="mb-7">
            <div
              className="text-[10.5px] font-bold uppercase px-0.5 pb-2.5"
              style={{ color: 'var(--v7-text-mute)', fontFamily: 'var(--v7-font-mono)', letterSpacing: '0.07em' }}
            >
              Needs you ({pending.length})
            </div>
            <div className="space-y-2.5">
              {pending.map((item) => (
                <QueueCard key={item.id} item={item} />
              ))}
            </div>
          </div>
        )}

        {resolved.length > 0 && (
          <div>
            <div
              className="text-[10.5px] font-bold uppercase px-0.5 pb-2.5"
              style={{ color: 'var(--v7-text-mute)', fontFamily: 'var(--v7-font-mono)', letterSpacing: '0.07em' }}
            >
              Recently resolved
            </div>
            <div className="space-y-2.5">
              {resolved.map((item) => (
                <QueueCard key={item.id} item={item} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
