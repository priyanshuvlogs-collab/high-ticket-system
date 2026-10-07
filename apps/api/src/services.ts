import {
  ConsoleMessenger,
  GoogleCalendar,
  MockCalendar,
  TwilioMessenger,
  googleOAuthConfigFromEnv,
  type CalendarProvider,
  type GoogleCalendarCredentials,
  type Messenger,
} from "@bookedai/integrations";
import type { Client } from "@bookedai/db";
import type { Env } from "./env.js";

/**
 * Per-process singletons the routes and worker share. Kept tiny on purpose:
 * everything else is a function that takes `Services` + Prisma.
 */
export interface Services {
  env: Env;
  messenger: Messenger;
  /** Resolve the calendar for a client: Google if connected, else the shared mock (demo mode). */
  calendarFor(client: Client): CalendarProvider;
}

const demoCalendar = new MockCalendar();

export function buildServices(env: Env): Services {
  const twilioCfg =
    env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN
      ? { accountSid: env.TWILIO_ACCOUNT_SID, authToken: env.TWILIO_AUTH_TOKEN }
      : null;
  const messenger: Messenger = twilioCfg ? new TwilioMessenger(twilioCfg) : new ConsoleMessenger();
  if (!twilioCfg) console.warn("[services] Twilio not configured: outbound messages are logged, not sent");

  const google = googleOAuthConfigFromEnv();
  const calendars = new Map<string, CalendarProvider>();

  return {
    env,
    messenger,
    calendarFor(client) {
      if (env.CALENDAR_PROVIDER === "mock") return demoCalendar;
      const creds = client.googleCalendar as GoogleCalendarCredentials | null;
      if (google && creds?.refresh_token) {
        let cal = calendars.get(client.id);
        if (!cal) {
          cal = new GoogleCalendar(google, creds);
          calendars.set(client.id, cal);
        }
        return cal;
      }
      if (env.CALENDAR_PROVIDER === "google") {
        throw new Error(`Client ${client.slug} has no Google Calendar connected`);
      }
      return demoCalendar;
    },
  };
}
