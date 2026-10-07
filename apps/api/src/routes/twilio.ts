import type { FastifyPluginAsync } from "fastify";
import { prisma } from "@bookedai/db";
import { EMPTY_TWIML, parseInboundSms, validateTwilioSignature } from "@bookedai/integrations";
import type { Services } from "../services.js";
import { handleInbound } from "../conversation.js";

/**
 * POST /webhooks/twilio  (form-encoded, from Twilio)
 * Point each client's Twilio number's "A message comes in" webhook here.
 * We ACK immediately with empty TwiML and reply via the REST API so Claude latency never
 * hits Twilio's 15s webhook timeout.
 */
export const twilioRoutes: FastifyPluginAsync<{ svc: Services }> = async (app, { svc }) => {
  app.post<{ Body: Record<string, string> }>("/webhooks/twilio", async (req, reply) => {
    const { env } = svc;
    if (env.TWILIO_VALIDATE_SIGNATURE) {
      if (!env.TWILIO_AUTH_TOKEN) return reply.code(500).send("Twilio not configured");
      const url = `${env.API_PUBLIC_URL}/webhooks/twilio`;
      const ok = validateTwilioSignature(env.TWILIO_AUTH_TOKEN, req.headers["x-twilio-signature"] as string | undefined, url, req.body);
      if (!ok) return reply.code(403).send("Bad signature");
    }

    const sms = parseInboundSms(req.body);
    if (!sms) return reply.code(400).send("Missing From/To");

    const bareTo = sms.to.replace(/^whatsapp:/, "");
    const client = await prisma.client.findUnique({ where: { twilioNumber: bareTo } });
    if (!client) {
      req.log.warn({ to: sms.to }, "inbound for unknown number");
      return reply.type("text/xml").send(EMPTY_TWIML);
    }

    // Respond to Twilio first, then do the work.
    reply.type("text/xml").send(EMPTY_TWIML);
    const phone = sms.from.replace(/^whatsapp:/, "");
    svc.defer(
      handleInbound(svc, {
        client,
        channel: sms.channel,
        phone,
        text: sms.body || "(empty message)",
        externalId: sms.messageSid,
        source: sms.channel.toLowerCase(),
      }).catch((err) => req.log.error(err, "handleInbound failed")),
    );
  });
};
