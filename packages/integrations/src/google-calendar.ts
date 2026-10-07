import { google, type calendar_v3 } from "googleapis";
import {
  generateSlots,
  type AvailabilityQuery,
  type CalendarProvider,
  type CreateEventInput,
  type CreatedEvent,
  type TimeSlot,
} from "./calendar.js";

export interface GoogleCalendarCredentials {
  access_token?: string;
  refresh_token: string;
  expiry_date?: number;
  /** Defaults to "primary" */
  calendarId?: string;
}

export interface GoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export function googleOAuthConfigFromEnv(): GoogleOAuthConfig | null {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) return null;
  return { clientId, clientSecret, redirectUri };
}

export const GOOGLE_CALENDAR_SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.readonly",
];

/** URL to send the client owner to so they can connect their calendar. `state` carries the client id. */
export function googleAuthUrl(cfg: GoogleOAuthConfig, state: string): string {
  const oauth2 = new google.auth.OAuth2(cfg.clientId, cfg.clientSecret, cfg.redirectUri);
  return oauth2.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: GOOGLE_CALENDAR_SCOPES,
    state,
  });
}

/** Exchange the OAuth code for tokens to store on `Client.googleCalendar`. */
export async function exchangeGoogleCode(
  cfg: GoogleOAuthConfig,
  code: string,
): Promise<GoogleCalendarCredentials> {
  const oauth2 = new google.auth.OAuth2(cfg.clientId, cfg.clientSecret, cfg.redirectUri);
  const { tokens } = await oauth2.getToken(code);
  if (!tokens.refresh_token) {
    throw new Error("Google did not return a refresh_token; re-run consent with prompt=consent");
  }
  return {
    access_token: tokens.access_token ?? undefined,
    refresh_token: tokens.refresh_token,
    expiry_date: tokens.expiry_date ?? undefined,
    calendarId: "primary",
  };
}

export class GoogleCalendar implements CalendarProvider {
  readonly kind = "google" as const;
  private readonly api: calendar_v3.Calendar;
  private readonly calendarId: string;

  constructor(cfg: GoogleOAuthConfig, creds: GoogleCalendarCredentials) {
    const oauth2 = new google.auth.OAuth2(cfg.clientId, cfg.clientSecret, cfg.redirectUri);
    oauth2.setCredentials({
      access_token: creds.access_token,
      refresh_token: creds.refresh_token,
      expiry_date: creds.expiry_date,
    });
    this.api = google.calendar({ version: "v3", auth: oauth2 });
    this.calendarId = creds.calendarId ?? "primary";
  }

  async getAvailability(query: AvailabilityQuery): Promise<TimeSlot[]> {
    const now = query.now ?? new Date();
    const timeMax = new Date(now.getTime() + (query.daysAhead + 1) * 86_400_000);
    const res = await this.api.freebusy.query({
      requestBody: {
        timeMin: now.toISOString(),
        timeMax: timeMax.toISOString(),
        timeZone: query.timezone,
        items: [{ id: this.calendarId }],
      },
    });
    const busyRaw = res.data.calendars?.[this.calendarId]?.busy ?? [];
    const busy: TimeSlot[] = busyRaw
      .filter((b) => b.start && b.end)
      .map((b) => ({ start: b.start as string, end: b.end as string }));
    return generateSlots(query, busy);
  }

  async createEvent(input: CreateEventInput): Promise<CreatedEvent> {
    const res = await this.api.events.insert({
      calendarId: this.calendarId,
      conferenceDataVersion: 1,
      sendUpdates: input.attendeeEmail ? "all" : "none",
      requestBody: {
        summary: input.title,
        description: input.description,
        start: { dateTime: input.start, timeZone: input.timezone },
        end: { dateTime: input.end, timeZone: input.timezone },
        attendees: input.attendeeEmail
          ? [{ email: input.attendeeEmail, displayName: input.attendeeName }]
          : undefined,
        conferenceData: {
          createRequest: {
            requestId: `bookedai-${Date.now()}`,
            conferenceSolutionKey: { type: "hangoutsMeet" },
          },
        },
      },
    });
    return {
      eventId: res.data.id ?? "",
      meetingUrl: res.data.hangoutLink ?? res.data.htmlLink ?? undefined,
    };
  }

  async cancelEvent(eventId: string): Promise<void> {
    await this.api.events.delete({ calendarId: this.calendarId, eventId, sendUpdates: "all" });
  }
}
