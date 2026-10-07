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
  /**
   * Run work after the HTTP response is sent. On a long-lived server this is fire-and-forget;
   * on Vercel it must be registered with waitUntil or the function freezes mid-Claude-call.
   */
  defer(work: Promise<unknown>): void;
}

const demoCalendar = new MockCalendar();

export function buildServices(env: Env, opts: { defer?: (work: Promise<unknown>) => void } = {}): Services {
  const twilioCfg =
    env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN
      ? { accountSid: env.TWILIO_ACCOUNT_SID, authToken: env.TWILIO_AUTH_TOKEN }
      : null;
  const messenger: Messenger = twilioCfg ? new TwilioMessenger(twilioCfg) : new ConsoleMessenger();
  if (!twilioCfg) console.warn("[services] Twilio not configured: outbound messages are logged, not sent");

  const google = googleOAuthConfigFromEnv();
  const calendars = new Map<string, CalendarProvider>();

  const defer = opts.defer ?? ((work) => void work.catch((err) => console.error("[defer] background work failed", err)));

  return {
    env,
    messenger,
    defer,
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
