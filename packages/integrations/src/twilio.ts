import twilio from "twilio";

export interface TwilioConfig {
  accountSid: string;
  authToken: string;
}

export function twilioConfigFromEnv(): TwilioConfig | null {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!accountSid || !authToken) return null;
  return { accountSid, authToken };
}

export interface Messenger {
  /** Send an outbound message. `from` and `to` may be plain E.164 or `whatsapp:+...`. */
  send(input: { from: string; to: string; body: string }): Promise<{ sid: string }>;
}

export class TwilioMessenger implements Messenger {
  private readonly client: ReturnType<typeof twilio>;

  constructor(cfg: TwilioConfig) {
    this.client = twilio(cfg.accountSid, cfg.authToken);
  }

  async send(input: { from: string; to: string; body: string }): Promise<{ sid: string }> {
    const msg = await this.client.messages.create({
      from: input.from,
      to: input.to,
      body: input.body,
    });
    return { sid: msg.sid };
  }
}

/** Dev messenger: logs instead of sending. Used when Twilio isn't configured. */
export class ConsoleMessenger implements Messenger {
  readonly sent: Array<{ from: string; to: string; body: string }> = [];
  async send(input: { from: string; to: string; body: string }): Promise<{ sid: string }> {
    this.sent.push(input);
    console.log(`[sms:${input.from} -> ${input.to}] ${input.body}`);
    return { sid: `console-${this.sent.length}` };
  }
}

/**
 * Validate the X-Twilio-Signature header on an inbound webhook.
 * `url` must be the full public URL Twilio called (scheme + host + path + query).
 */
export function validateTwilioSignature(
  authToken: string,
  signature: string | undefined,
  url: string,
  params: Record<string, string>,
): boolean {
  if (!signature) return false;
  return twilio.validateRequest(authToken, signature, url, params);
}

/** Inbound webhook body fields we care about. */
export interface InboundSms {
  from: string;
  to: string;
  body: string;
  messageSid: string;
  channel: "SMS" | "WHATSAPP";
}

export function parseInboundSms(body: Record<string, string>): InboundSms | null {
  const from = body.From;
  const to = body.To;
  if (!from || !to) return null;
  return {
    from,
    to,
    body: (body.Body ?? "").trim(),
    messageSid: body.MessageSid ?? body.SmsMessageSid ?? "",
    channel: from.startsWith("whatsapp:") ? "WHATSAPP" : "SMS",
  };
}

/** TwiML empty response: we reply asynchronously via the REST API, not inline. */
export const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';
