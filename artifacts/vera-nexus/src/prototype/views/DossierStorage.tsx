import { useState } from 'react';
import { ArrowDownRight, ArrowUpRight, Minus, RotateCw } from 'lucide-react';
import { Button, Eyebrow, Label, Meter, MONO, PageHead, Panel, Rise, Segmented } from '../ui';
import { DOSSIER_FIELDS, WRAP_PERIODS, WRAP_STATS, WRAP_TILES, type WrapStat } from '../data';

/* ---------------------------------------------------------------------------
 * Dossier Storage.
 *
 * Information architecture carried over from pages/Dossier.tsx: a `file | wrap`
 * tab pair; the company file leads with a completeness meter, then known
 * label/value rows, then an explicit "not known yet" block; the monthly wrap
 * is a bento of stat tiles with trend chips and prose tiles.
 * ------------------------------------------------------------------------ */

type Tab = 'file' | 'wrap';

// `Segmented` is generic, and JSX's `<Segmented<Tab> />` explicit-type-argument
// syntax parses fine for tsc but is invalid to the Babel parser Vite's react
// plugin uses to transform .tsx (it breaks the dev/build server). Plain
// contextual inference doesn't reliably resolve T from a JSX call site either
// (T came back as `string`, not `Tab`, when tried). A thin non-generic
// wrapper sidesteps both: `Segmented<Tab>(props)` below is an ordinary
// generic function *call*, not a JSX tag, so it's unambiguous to Babel.
function DossierTabSegmented(props: {
  value: Tab;
  onChange: (next: Tab) => void;
  options: { value: Tab; label: string }[];
}) {
  return Segmented<Tab>(props);
}

function periodLabel(period: string): string {
  const [year, month] = period.split('-');
  const names = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const index = Number(month) - 1;
  return `${names[index] ?? month} ${year}`;
}

function TrendChip({ stat }: { stat: WrapStat }) {
  if (stat.changePct == null) {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] font-bold" style={{ fontFamily: MONO, color: 'var(--p-text-2)' }}>
        <Minus className="w-3 h-3" strokeWidth={2.6} />
        FIRST MONTH
      </span>
    );
  }
  const up = stat.changePct > 0;
  const color = stat.good ? 'var(--p-ok)' : 'var(--p-crit)';
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span
      className="inline-flex items-center gap-1 text-[11px] font-bold"
      style={{ fontFamily: MONO, fontVariantNumeric: 'tabular-nums', color }}
    >
      <Icon className="w-3.5 h-3.5" strokeWidth={2.8} />
      {up ? '+' : ''}{stat.changePct}%
      <span style={{ color: 'var(--p-text-2)' }}>from {stat.previous}</span>
    </span>
  );
}

function CompanyFile() {
  const known = DOSSIER_FIELDS.filter((f) => f.value);
  const unknown = DOSSIER_FIELDS.filter((f) => !f.value);
  const completeness = Math.round((known.length / DOSSIER_FIELDS.length) * 100);

  return (
    <div className="flex flex-col gap-3">
      <Rise>
        <Panel className="p-6">
          <div className="flex items-start justify-between gap-4 mb-5">
            <div className="min-w-0">
              <h2 className="m-0 text-[19px] font-bold leading-tight" style={{ color: 'var(--p-text)', letterSpacing: '-.026em' }}>
                Asher Intelligence Ltd
              </h2>
              <p className="m-0 mt-1.5 text-[13.5px] font-medium leading-[1.6] max-w-[62ch]" style={{ color: 'var(--p-text-2)' }}>
                Causal analysis for founders — it traces what is actually driving the numbers, so every decision carries a reason behind it.
              </p>
            </div>
            <Button>
              <RotateCw className="w-3.5 h-3.5" strokeWidth={2.4} />
              Rebuild
            </Button>
          </div>

          <div className="mb-6">
            <div className="flex items-center justify-between mb-2">
              <Label>File completeness</Label>
              <span
                className="text-[12.5px] font-bold"
                style={{ fontFamily: MONO, fontVariantNumeric: 'tabular-nums', color: 'var(--p-text)' }}
              >
                {completeness}%
              </span>
            </div>
            <Meter pct={completeness} />
            <p className="m-0 mt-2 text-[12px] font-semibold" style={{ color: 'var(--p-text-2)' }}>
              {known.length} of {DOSSIER_FIELDS.length} fields known. Asher reasons with the gaps named, never filled in silently.
            </p>
          </div>

          <div className="flex flex-col">
            {known.map((f, i) => (
              <div
                key={f.key}
                className="grid gap-x-5 gap-y-1 sm:grid-cols-[190px_1fr] grid-cols-1 py-3"
                style={{ borderTop: i === 0 ? 'none' : '1px solid var(--p-line)', paddingTop: i === 0 ? 0 : undefined }}
              >
                <div className="pt-[2px]">
                  <Label>{f.label}</Label>
                </div>
                <div className="text-[13.5px] font-semibold leading-[1.6]" style={{ color: 'var(--p-text)' }}>
                  {f.value}
                </div>
              </div>
            ))}
          </div>

          {unknown.length > 0 ? (
            <div className="mt-6 pt-5" style={{ borderTop: '1px solid var(--p-line)' }}>
              <Label>Not known yet</Label>
              <p className="m-0 mt-2 text-[13.5px] font-semibold leading-[1.6]" style={{ color: 'var(--p-text-2)' }}>
                {unknown.map((f) => f.label).join(' · ')}
              </p>
              <p className="m-0 mt-2 text-[12.5px] font-medium leading-[1.55]" style={{ color: 'var(--p-text-2)' }}>
                Named on purpose. A founder should be able to see exactly where Asher is reasoning with a gap — that is the difference between a file and a marketing page.
              </p>
            </div>
          ) : null}

          <p className="m-0 mt-5 text-[11.5px] font-bold" style={{ fontFamily: MONO, letterSpacing: '.05em', color: 'var(--p-text-2)' }}>
            SOURCE: 4 UPLOADED DOCUMENTS · 11 INTAKE ANSWERS · STRIPE
          </p>
        </Panel>
      </Rise>

      <Rise delay={70}>
        <Panel className="p-6">
          <Eyebrow>Fill the gaps</Eyebrow>
          <h3 className="m-0 mt-2 mb-1 text-[15px] font-bold" style={{ color: 'var(--p-text)', letterSpacing: '-.02em' }}>
            Three questions would take this file to 100%
          </h3>
          <p className="m-0 mb-4 text-[13px] font-medium leading-[1.6] max-w-[62ch]" style={{ color: 'var(--p-text-2)' }}>
            Each one changes an answer Asher is already giving you. Answer them in any order.
          </p>
          <div className="flex flex-col gap-2.5">
            {[
              { q: 'How often does your board meet, and what do they see?', why: 'Changes how far ahead roadmap answers are sequenced.' },
              { q: 'What is the lowest price you would sign at today?', why: 'The pricing test recommendation currently assumes you have no floor.' },
              { q: 'When do you count an account as churned?', why: 'Retention numbers in the monthly wrap are computed on a 90-day assumption.' },
            ].map((item) => (
              <div
                key={item.q}
                className="rounded-xl px-4 py-3.5"
                style={{ background: 'var(--p-card-2)', border: '1px solid var(--p-line)' }}
              >
                <div className="text-[13.5px] font-bold leading-[1.45]" style={{ color: 'var(--p-text)' }}>
                  {item.q}
                </div>
                <div className="text-[12.5px] font-medium leading-[1.55] mt-1" style={{ color: 'var(--p-text-2)' }}>
                  {item.why}
                </div>
                <div className="mt-3">
                  <Button variant="primary">Answer</Button>
                </div>
              </div>
            ))}
          </div>
        </Panel>
      </Rise>
    </div>
  );
}

function WrapView() {
  const [period, setPeriod] = useState(WRAP_PERIODS[0]!);

  return (
    <div className="flex flex-col gap-3">
      <Rise>
        <div className="flex items-center gap-2 flex-wrap mb-1">
          <Label>Period</Label>
          <div className="flex gap-1.5 flex-wrap">
            {WRAP_PERIODS.map((p) => {
              const on = p === period;
              return (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPeriod(p)}
                  className="rounded-lg px-2.5 py-1.5 text-[11.5px] font-bold"
                  style={{
                    fontFamily: MONO,
                    letterSpacing: '.04em',
                    color: on ? 'var(--p-on-accent)' : 'var(--p-text-2)',
                    background: on ? 'var(--p-accent)' : 'var(--p-card-2)',
                    border: `1px solid ${on ? 'var(--p-accent)' : 'var(--p-line)'}`,
                  }}
                >
                  {p}
                </button>
              );
            })}
          </div>
        </div>
      </Rise>

      <Rise delay={50}>
        <Panel className="px-6 py-5">
          <Eyebrow>{periodLabel(period)} in review</Eyebrow>
          <h2 className="m-0 mt-2 text-[20px] font-bold leading-[1.25]" style={{ color: 'var(--p-text)', letterSpacing: '-.026em' }}>
            You grew retention and lost efficiency
          </h2>
          <p className="m-0 mt-1.5 text-[13.5px] font-medium leading-[1.6] max-w-[64ch]" style={{ color: 'var(--p-text-2)' }}>
            Four goals were open, two closed. The one that slipped is the one carrying into September, and it is the one you can still control.
          </p>
        </Panel>
      </Rise>

      <Rise delay={90}>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {WRAP_STATS.map((s) => (
            <Panel key={s.label} className="px-4 py-3.5">
              <Label>{s.label}</Label>
              <div
                className="text-[26px] font-bold mt-1.5 mb-2"
                style={{ color: 'var(--p-text)', fontVariantNumeric: 'tabular-nums', letterSpacing: '-.032em' }}
              >
                {s.value}
              </div>
              <TrendChip stat={s} />
            </Panel>
          ))}
        </div>
      </Rise>

      <Rise delay={130}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {WRAP_TILES.map((t) => (
            <Panel
              key={t.label}
              className={`px-5 py-4 ${t.span === 2 ? 'sm:col-span-2' : ''}`}
              style={t.span === 2 ? { background: 'var(--p-accent-tint)', border: '1px solid var(--p-accent-edge)' } : undefined}
            >
              <Label style={t.span === 2 ? { color: 'var(--p-accent-2)' } : undefined}>{t.label}</Label>
              <p
                className={`m-0 mt-2 font-semibold leading-[1.6] ${t.span === 2 ? 'text-[15px]' : 'text-[13.5px]'}`}
                style={{ color: t.span === 2 ? 'var(--p-text)' : 'var(--p-text-2)' }}
              >
                {t.body}
              </p>
            </Panel>
          ))}
        </div>
      </Rise>
    </div>
  );
}

export function DossierStorage() {
  const [tab, setTab] = useState<Tab>('file');

  return (
    <div className="h-full overflow-y-auto vp-scroll">
      <div className="max-w-[880px] mx-auto px-6 py-8">
        <Rise>
          <PageHead
            eyebrow="Dossier Storage"
            title="The file Asher reasons from"
            blurb="Everything Asher knows about your company, and everything it does not. Every answer you get is built on what is written here."
            actions={
              <DossierTabSegmented
                value={tab}
                onChange={setTab}
                options={[
                  { value: 'file', label: 'Company file' },
                  { value: 'wrap', label: 'Monthly wrap' },
                ]}
              />
            }
          />
        </Rise>

        {tab === 'file' ? <CompanyFile /> : <WrapView />}
      </div>
    </div>
  );
}
