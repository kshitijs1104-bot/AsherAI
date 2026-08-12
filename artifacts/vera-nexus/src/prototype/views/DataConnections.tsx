import { useMemo, useState } from 'react';
import { RefreshCw, Search, Unlink, Plug, TriangleAlert } from 'lucide-react';
import { Button, Eyebrow, Label, MONO, PageHead, Panel, Rise, StatusPill, type Tone } from '../ui';
import { CONNECTORS, type ConnectorFixture, type ConnectorState } from '../data';

/* ---------------------------------------------------------------------------
 * Data Connections.
 *
 * Information architecture carried over from pages/ConnectorPicker.tsx: a
 * search field over a status-dot list, per-row Sync / Disconnect / Connect
 * actions, a "coming soon" state for unimplemented sources, and the inline
 * WhatsApp form (phone number ID + permanent token) rendered in the same slot
 * the Connect button would occupy.
 * ------------------------------------------------------------------------ */

const STATE_TONE: Record<ConnectorState, Tone> = {
  connected: 'ok',
  disconnected: 'idle',
  error: 'crit',
  soon: 'idle',
};

const STATE_LABEL: Record<ConnectorState, string> = {
  connected: 'Connected',
  disconnected: 'Not connected',
  error: 'Needs attention',
  soon: 'Coming soon',
};

function WhatsappForm({ onDone }: { onDone: () => void }) {
  const [phoneNumberId, setPhoneNumberId] = useState('');
  const [token, setToken] = useState('');
  const ready = phoneNumberId.trim().length > 0 && token.trim().length > 0;

  const field = {
    background: 'var(--p-bg-2)',
    border: '1px solid var(--p-line)',
    color: 'var(--p-text)',
  } as const;

  return (
    <div className="rounded-xl p-4 mt-1" style={{ background: 'var(--p-card-2)', border: '1px solid var(--p-line)' }}>
      <Label>Connect WhatsApp Business</Label>
      <p className="m-0 mt-1.5 mb-3 text-[12.5px] font-medium leading-[1.55] max-w-[54ch]" style={{ color: 'var(--p-text-2)' }}>
        WhatsApp is not an OAuth connector. Paste the two values from your own Meta Business console's WhatsApp Cloud API setup.
      </p>
      <label className="block mb-2">
        <span className="block mb-1">
          <Label>Phone number ID</Label>
        </span>
        <input
          value={phoneNumberId}
          onChange={(e) => setPhoneNumberId(e.target.value)}
          placeholder="e.g. 109876543210987"
          className="w-full rounded-lg px-3 py-2 text-[13px] font-semibold outline-none"
          style={field}
        />
      </label>
      <label className="block mb-3">
        <span className="block mb-1">
          <Label>Permanent access token</Label>
        </span>
        <input
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="Paste the token you generated"
          className="w-full rounded-lg px-3 py-2 text-[13px] font-semibold outline-none"
          style={field}
        />
      </label>
      <div className="flex items-center gap-2">
        <Button variant="primary" disabled={!ready} onClick={onDone}>
          Save connection
        </Button>
        <Button variant="quiet" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function ConnectorRow({ connector, onToggle }: { connector: ConnectorFixture; onToggle: (type: string) => void }) {
  const [configuring, setConfiguring] = useState(false);
  const connected = connector.state === 'connected';
  const soon = connector.state === 'soon';

  return (
    <div>
      <div
        className="flex items-center gap-3.5 rounded-xl px-4 py-3.5"
        style={{
          background: 'var(--p-card)',
          border: `1px solid ${connector.state === 'error' ? 'color-mix(in srgb, var(--p-crit) 40%, transparent)' : 'var(--p-line)'}`,
          boxShadow: 'var(--p-elev)',
          opacity: soon ? 0.72 : 1,
        }}
      >
        <span
          className="w-9 h-9 rounded-xl grid place-items-center shrink-0"
          style={{
            background: connected ? 'var(--p-accent-tint)' : 'var(--p-card-2)',
            border: `1px solid ${connected ? 'var(--p-accent-edge)' : 'var(--p-line)'}`,
            color: connected ? 'var(--p-accent-2)' : 'var(--p-text-2)',
          }}
        >
          {connector.state === 'error' ? (
            <TriangleAlert className="w-4 h-4" strokeWidth={2.2} style={{ color: 'var(--p-crit)' }} />
          ) : (
            <Plug className="w-4 h-4" strokeWidth={2.2} />
          )}
        </span>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2.5 flex-wrap">
            <span className="text-[14px] font-bold" style={{ color: 'var(--p-text)', letterSpacing: '-.016em' }}>
              {connector.label}
            </span>
            <StatusPill tone={STATE_TONE[connector.state]}>{STATE_LABEL[connector.state]}</StatusPill>
          </div>
          <div className="text-[12.5px] font-medium leading-[1.5] mt-1 max-w-[62ch]" style={{ color: 'var(--p-text-2)' }}>
            {connector.detail}
          </div>
          {connector.lastSync || connector.records ? (
            <div className="flex items-center gap-x-4 gap-y-1 flex-wrap mt-2">
              {connector.lastSync ? (
                <span className="flex items-baseline gap-1.5">
                  <Label>Last sync</Label>
                  <b className="text-[11.5px] font-bold" style={{ fontFamily: MONO, color: 'var(--p-text)' }}>
                    {connector.lastSync}
                  </b>
                </span>
              ) : null}
              {connector.records ? (
                <span className="flex items-baseline gap-1.5">
                  <Label>Holding</Label>
                  <b className="text-[11.5px] font-bold" style={{ fontFamily: MONO, fontVariantNumeric: 'tabular-nums', color: 'var(--p-text)' }}>
                    {connector.records}
                  </b>
                </span>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {soon ? (
            <span className="text-[11.5px] font-bold" style={{ fontFamily: MONO, color: 'var(--p-text-2)' }}>
              SOON
            </span>
          ) : connected ? (
            <>
              <Button>
                <RefreshCw className="w-3.5 h-3.5" strokeWidth={2.4} />
                Sync
              </Button>
              <Button variant="quiet" onClick={() => onToggle(connector.type)}>
                <Unlink className="w-3.5 h-3.5" strokeWidth={2.2} />
                Disconnect
              </Button>
            </>
          ) : connector.type === 'whatsapp' ? (
            <Button variant="primary" onClick={() => setConfiguring((v) => !v)}>
              {configuring ? 'Close' : 'Connect'}
            </Button>
          ) : (
            <Button variant="primary" onClick={() => onToggle(connector.type)}>
              {connector.state === 'error' ? 'Reconnect' : 'Connect'}
            </Button>
          )}
        </div>
      </div>

      {configuring && connector.type === 'whatsapp' ? <WhatsappForm onDone={() => setConfiguring(false)} /> : null}
    </div>
  );
}

export function DataConnections() {
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState(CONNECTORS);

  const toggle = (type: string) => {
    setRows((prev) =>
      prev.map((c) =>
        c.type === type
          ? {
              ...c,
              state: c.state === 'connected' ? ('disconnected' as const) : ('connected' as const),
              lastSync: c.state === 'connected' ? null : 'Just now',
              records: c.state === 'connected' ? null : c.records ?? 'Syncing…',
            }
          : c,
      ),
    );
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((c) => c.label.toLowerCase().includes(q) || c.category.toLowerCase().includes(q));
  }, [query, rows]);

  const grouped = useMemo(() => {
    const map = new Map<string, ConnectorFixture[]>();
    filtered.forEach((c) => {
      const list = map.get(c.category) ?? [];
      list.push(c);
      map.set(c.category, list);
    });
    return [...map.entries()];
  }, [filtered]);

  const connected = rows.filter((c) => c.state === 'connected').length;
  const attention = rows.filter((c) => c.state === 'error').length;

  return (
    <div className="h-full overflow-y-auto vp-scroll">
      <div className="max-w-[880px] mx-auto px-6 py-8">
        <Rise>
          <PageHead
            eyebrow="Data Connections"
            title="Where Vera gets its evidence"
            blurb="Every source below feeds the causal trace. Connect more and the answers get narrower; disconnect one and Vera tells you which conclusions it can no longer stand behind."
          />
        </Rise>

        <Rise delay={60}>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
            <Panel className="px-4 py-3.5">
              <Label>Connected</Label>
              <div className="text-[26px] font-bold mt-1.5" style={{ color: 'var(--p-ok)', fontVariantNumeric: 'tabular-nums', letterSpacing: '-.03em' }}>
                {connected}
              </div>
            </Panel>
            <Panel className="px-4 py-3.5">
              <Label>Needs attention</Label>
              <div
                className="text-[26px] font-bold mt-1.5"
                style={{ color: attention > 0 ? 'var(--p-crit)' : 'var(--p-text)', fontVariantNumeric: 'tabular-nums', letterSpacing: '-.03em' }}
              >
                {attention}
              </div>
            </Panel>
            <Panel className="px-4 py-3.5">
              <Label>Available</Label>
              <div className="text-[26px] font-bold mt-1.5" style={{ color: 'var(--p-text)', fontVariantNumeric: 'tabular-nums', letterSpacing: '-.03em' }}>
                {rows.length}
              </div>
            </Panel>
          </div>
        </Rise>

        <Rise delay={100}>
          <div className="relative mb-5">
            <Search
              className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
              strokeWidth={2.2}
              style={{ color: 'var(--p-text-2)' }}
            />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search connections…"
              aria-label="Search connections"
              className="w-full rounded-xl pl-10 pr-4 py-3 text-[13.5px] font-semibold outline-none"
              style={{
                background: 'var(--p-card)',
                border: '1px solid var(--p-line)',
                color: 'var(--p-text)',
                boxShadow: 'var(--p-elev)',
              }}
            />
          </div>
        </Rise>

        {grouped.length === 0 ? (
          <Panel className="px-5 py-8 text-center">
            <p className="m-0 text-[13.5px] font-bold" style={{ color: 'var(--p-text)' }}>
              No connection matches “{query}”
            </p>
            <p className="m-0 mt-1.5 text-[12.5px] font-medium" style={{ color: 'var(--p-text-2)' }}>
              Try a source name like Stripe, or a category like Revenue.
            </p>
          </Panel>
        ) : (
          <div className="flex flex-col gap-6">
            {grouped.map(([category, items], gi) => (
              <Rise key={category} delay={140 + gi * 40}>
                <div className="mb-2.5">
                  <Eyebrow>{category}</Eyebrow>
                </div>
                <div className="flex flex-col gap-2.5">
                  {items.map((c) => (
                    <ConnectorRow key={c.type} connector={c} onToggle={toggle} />
                  ))}
                </div>
              </Rise>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
