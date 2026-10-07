import {
  generateSlots,
  type AvailabilityQuery,
  type CalendarProvider,
  type CreateEventInput,
  type CreatedEvent,
  type TimeSlot,
} from "./calendar.js";

/**
 * In-memory calendar for demos and tests. Booked events become busy slots so a second
 * lead can't double-book.
 */
export class MockCalendar implements CalendarProvider {
  readonly kind = "mock" as const;
  readonly events = new Map<string, CreateEventInput>();
  private seq = 0;

  constructor(private readonly busy: TimeSlot[] = []) {}

  async getAvailability(query: AvailabilityQuery): Promise<TimeSlot[]> {
    const booked: TimeSlot[] = [...this.events.values()].map((e) => ({ start: e.start, end: e.end }));
    return generateSlots(query, [...this.busy, ...booked]);
  }

  async createEvent(input: CreateEventInput): Promise<CreatedEvent> {
    const eventId = `mock-evt-${++this.seq}`;
    this.events.set(eventId, input);
    return { eventId, meetingUrl: `https://meet.example.com/${eventId}` };
  }

  async cancelEvent(eventId: string): Promise<void> {
    this.events.delete(eventId);
  }
}
