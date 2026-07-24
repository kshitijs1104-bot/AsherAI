// Hand-rolled REST calls against the Calendar API v3, same reasoning as
// gmail's gmailApi.ts: only one endpoint is actually needed, so no benefit
// to the full googleapis package.
const CALENDAR_API_BASE = "https://www.googleapis.com/calendar/v3";

async function calendarFetch(accessToken: string, path: string): Promise<any> {
  const res = await fetch(`${CALENDAR_API_BASE}${path}`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Calendar API ${path} failed: ${res.status} ${body}`);
  }
  return res.json();
}

export interface CalendarEvent {
  id: string;
  summary: string;
  start: string;
  end: string;
}

export interface ScheduleConflict {
  eventA: CalendarEvent;
  eventB: CalendarEvent;
}

async function listEventsNext24h(accessToken: string): Promise<CalendarEvent[]> {
  const now = new Date();
  const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const params = new URLSearchParams({
    timeMin: now.toISOString(),
    timeMax: in24h.toISOString(),
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: "50",
  });
  const data = await calendarFetch(accessToken, `/calendars/primary/events?${params.toString()}`);
  return (data.items ?? [])
    .filter((e: any) => e.start?.dateTime && e.end?.dateTime) // skip all-day events — nothing to "overlap" in a meaningful sense
    .map((e: any) => ({ id: e.id, summary: e.summary ?? "(untitled event)", start: e.start.dateTime, end: e.end.dateTime }));
}

// A conflict = two events whose time ranges actually overlap — adjacent
// back-to-back meetings (one ends exactly when the next starts) are normal
// scheduling, not a conflict worth flagging.
export async function listUpcomingConflicts(accessToken: string): Promise<ScheduleConflict[]> {
  const events = await listEventsNext24h(accessToken);
  const conflicts: ScheduleConflict[] = [];

  for (let i = 0; i < events.length; i++) {
    for (let j = i + 1; j < events.length; j++) {
      const aStart = new Date(events[i].start).getTime();
      const aEnd = new Date(events[i].end).getTime();
      const bStart = new Date(events[j].start).getTime();
      const bEnd = new Date(events[j].end).getTime();
      if (aStart < bEnd && bStart < aEnd) {
        conflicts.push({ eventA: events[i], eventB: events[j] });
      }
    }
  }
  return conflicts;
}
