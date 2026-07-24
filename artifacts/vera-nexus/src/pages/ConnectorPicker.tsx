import { useState } from 'react';
import { Plug, RefreshCw, Unlink, Search } from 'lucide-react';
import {
  useConnectors, useSyncConnector, useDisconnectConnector, useConfigureWhatsapp, startConnectorAuth,
  type ConnectorStatus,
} from '../lib/venusApi';

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

function ConnectorRow({ connector }: { connector: ConnectorStatus }) {
  const sync = useSyncConnector();
  const disconnect = useDisconnectConnector();
  const [configuringWhatsapp, setConfiguringWhatsapp] = useState(false);
  const isConnected = connector.status === 'connected';
  const isError = connector.status === 'error';

  if (connector.type === 'whatsapp' && configuringWhatsapp) {
    return <WhatsappConfigForm onDone={() => setConfiguringWhatsapp(false)} />;
  }

  return (
    <div
      className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-[13px] font-medium"
      style={{ background: 'var(--v7-bg-raised-2)', opacity: connector.implemented ? 1 : 0.5 }}
    >
      <span
        className="w-1.5 h-1.5 rounded-full shrink-0"
        style={{ background: isError ? 'var(--red, #e5555c)' : isConnected ? 'var(--v7-cyan)' : 'var(--v7-text-mute)' }}
      />
      <span className="flex-1" style={{ color: isConnected ? 'var(--v7-cyan)' : 'var(--v7-text-dim)' }}>{connector.label}</span>

      {!connector.implemented ? (
        <span className="text-[10.5px]" style={{ color: 'var(--v7-text-mute)' }}>Coming soon</span>
      ) : isConnected ? (
        <span className="flex items-center gap-1.5">
          {connector.type !== 'linkedin' && connector.type !== 'whatsapp' && (
            <button title="Sync now" disabled={sync.isPending} onClick={() => sync.mutate(connector.type)} style={{ color: 'var(--v7-text-mute)' }}>
              <RefreshCw className={`w-3.5 h-3.5 ${sync.isPending ? 'animate-spin' : ''}`} />
            </button>
          )}
          <button title="Disconnect" disabled={disconnect.isPending} onClick={() => disconnect.mutate(connector.type)} style={{ color: 'var(--v7-text-mute)' }}>
            <Unlink className="w-3.5 h-3.5" />
          </button>
        </span>
      ) : connector.type === 'whatsapp' ? (
        <button onClick={() => setConfiguringWhatsapp(true)} className="text-[11.5px] font-semibold" style={{ color: 'var(--v7-cyan)' }}>
          Connect
        </button>
      ) : (
        <button onClick={() => startConnectorAuth(connector.type)} className="text-[11.5px] font-semibold" style={{ color: 'var(--v7-cyan)' }}>
          Connect
        </button>
      )}
    </div>
  );
}

// Shared search+list, used both from the chat composer's "+" menu (quick,
// in-context connecting without leaving the conversation) and from Venus's
// own settings drawer (the durable place to manage them). One component, no
// drift between the two entry points.
export function ConnectorPicker() {
  const { data, isError, error } = useConnectors();
  const [query, setQuery] = useState('');
  const connectors = (data?.connectors ?? []).filter((c) => c.label.toLowerCase().includes(query.trim().toLowerCase()));

  return (
    <div className="w-full">
      <div className="relative mb-2">
        <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--v7-text-mute)' }} />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search connectors…"
          className="w-full text-[12.5px] rounded-lg pl-8 pr-2.5 py-2 outline-none"
          style={{ background: 'var(--v7-bg-raised-2)', color: 'var(--v7-text)', border: '1px solid var(--v7-border, rgba(255,255,255,0.08))' }}
        />
      </div>
      {isError && (
        <div className="flex items-center gap-2 text-[12px] px-1 py-2 mb-1" style={{ color: 'var(--red, #e5555c)' }}>
          {error instanceof Error ? error.message : 'Failed to load connectors'}
        </div>
      )}
      <div className="space-y-1.5 max-h-[280px] overflow-y-auto">
        {!isError && connectors.length === 0 && (
          <div className="flex items-center gap-2 text-[12px] px-1 py-2" style={{ color: 'var(--v7-text-mute)' }}>
            <Plug className="w-3.5 h-3.5" />
            No connectors match "{query}"
          </div>
        )}
        {connectors.map((c) => (
          <ConnectorRow key={c.type} connector={c} />
        ))}
      </div>
    </div>
  );
}
