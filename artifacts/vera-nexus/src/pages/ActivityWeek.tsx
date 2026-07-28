import type { CSSProperties } from 'react';
import type { UsageDay } from '../lib/venusApi';

// The board's counters answer "how much, ever". None of them answer the
// question a founder actually asks of a habit surface — "am I keeping this
// up?" — because a running total looks identical whether it was earned
// steadily or all in one burst three weeks ago. Seven columns answer that
// without a word of copy.
//
// Two quantities per day, stacked rather than shown as separate charts:
//
//   actions  — queue items accepted or edited. The thing the streak counts,
//              so it gets the accent and sits on the baseline where it can
//              be compared column to column.
//   touches  — everything else Vera logged that day (messages, decisions,
//              facts recorded). Real activity, but not the same commitment,
//              so it rides on top in a subordinate tone.
//
// Columns are scaled against the busiest day in the window, not an absolute
// ceiling: this is a shape, not a measurement against a target, and a fixed
// scale would flatten every ordinary week into nothing.

const WEEKDAY_SHORT = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

type Tone = {
  /** Days that were acted on. */
  accent: string;
  /** Days that saw activity but nothing actioned. */
  quiet: string;
  /** The empty column behind the fill. */
  well: string;
};

function longDate(iso: string): string {
  // The date is a UTC calendar key (see the server's dayKey), so it must be
  // read back as UTC — parsing it as local time shifts every label a day
  // west of Greenwich.
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC',
  });
}

function dayTitle(d: UsageDay): string {
  const total = d.touches + d.actions;
  if (total === 0) return `${longDate(d.date)} — nothing logged`;
  const parts: string[] = [];
  if (d.actions > 0) parts.push(`${d.actions} ${d.actions === 1 ? 'item actioned' : 'items actioned'}`);
  if (d.touches > 0) parts.push(`${d.touches} ${d.touches === 1 ? 'other entry' : 'other entries'}`);
  return `${longDate(d.date)} — ${parts.join(', ')}`;
}

export function ActivityWeek({ days, tone, flush }: {
  days: UsageDay[];
  tone?: Tone;
  /** Drop the strip's own gutter when the container already provides one. */
  flush?: boolean;
}) {
  if (days.length === 0) return null;

  const totals = days.map((d) => d.touches + d.actions);
  const peak = Math.max(...totals);
  const todayKey = new Date().toISOString().slice(0, 10);
  const logged = totals.reduce((sum, t) => sum + t, 0);

  // Classic has no skin variables to inherit from, so it hands its notebook
  // palette in through the same three custom properties the skins set in
  // CSS. One implementation, two colour sources.
  const vars = tone
    ? ({ '--vera-week-accent': tone.accent, '--vera-week-quiet': tone.quiet, '--vera-week-well': tone.well } as CSSProperties)
    : undefined;

  return (
    <div
      className={`vera-week${flush ? ' vera-week-flush' : ''}`}
      style={vars}
      role="img"
      aria-label={
        logged === 0
          ? 'No activity logged in the last seven days'
          : `Activity for the last seven days: ${days.map((d) => `${longDate(d.date)}, ${d.actions} actioned, ${d.touches} other`).join('; ')}`
      }
    >
      <div className="vera-week-plot" aria-hidden="true">
        {days.map((d) => {
          const total = d.touches + d.actions;
          const isToday = d.date === todayKey;
          return (
            <div key={d.date} className={`vera-week-col${isToday ? ' is-today' : ''}`} title={dayTitle(d)}>
              <div className="vera-week-well">
                {total === 0 ? (
                  <span className="vera-week-nil" />
                ) : (
                  <div className="vera-week-stack" style={{ height: `${Math.max(8, Math.round((total / peak) * 100))}%` }}>
                    {d.touches > 0 && <span className="vera-week-seg vera-week-seg-quiet" style={{ flexGrow: d.touches }} />}
                    {d.actions > 0 && <span className="vera-week-seg vera-week-seg-act" style={{ flexGrow: d.actions }} />}
                  </div>
                )}
              </div>
              <span className="vera-week-day">{WEEKDAY_SHORT[d.weekday]}</span>
            </div>
          );
        })}
      </div>

      <div className="vera-week-legend">
        {logged === 0 ? (
          <span className="vera-week-note">Nothing logged this week yet.</span>
        ) : (
          <>
            <span className="vera-week-key"><i className="vera-week-swatch vera-week-seg-act" />Actioned</span>
            <span className="vera-week-key"><i className="vera-week-swatch vera-week-seg-quiet" />Logged</span>
          </>
        )}
      </div>
    </div>
  );
}
