import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'wouter';
import {
  ArrowLeft, FileText, Upload, Sparkles, Check, TrendingUp, TrendingDown, Minus,
  CalendarDays, Loader2, AlertCircle,
} from 'lucide-react';
import {
  useDossier, useCreateDossier, useSaveDossierAnswers, useMonthlyWrap, useUploadAttachment,
  type Dossier, type DossierQuestion, type MonthlyWrap, type WrapStat,
} from '../lib/venusApi';
import { VenusThemeToggle } from './VenusThemeToggle';
import { useVenusTheme } from '../lib/venusTheme';

// ---- The Dossier page ----
//
// Two things live here, and they are the same thing at two timescales: what
// Vera knows about your company (built once, kept current), and what your
// company actually did last month (rebuilt every month from real activity).
//
// The design rule throughout: never show a number or a claim we don't have.
// An empty file says it is empty. A quiet month says it was quiet. This page
// is the most tempting place in the product to manufacture a sense of
// progress, and doing so once would cost more trust than the page can ever
// earn back.

type Tab = 'file' | 'wrap';

function Panel({ children, className = '', style }: { children: React.ReactNode; className?: string; style?: React.CSSProperties }) {
  return (
    <div
      className={`rounded-2xl ${className}`}
      style={{
        background: 'var(--v7-bg-raised, rgba(255,255,255,0.03))',
        border: '1px solid var(--v7-border, rgba(255,255,255,0.10))',
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/* -------------------------------------------------------------------------
 * Intake — the one-time paste/upload
 * ---------------------------------------------------------------------- */

function Intake({ onDone }: { onDone: () => void }) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const createDossier = useCreateDossier();
  const uploadAttachment = useUploadAttachment();
  const busy = createDossier.isPending || uploadAttachment.isPending;

  const submitText = () => {
    setError(null);
    createDossier.mutate(
      { sourceText: text },
      { onSuccess: onDone, onError: (e) => setError(e instanceof Error ? e.message : 'Something went wrong') },
    );
  };

  const submitFile = (file: File) => {
    setError(null);
    uploadAttachment.mutate(
      { file },
      {
        onSuccess: (attachment) =>
          createDossier.mutate(
            { attachmentId: attachment.id },
            { onSuccess: onDone, onError: (e) => setError(e instanceof Error ? e.message : 'Something went wrong') },
          ),
        onError: (e) => setError(e instanceof Error ? e.message : 'Upload failed'),
      },
    );
  };

  return (
    <Panel className="p-6">
      <div className="flex items-center gap-2 mb-1.5">
        <Sparkles className="w-4 h-4" style={{ color: 'var(--v7-cyan)' }} />
        <h2 className="text-[15px] font-bold">Build your company file</h2>
      </div>
      <p className="text-[13px] mb-4 leading-relaxed" style={{ color: 'var(--v7-text-mute)' }}>
        Paste anything that describes the business — your deck, a one-pager, your
        about page, a P&amp;L export, or just write it out. Vera reads it, builds a
        structured file, then asks you only about what it couldn't find.
      </p>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Paste here…"
        rows={9}
        disabled={busy}
        className="w-full rounded-xl p-3.5 text-[13px] leading-relaxed resize-y outline-none"
        style={{
          background: 'var(--v7-bg, rgba(0,0,0,0.25))',
          border: '1px solid var(--v7-border, rgba(255,255,255,0.12))',
          color: 'var(--v7-text)',
          minHeight: '180px',
        }}
      />

      {error && (
        <div className="flex items-start gap-2 mt-3 text-[12.5px]" style={{ color: 'var(--red, #e5555c)' }}>
          <AlertCircle className="w-4 h-4 shrink-0 mt-px" />
          <span>{error}</span>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2.5 mt-4">
        <button
          onClick={submitText}
          disabled={busy || text.trim().length < 40}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-[13px] font-semibold disabled:opacity-40"
          style={{ background: 'var(--v7-cyan-strong, #5b4fe8)', color: '#fff' }}
        >
          {createDossier.isPending && !uploadAttachment.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
          {busy ? 'Reading…' : 'Build my file'}
        </button>

        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={busy}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-[13px] font-medium disabled:opacity-40"
          style={{ border: '1px solid var(--v7-border, rgba(255,255,255,0.14))', color: 'var(--v7-text-dim)' }}
        >
          <Upload className="w-3.5 h-3.5" />
          Upload a document
        </button>
        <input
          ref={fileInputRef}
          type="file"
          hidden
          accept=".pdf,.docx,.xlsx,.csv,.txt,.md,.json"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) submitFile(file);
            e.target.value = '';
          }}
        />
      </div>

      {/* Said up front, not discovered after a failed upload. A founder who
          uploads a scanned contract and gets a vague error assumes the
          product is broken; one who was told the limit first just sends the
          digital copy. */}
      <p className="text-[11.5px] mt-3" style={{ color: 'var(--v7-text-mute)' }}>
        PDF, Word, Excel, CSV or text. Scanned or photographed documents have no
        text to read — send a digital version or paste the text.
      </p>
      {text.trim().length > 0 && text.trim().length < 40 && (
        <p className="text-[11.5px] mt-1.5" style={{ color: 'var(--v7-text-mute)' }}>
          A little more to go on, and this gets much better.
        </p>
      )}
    </Panel>
  );
}

/* -------------------------------------------------------------------------
 * The gap questions — the part that makes this feel like a consultant
 * ---------------------------------------------------------------------- */

function GapQuestions({ dossier }: { dossier: Dossier }) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const saveAnswers = useSaveDossierAnswers();

  const outstanding = useMemo(
    () => dossier.questions.filter((q) => !(dossier.answers[q.id] ?? '').trim()),
    [dossier.questions, dossier.answers],
  );

  if (dossier.questions.length === 0) return null;

  const answeredCount = dossier.questions.length - outstanding.length;

  const saveOne = (q: DossierQuestion) => {
    const value = (drafts[q.id] ?? '').trim();
    if (!value) return;
    saveAnswers.mutate(
      { dossierId: dossier.id, answers: { [q.id]: value } },
      {
        onSuccess: () => {
          setSavedIds((prev) => new Set(prev).add(q.id));
          setDrafts((prev) => ({ ...prev, [q.id]: '' }));
        },
      },
    );
  };

  const saveAll = () => {
    const answers: Record<string, string> = {};
    for (const [id, value] of Object.entries(drafts)) {
      if (value.trim()) answers[id] = value.trim();
    }
    if (Object.keys(answers).length === 0) return;
    saveAnswers.mutate({ dossierId: dossier.id, answers }, { onSuccess: () => setDrafts({}) });
  };

  return (
    <Panel className="p-6 mt-4">
      <div className="flex items-baseline justify-between mb-1.5 gap-3">
        <h2 className="text-[15px] font-bold">What Vera still needs to ask you</h2>
        <span className="text-[11.5px] shrink-0" style={{ color: 'var(--v7-text-mute)' }}>
          {answeredCount}/{dossier.questions.length} answered
        </span>
      </div>
      <p className="text-[13px] mb-5 leading-relaxed" style={{ color: 'var(--v7-text-mute)' }}>
        These come from what your material didn't cover. Answer what you can — every
        one you fill in changes the advice you get. You can leave the rest.
      </p>

      <div className="space-y-4">
        {dossier.questions.map((q) => {
          const existing = (dossier.answers[q.id] ?? '').trim();
          const justSaved = savedIds.has(q.id);
          return (
            <div key={q.id}>
              <div className="flex items-start gap-2">
                {existing ? (
                  <Check className="w-3.5 h-3.5 shrink-0 mt-1" style={{ color: 'var(--v7-cyan)' }} />
                ) : (
                  <span
                    className="shrink-0 mt-1.5 rounded-full"
                    style={{ width: '5px', height: '5px', background: 'var(--v7-text-mute)' }}
                  />
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-[13.5px] font-medium leading-snug">{q.question}</p>
                  {q.why && (
                    <p className="text-[11.5px] mt-1 leading-relaxed" style={{ color: 'var(--v7-text-mute)' }}>
                      {q.why}
                    </p>
                  )}
                  {existing ? (
                    <p className="text-[13px] mt-1.5" style={{ color: 'var(--v7-text-dim)' }}>
                      {existing}
                    </p>
                  ) : (
                    <div className="flex items-center gap-2 mt-2">
                      <input
                        value={drafts[q.id] ?? ''}
                        onChange={(e) => setDrafts((prev) => ({ ...prev, [q.id]: e.target.value }))}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            saveOne(q);
                          }
                        }}
                        placeholder="Your answer…"
                        className="flex-1 min-w-0 rounded-lg px-3 py-2 text-[13px] outline-none"
                        style={{
                          background: 'var(--v7-bg, rgba(0,0,0,0.25))',
                          border: '1px solid var(--v7-border, rgba(255,255,255,0.12))',
                          color: 'var(--v7-text)',
                        }}
                      />
                      <button
                        onClick={() => saveOne(q)}
                        disabled={!(drafts[q.id] ?? '').trim() || saveAnswers.isPending}
                        className="shrink-0 px-3 py-2 rounded-lg text-[12px] font-semibold disabled:opacity-30"
                        style={{ border: '1px solid var(--v7-border, rgba(255,255,255,0.14))', color: 'var(--v7-text-dim)' }}
                      >
                        {justSaved ? 'Saved' : 'Save'}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {Object.values(drafts).some((v) => v.trim()) && (
        <button
          onClick={saveAll}
          disabled={saveAnswers.isPending}
          className="inline-flex items-center gap-2 mt-5 px-4 py-2.5 rounded-xl text-[13px] font-semibold disabled:opacity-40"
          style={{ background: 'var(--v7-cyan-strong, #5b4fe8)', color: '#fff' }}
        >
          {saveAnswers.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
          Save all answers
        </button>
      )}
    </Panel>
  );
}

/* -------------------------------------------------------------------------
 * The file itself
 * ---------------------------------------------------------------------- */

function CompanyFile({ dossier, onRebuild }: { dossier: Dossier; onRebuild: () => void }) {
  const known = dossier.fields.filter((f) => f.value);
  const unknown = dossier.fields.filter((f) => !f.value);

  return (
    <>
      <Panel className="p-6">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div className="min-w-0">
            <h2 className="text-[17px] font-extrabold leading-tight truncate">
              {dossier.companyName ?? 'Your company'}
            </h2>
            {dossier.oneLine && (
              <p className="text-[13px] mt-1 leading-relaxed" style={{ color: 'var(--v7-text-dim)' }}>
                {dossier.oneLine}
              </p>
            )}
          </div>
          <button
            onClick={onRebuild}
            className="shrink-0 px-3 py-1.5 rounded-lg text-[12px] font-medium"
            style={{ border: '1px solid var(--v7-border, rgba(255,255,255,0.14))', color: 'var(--v7-text-mute)' }}
          >
            Rebuild
          </button>
        </div>

        {/* Completeness is the honest headline for this page: it tells a
            founder at a glance how much of their advice is currently being
            given with gaps in it. */}
        <div className="mb-5">
          <div className="flex items-center justify-between text-[11.5px] mb-1.5" style={{ color: 'var(--v7-text-mute)' }}>
            <span>File completeness</span>
            <span>{dossier.completeness}%</span>
          </div>
          <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--v7-border, rgba(255,255,255,0.10))' }}>
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{ width: `${dossier.completeness}%`, background: 'var(--v7-cyan-strong, #5b4fe8)' }}
            />
          </div>
        </div>

        <div className="space-y-3">
          {known.map((f) => (
            <div key={f.key} className="flex flex-col sm:flex-row sm:gap-4">
              <span className="text-[11.5px] uppercase tracking-wider shrink-0 sm:w-[190px] pt-px" style={{ color: 'var(--v7-text-mute)', fontFamily: 'var(--v7-font-mono)' }}>
                {f.label}
              </span>
              <span className="text-[13.5px] leading-relaxed flex-1">{f.value}</span>
            </div>
          ))}
        </div>

        {unknown.length > 0 && (
          <div className="mt-6 pt-5" style={{ borderTop: '1px solid var(--v7-border, rgba(255,255,255,0.08))' }}>
            <p className="text-[11.5px] uppercase tracking-wider mb-2" style={{ color: 'var(--v7-text-mute)', fontFamily: 'var(--v7-font-mono)' }}>
              Not known yet
            </p>
            {/* Named explicitly rather than hidden. A founder should be able
                to see exactly where Vera is reasoning with a gap — that is
                the difference between a file and a marketing page. */}
            <p className="text-[13px] leading-relaxed" style={{ color: 'var(--v7-text-dim)' }}>
              {unknown.map((f) => f.label).join(' · ')}
            </p>
          </div>
        )}

        {dossier.sourceLabel && (
          <p className="text-[11px] mt-5" style={{ color: 'var(--v7-text-mute)' }}>
            Source: {dossier.sourceLabel}
          </p>
        )}
      </Panel>

      <GapQuestions dossier={dossier} />
    </>
  );
}

/* -------------------------------------------------------------------------
 * The monthly wrap
 * ---------------------------------------------------------------------- */

function TrendChip({ stat }: { stat: WrapStat }) {
  if (stat.changePct == null) {
    return (
      <span className="text-[11px]" style={{ color: 'var(--v7-text-mute)' }}>
        {stat.previousValue == null ? 'first month' : 'no change to compare'}
      </span>
    );
  }
  const up = stat.changePct > 0;
  const flat = stat.changePct === 0;
  const Icon = flat ? Minus : up ? TrendingUp : TrendingDown;
  // Deliberately NOT colour-coded good/bad. "Questions asked: down 40%" is
  // not a failure and "decisions logged: up 300%" is not a win — only the
  // founder knows which. Colouring them would be Vera pretending to a
  // judgment it hasn't made.
  return (
    <span className="inline-flex items-center gap-1 text-[11px]" style={{ color: 'var(--v7-text-mute)' }}>
      <Icon className="w-3 h-3" />
      {flat ? 'flat' : `${up ? '+' : ''}${stat.changePct}% vs last month`}
    </span>
  );
}

function WrapView({ wrap }: { wrap: MonthlyWrap }) {
  if (!wrap.hasSignal) {
    return (
      <Panel className="p-6">
        <h2 className="text-[15px] font-bold mb-1.5">{wrap.monthLabel} was quiet</h2>
        <p className="text-[13px] leading-relaxed" style={{ color: 'var(--v7-text-mute)' }}>
          There isn't enough in {wrap.monthLabel} to tell you anything real about it yet.
          Ask Vera a few things this month and this fills itself in — no invented highlights.
        </p>
      </Panel>
    );
  }

  return (
    <>
      {wrap.narrative && (
        <Panel className="p-6" style={{ borderColor: 'var(--v7-cyan-strong, #5b4fe8)' }}>
          <p className="text-[11.5px] uppercase tracking-wider mb-2" style={{ color: 'var(--v7-cyan)', fontFamily: 'var(--v7-font-mono)' }}>
            {wrap.monthLabel}
          </p>
          <h2 className="text-[20px] font-extrabold leading-tight mb-2.5">{wrap.narrative.headline}</h2>
          <p className="text-[13.5px] leading-relaxed mb-4">{wrap.narrative.story}</p>
          {wrap.narrative.oneThingToChange && (
            <div className="rounded-xl p-3.5" style={{ background: 'var(--v7-bg, rgba(0,0,0,0.22))' }}>
              <p className="text-[11.5px] uppercase tracking-wider mb-1" style={{ color: 'var(--v7-text-mute)', fontFamily: 'var(--v7-font-mono)' }}>
                One thing to change
              </p>
              <p className="text-[13.5px] leading-relaxed">{wrap.narrative.oneThingToChange}</p>
            </div>
          )}
        </Panel>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4">
        {wrap.stats.map((stat) => (
          <Panel key={stat.key} className="p-4">
            <div className="text-[26px] font-extrabold leading-none mb-1.5">{stat.value}</div>
            <div className="text-[12.5px] mb-1.5 leading-snug" style={{ color: 'var(--v7-text-dim)' }}>
              {stat.label}
            </div>
            <TrendChip stat={stat} />
          </Panel>
        ))}
      </div>

      {wrap.topics.length > 0 && (
        <Panel className="p-6 mt-4">
          <h3 className="text-[14px] font-bold mb-3">What you spent the month on</h3>
          <div className="space-y-2">
            {wrap.topics.map((t) => {
              const max = wrap.topics[0].count || 1;
              return (
                <div key={t.topic} className="flex items-center gap-3">
                  <span className="text-[12.5px] w-[130px] shrink-0 truncate" style={{ color: 'var(--v7-text-dim)' }}>
                    {t.topic.replace(/_/g, ' ')}
                  </span>
                  <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: 'var(--v7-border, rgba(255,255,255,0.08))' }}>
                    <div className="h-full rounded-full" style={{ width: `${(t.count / max) * 100}%`, background: 'var(--v7-cyan-strong, #5b4fe8)' }} />
                  </div>
                  <span className="text-[11.5px] w-5 text-right shrink-0" style={{ color: 'var(--v7-text-mute)' }}>
                    {t.count}
                  </span>
                </div>
              );
            })}
          </div>
        </Panel>
      )}

      {wrap.lessons.length > 0 && (
        <Panel className="p-6 mt-4">
          <h3 className="text-[14px] font-bold mb-3">What you learned</h3>
          <ul className="space-y-2">
            {wrap.lessons.map((lesson, i) => (
              <li key={i} className="text-[13px] leading-relaxed flex gap-2.5">
                <span className="shrink-0 mt-1.5 rounded-full" style={{ width: '5px', height: '5px', background: 'var(--v7-cyan)' }} />
                <span>{lesson}</span>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {wrap.goalsClosed.length > 0 && (
        <Panel className="p-6 mt-4">
          <h3 className="text-[14px] font-bold mb-3">Goals you closed</h3>
          <ul className="space-y-2">
            {wrap.goalsClosed.map((g, i) => (
              <li key={i} className="text-[13px] flex items-center justify-between gap-3">
                <span className="truncate">{g.title}</span>
                <span
                  className="shrink-0 text-[11px] uppercase tracking-wider px-2 py-0.5 rounded-full"
                  style={{
                    fontFamily: 'var(--v7-font-mono)',
                    color: g.status === 'completed' ? 'var(--v7-cyan)' : 'var(--v7-text-mute)',
                    border: `1px solid ${g.status === 'completed' ? 'var(--v7-cyan-strong, #5b4fe8)' : 'var(--v7-border, rgba(255,255,255,0.14))'}`,
                  }}
                >
                  {g.status}
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {wrap.busiestDay && (
        <p className="text-[12px] mt-4 text-center" style={{ color: 'var(--v7-text-mute)' }}>
          Busiest day: {wrap.busiestDay.date} — {wrap.busiestDay.count} questions.
        </p>
      )}
    </>
  );
}

/* -------------------------------------------------------------------------
 * Page
 * ---------------------------------------------------------------------- */

// Last 6 months, newest first. Bounded because a wrap for a month before the
// founder signed up is a page of honest zeroes nobody wants to click into.
function recentPeriods(count = 6): string[] {
  const out: string[] = [];
  const d = new Date();
  for (let i = 0; i < count; i++) {
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
    d.setUTCMonth(d.getUTCMonth() - 1);
  }
  return out;
}

export function DossierPage() {
  const [, navigate] = useLocation();
  const { theme, toggle: toggleTheme } = useVenusTheme();
  const [tab, setTab] = useState<Tab>('file');
  const [rebuilding, setRebuilding] = useState(false);
  const periods = useMemo(() => recentPeriods(), []);
  const [period, setPeriod] = useState(periods[0]);

  const { data, isLoading, isError, error } = useDossier();
  const wrapQuery = useMonthlyWrap(period);
  const dossier = data?.dossier ?? null;

  // Deep-link support (/vera/dossier#wrap) so the sidebar and any future
  // "your month is ready" nudge can land straight on the wrap.
  useEffect(() => {
    if (window.location.hash === '#wrap') setTab('wrap');
  }, []);

  return (
    <div className={`relative min-h-screen w-full ${theme === 'light' ? 'v7-light' : ''}`} style={{ color: 'var(--v7-text)', fontFamily: 'var(--v7-font-round)' }}>
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
          <FileText className="w-4 h-4" style={{ color: 'var(--v7-cyan)' }} />
          <h1 className="text-[19px] font-extrabold">Dossier</h1>
        </div>
        <p className="text-[13px] mb-6" style={{ color: 'var(--v7-text-mute)' }}>
          What Vera knows about your company, and what your company actually did.
        </p>

        <div className="flex gap-1 mb-5 p-1 rounded-xl" style={{ background: 'var(--v7-bg-raised, rgba(255,255,255,0.03))', width: 'fit-content' }}>
          {([['file', 'Company file'], ['wrap', 'Monthly wrap']] as [Tab, string][]).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className="px-3.5 py-1.5 rounded-lg text-[12.5px] font-semibold transition-colors"
              style={{
                background: tab === id ? 'var(--v7-cyan-strong, #5b4fe8)' : 'transparent',
                color: tab === id ? '#fff' : 'var(--v7-text-mute)',
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === 'file' && (
          <>
            {isLoading && <div className="text-[13px]" style={{ color: 'var(--v7-text-mute)' }}>Loading…</div>}
            {isError && (
              <Panel className="p-4 text-[13px]" style={{ color: 'var(--red, #e5555c)' }}>
                {error instanceof Error ? error.message : 'Failed to load your company file'}
              </Panel>
            )}
            {!isLoading && !isError && (
              dossier && !rebuilding
                ? <CompanyFile dossier={dossier} onRebuild={() => setRebuilding(true)} />
                : <Intake onDone={() => setRebuilding(false)} />
            )}
          </>
        )}

        {tab === 'wrap' && (
          <>
            <div className="flex items-center gap-2 mb-4 overflow-x-auto pb-1">
              <CalendarDays className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--v7-text-mute)' }} />
              {periods.map((p) => (
                <button
                  key={p}
                  onClick={() => setPeriod(p)}
                  className="shrink-0 px-2.5 py-1 rounded-lg text-[12px] font-medium transition-colors"
                  style={{
                    background: period === p ? 'var(--v7-bg-raised, rgba(255,255,255,0.06))' : 'transparent',
                    color: period === p ? 'var(--v7-text)' : 'var(--v7-text-mute)',
                    border: `1px solid ${period === p ? 'var(--v7-border, rgba(255,255,255,0.14))' : 'transparent'}`,
                  }}
                >
                  {p}
                </button>
              ))}
            </div>

            {wrapQuery.isLoading && <div className="text-[13px]" style={{ color: 'var(--v7-text-mute)' }}>Building your month…</div>}
            {wrapQuery.isError && (
              <Panel className="p-4 text-[13px]" style={{ color: 'var(--red, #e5555c)' }}>
                {wrapQuery.error instanceof Error ? wrapQuery.error.message : 'Failed to build your monthly wrap'}
              </Panel>
            )}
            {wrapQuery.data && <WrapView wrap={wrapQuery.data.wrap} />}
          </>
        )}
      </div>
    </div>
  );
}
