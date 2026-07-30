import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'wouter';
import {
  ArrowLeft, Fingerprint, Upload, Sparkles, Check, TrendingUp, TrendingDown, Minus,
  CalendarDays, Loader2, AlertCircle,
} from 'lucide-react';
import {
  useDossier, useCreateDossier, useSaveDossierAnswers, useMonthlyWrap, useUploadAttachment,
  type Dossier, type DossierQuestion, type MonthlyWrap, type WrapStat,
} from '../lib/venusApi';
import { VenusThemeToggle } from './VenusThemeToggle';
import { useVenusTheme } from '../lib/venusTheme';
import { Reveal, RevealGroup, RevealItem, Spotlight } from '../lib/motion';

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
          // Every extension here is one routes/attachments.ts accepts by
          // extension and maps to a canonical mime — this list and that map
          // are the same contract written twice, and the previous version of
          // this list advertised .md/.json which the server rejected.
          accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.md,.markdown,.json"
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
            {/* ve-fill grows it from zero on mount; the width transition then
                handles the case where answering a question moves it while the
                founder is looking at it. */}
            <div
              className="h-full rounded-full ve-fill transition-[width] duration-700"
              style={{
                width: `${dossier.completeness}%`,
                background: 'var(--v7-cyan-strong, #5b4fe8)',
                transitionTimingFunction: 'cubic-bezier(0.16,1,0.3,1)',
              }}
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

      <Reveal delay={0.05}>
        <GapQuestions dossier={dossier} />
      </Reveal>
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

/* ---- The wrap as a bento -------------------------------------------------
 *
 * Built to match the monthly review on the landing page (see
 * pages/landing/Sections.tsx `ReviewSection`), because that layout is the one
 * a founder has already been shown and told to expect — an entirely different
 * treatment for the same object on the inside of the product reads as two
 * different features.
 *
 * ONE IMPORTANT DIFFERENCE, and it is the whole reason this isn't a copy of
 * that component: the landing page's six cards are fixed marketing copy, so
 * its grid can be designed around always having exactly six. This one renders
 * whatever the month actually produced. A founder with two stats and no
 * lessons must get a grid that looks deliberate at two tiles, not a 3-up grid
 * with four holes in it — so tiles are collected into a list first and the
 * column count is chosen from how many there are, rather than fixed.
 */

// A tile in the bento. `span` is honoured only when there is room for it.
interface Tile {
  key: string;
  label: string;
  value: React.ReactNode;
  note?: React.ReactNode;
  wide?: boolean;
}

function BentoTile({ tile }: { tile: Tile }) {
  return (
    <Spotlight
      className="ve-tile rounded-2xl p-5 h-full flex flex-col"
      style={{
        background: 'var(--v7-bg-raised)',
        border: '1px solid var(--v7-border)',
        minHeight: tile.wide ? 0 : 148,
      }}
    >
      <div
        className="text-[10.5px] uppercase mb-3"
        style={{ letterSpacing: '0.14em', color: 'var(--v7-text-mute)', fontFamily: 'var(--v7-font-mono)' }}
      >
        {tile.label}
      </div>
      <div className="text-[19px] font-bold leading-[1.22] tracking-[-0.02em]">{tile.value}</div>
      {tile.note && (
        <div className="mt-auto pt-3.5 text-[13px] leading-[1.5]" style={{ color: 'var(--v7-text-mute)' }}>
          {tile.note}
        </div>
      )}
    </Spotlight>
  );
}

function WrapView({ wrap, companyName }: { wrap: MonthlyWrap; companyName: string | null }) {
  if (!wrap.hasSignal) {
    return (
      <Panel className="p-8 text-center">
        <h2 className="text-[16px] font-bold mb-2">{wrap.monthLabel} was quiet</h2>
        <p className="text-[13px] leading-relaxed max-w-md mx-auto" style={{ color: 'var(--v7-text-mute)' }}>
          There isn't enough in {wrap.monthLabel} to tell you anything real about it yet.
          Ask Vera a few things this month and this fills itself in — no invented highlights.
        </p>
      </Panel>
    );
  }

  // Everything the month actually produced, in the order it should be read.
  const tiles: Tile[] = [];

  if (wrap.narrative?.oneThingToChange) {
    tiles.push({
      key: 'change',
      label: 'One thing to change',
      value: wrap.narrative.oneThingToChange,
    });
  }

  for (const stat of wrap.stats) {
    tiles.push({
      key: `stat-${stat.key}`,
      label: stat.label,
      value: <span className="text-[30px] font-extrabold leading-none">{stat.value}</span>,
      note: <TrendChip stat={stat} />,
    });
  }

  if (wrap.topics.length > 0) {
    tiles.push({
      key: 'topics',
      label: 'What you spent it on',
      value: wrap.topics[0].topic.replace(/_/g, ' '),
      note: (
        <div className="space-y-1.5">
          {wrap.topics.slice(0, 4).map((t) => {
            const max = wrap.topics[0].count || 1;
            return (
              <div key={t.topic} className="flex items-center gap-2">
                <span className="text-[11.5px] w-[92px] shrink-0 truncate">{t.topic.replace(/_/g, ' ')}</span>
                <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--v7-border)' }}>
                  <div
                    className="h-full rounded-full ve-fill"
                    style={{ width: `${(t.count / max) * 100}%`, background: 'var(--v7-cyan)' }}
                  />
                </div>
                <span className="text-[11px] w-4 text-right shrink-0">{t.count}</span>
              </div>
            );
          })}
        </div>
      ),
    });
  }

  if (wrap.goalsClosed.length > 0) {
    tiles.push({
      key: 'goals',
      label: 'Goals you closed',
      value: `${wrap.goalsClosed.length} closed`,
      note: (
        <div className="space-y-1">
          {wrap.goalsClosed.slice(0, 3).map((g, i) => (
            <div key={i} className="flex items-center gap-2">
              <Check className="w-3 h-3 shrink-0" style={{ color: g.status === 'completed' ? 'var(--v7-cyan)' : 'var(--v7-text-mute)' }} />
              <span className="truncate text-[12px]">{g.title}</span>
            </div>
          ))}
        </div>
      ),
    });
  }

  if (wrap.busiestDay) {
    tiles.push({
      key: 'busiest',
      label: 'Busiest day',
      value: wrap.busiestDay.date,
      note: `${wrap.busiestDay.count} question${wrap.busiestDay.count === 1 ? '' : 's'} in one day.`,
    });
  }

  if (wrap.lessons.length > 0) {
    tiles.push({
      key: 'lessons',
      label: 'What you learned',
      value: wrap.lessons[0],
      note:
        wrap.lessons.length > 1 ? (
          <ul className="space-y-1.5">
            {wrap.lessons.slice(1, 4).map((lesson, i) => (
              <li key={i} className="flex gap-2 leading-relaxed">
                <span className="shrink-0 mt-[7px] rounded-full" style={{ width: '4px', height: '4px', background: 'var(--v7-cyan)' }} />
                <span>{lesson}</span>
              </li>
            ))}
          </ul>
        ) : undefined,
      wide: true,
    });
  }

  // The closing line, always last and always full width — it is the sentence
  // the founder is most likely to actually remember.
  if (wrap.narrative) {
    tiles.push({
      key: 'oneline',
      label: 'The month in one line',
      value: wrap.narrative.headline,
      note: wrap.narrative.story,
      wide: true,
    });
  }

  // Two columns on desktop rather than the landing page's three: this page is
  // read, not scanned, and its tiles carry real sentences rather than five-word
  // marketing lines — three columns puts those sentences in ~180px of width and
  // they wrap to six lines each. A lone tile gets the full width instead of
  // sitting next to a hole.
  const columns = tiles.length === 1 ? 1 : 2;

  return (
    <div
      className="rounded-[22px] p-6 sm:p-8 relative overflow-hidden"
      style={{
        border: '1px solid var(--v7-border)',
        background:
          'radial-gradient(760px 420px at 88% 4%, var(--v7-glow-2), transparent 62%),' +
          'radial-gradient(680px 420px at 4% 96%, var(--v7-glow-1), transparent 62%),' +
          'var(--v7-bg-raised-2)',
      }}
    >
      <div className="flex items-end justify-between gap-5 flex-wrap mb-7">
        <div className="min-w-0">
          <div
            className="text-[11px] uppercase truncate"
            style={{ letterSpacing: '0.16em', color: 'var(--v7-cyan)', fontFamily: 'var(--v7-font-mono)' }}
          >
            {companyName ?? 'Your company'}
          </div>
          <h2 className="text-[26px] font-extrabold tracking-[-0.03em] mt-2 leading-none">
            {wrap.monthLabel} review
          </h2>
        </div>
        <div
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-[12px] shrink-0"
          style={{ border: '1px solid var(--v7-border)', background: 'var(--v7-bg-raised)', color: 'var(--v7-text-dim)' }}
        >
          <span className="rounded-full ve-pulse" style={{ width: '6px', height: '6px', background: 'var(--v7-cyan)' }} />
          Assembled from your real activity
        </div>
      </div>

      {/* Column count is expressed as classes rather than an inline
          gridTemplateColumns so it can still collapse to one column on a
          phone — an inline style has no media query to fall back to, which
          would have left the two-up grid squeezed onto a 360px screen. */}
      <RevealGroup className={`grid gap-3.5 ${columns === 2 ? 'sm:grid-cols-2' : 'grid-cols-1'}`} stagger={0.06}>
        {tiles.map((tile) => (
          <RevealItem
            key={tile.key}
            // Spans only at the width where a second column actually exists.
            // `col-span-2` in a single-track grid creates a phantom column and
            // drags every following tile out of alignment.
            className={tile.wide && columns === 2 ? 'sm:col-span-2' : undefined}
          >
            <BentoTile tile={tile} />
          </RevealItem>
        ))}
      </RevealGroup>
    </div>
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

// "2026-07" is the wire format, not something to show a founder. The year is
// only added when it differs from the current one, so the common case (this
// year's months) stays short.
function periodLabel(period: string): string {
  const [year, month] = period.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, 1));
  const name = date.toLocaleString(undefined, { month: 'short', timeZone: 'UTC' });
  return year === new Date().getUTCFullYear() ? name : `${name} ${String(year).slice(2)}`;
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
    // `background` is not optional here even though the tokens below are
    // scoped by .v7-light: without it the page inherits <body>'s dark
    // background and light mode renders white cards on black — which is
    // exactly what this looked like. GoalsOverview and DecisionsOverview
    // already set it; this route and Workflows were the two that didn't.
    <div className={`relative min-h-screen w-full ${theme === 'light' ? 'v7-light' : ''}`} style={{ background: 'var(--v7-bg)', color: 'var(--v7-text)', fontFamily: 'var(--v7-font-round)' }}>
      {/* The wrap is a bento grid and needs room to be one; the company file
          is a reading column and gets worse as it widens. One container that
          changes width with the tab, rather than splitting the page in two. */}
      <div
        className={`relative mx-auto px-6 py-8 transition-[max-width] duration-500 ${tab === 'wrap' ? 'max-w-4xl' : 'max-w-2xl'}`}
        style={{ zIndex: 1, transitionTimingFunction: 'cubic-bezier(0.16,1,0.3,1)' }}
      >
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

        {/* Fingerprint, not a document icon. The page is not "a file you
            stored" — it is the one description of THIS company that every
            answer is reasoned from, and a page-with-a-folded-corner says
            neither of those things. */}
        <div className="flex items-center gap-2.5 mb-1">
          <Fingerprint className="w-[22px] h-[22px] ve-dossier-mark" style={{ color: 'var(--v7-cyan)' }} />
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
                  {periodLabel(p)}
                </button>
              ))}
            </div>

            {wrapQuery.isLoading && <div className="text-[13px]" style={{ color: 'var(--v7-text-mute)' }}>Building your month…</div>}
            {wrapQuery.isError && (
              <Panel className="p-4 text-[13px]" style={{ color: 'var(--red, #e5555c)' }}>
                {wrapQuery.error instanceof Error ? wrapQuery.error.message : 'Failed to build your monthly wrap'}
              </Panel>
            )}
            {wrapQuery.data && (
              // Keyed by period so switching month replays the tile stagger —
              // without it React reconciles the new month into the old grid and
              // the numbers change with no indication anything happened.
              <WrapView key={period} wrap={wrapQuery.data.wrap} companyName={dossier?.companyName ?? null} />
            )}
          </>
        )}
      </div>
    </div>
  );
}
