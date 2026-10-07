/**
 * Calendar provider abstraction. The agent only talks to this interface, so the demo
 * can run on the in-memory mock and a real client can run on Google Calendar.
 */

export interface TimeSlot {
  /** ISO 8601 with offset, e.g. 2026-10-09T15:00:00-04:00 */
  start: string;
  end: string;
}

export interface AvailabilityQuery {
  /** IANA timezone of the client (used to render slots and apply working hours). */
  timezone: string;
  /** Working hours in local time, 24h. */
  workingHours: { start: number; end: number };
  /** 0 = Sunday ... 6 = Saturday */
  workingDays: number[];
  /** Slot length in minutes. */
  durationMinutes: number;
  /** How many days ahead to search. */
  daysAhead: number;
  /** Don't offer slots sooner than this many hours from now. */
  minNoticeHours: number;
  /** Max slots to return. */
  limit: number;
  now?: Date;
}

export interface CreateEventInput {
  start: string;
  end: string;
  timezone: string;
  title: string;
  description: string;
  attendeeEmail?: string;
  attendeeName?: string;
}

export interface CreatedEvent {
  eventId: string;
  meetingUrl?: string;
}

export interface CalendarProvider {
  readonly kind: "google" | "mock";
  getAvailability(query: AvailabilityQuery): Promise<TimeSlot[]>;
  createEvent(input: CreateEventInput): Promise<CreatedEvent>;
  cancelEvent(eventId: string): Promise<void>;
}

/**
 * Generate candidate slots inside working hours, then filter out the ones overlapping `busy`.
 * Shared by both providers so the booking rules live in one place.
 */
export function generateSlots(
  query: AvailabilityQuery,
  busy: TimeSlot[],
): TimeSlot[] {
  const now = query.now ?? new Date();
  const earliest = new Date(now.getTime() + query.minNoticeHours * 3_600_000);
  const out: TimeSlot[] = [];
  const durMs = query.durationMinutes * 60_000;

  for (let d = 0; d <= query.daysAhead && out.length < query.limit; d++) {
    const day = addDaysInTz(now, d, query.timezone);
    if (!query.workingDays.includes(day.weekday)) continue;

    for (let h = query.workingHours.start; h < query.workingHours.end; h++) {
      const start = zonedTime(day.year, day.month, day.date, h, 0, query.timezone);
      const end = new Date(start.getTime() + durMs);
      const endHourLocal = h + query.durationMinutes / 60;
      if (endHourLocal > query.workingHours.end) break;
      if (start < earliest) continue;
      if (busy.some((b) => overlaps(start, end, new Date(b.start), new Date(b.end)))) continue;
      out.push({ start: formatInTz(start, query.timezone), end: formatInTz(end, query.timezone) });
      if (out.length >= query.limit) break;
    }
  }
  return out;
}

function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart < bEnd && bStart < aEnd;
}

interface LocalDay {
  year: number;
  month: number; // 1-12
  date: number;
  weekday: number; // 0-6
}

function partsInTz(d: Date, timeZone: string): LocalDay & { hour: number; minute: number } {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    weekday: "short",
    hour12: false,
  });
  const map: Record<string, string> = {};
  for (const p of fmt.formatToParts(d)) map[p.type] = p.value;
  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return {
    year: Number(map.year),
    month: Number(map.month),
    date: Number(map.day),
    hour: Number(map.hour) % 24,
    minute: Number(map.minute),
    weekday: weekdays.indexOf(map.weekday ?? "Sun"),
  };
}

function addDaysInTz(from: Date, days: number, timeZone: string): LocalDay {
  // Shift by whole days in UTC then read the local calendar date; DST-safe enough for slot generation.
  const shifted = new Date(from.getTime() + days * 86_400_000);
  const p = partsInTz(shifted, timeZone);
  return { year: p.year, month: p.month, date: p.date, weekday: p.weekday };
}

/** Build a Date for a wall-clock time in `timeZone`. */
export function zonedTime(
  year: number,
  month: number,
  date: number,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  // First guess assuming UTC, then correct by the zone offset at that instant.
  const guess = Date.UTC(year, month - 1, date, hour, minute);
  const offset = tzOffsetMs(new Date(guess), timeZone);
  const corrected = guess - offset;
  // Second pass handles DST boundaries.
  const offset2 = tzOffsetMs(new Date(corrected), timeZone);
  return new Date(guess - offset2);
}

function tzOffsetMs(d: Date, timeZone: string): number {
  const p = partsInTz(d, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.date, p.hour, p.minute);
  const truncated = Math.floor(d.getTime() / 60_000) * 60_000;
  return asUtc - truncated;
}

/** ISO 8601 string with the zone's numeric offset, e.g. 2026-10-09T15:00:00-04:00 */
export function formatInTz(d: Date, timeZone: string): string {
  const p = partsInTz(d, timeZone);
  const off = tzOffsetMs(d, timeZone) / 60_000;
  const sign = off >= 0 ? "+" : "-";
  const abs = Math.abs(off);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${p.year}-${pad(p.month)}-${pad(p.date)}T${pad(p.hour)}:${pad(p.minute)}:00${sign}${pad(
    Math.floor(abs / 60),
  )}:${pad(abs % 60)}`;
}

/** Human-friendly label the agent can read out, e.g. "Thu Oct 9, 3:00 PM EDT". */
export function labelSlot(slot: TimeSlot, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(slot.start));
}
