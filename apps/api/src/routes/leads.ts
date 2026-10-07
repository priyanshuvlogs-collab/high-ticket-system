import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { prisma } from "@bookedai/db";
import type { Services } from "../services.js";
import { handleInbound } from "../conversation.js";

const WebLeadSchema = z.object({
  clientSlug: z.string().min(1),
  name: z.string().min(1).max(120),
  phone: z
    .string()
    .min(7)
    .transform((p) => normalizePhone(p)),
  email: z.string().email().optional().or(z.literal("")),
  /** Free-text "what do you need help with" from the form. */
  message: z.string().max(2000).optional(),
  /** Pre-answered qualification keys, e.g. { budget: "yes" } */
  answers: z.record(z.string(), z.string()).optional(),
});

function normalizePhone(p: string): string {
  const digits = p.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) return digits;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return `+${digits}`;
}

/**
 * POST /leads  - public, called by the web form (or any form tool / Zapier).
 * Creates the lead and has the agent send the opening SMS within seconds.
 */
export const leadRoutes: FastifyPluginAsync<{ svc: Services }> = async (app, { svc }) => {
  app.post("/leads", async (req, reply) => {
    const parsed = WebLeadSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const body = parsed.data;

    const client = await prisma.client.findUnique({ where: { slug: body.clientSlug } });
    if (!client) return reply.code(404).send({ error: "Unknown client" });

    const knownAnswers: Record<string, string> = { ...(body.answers ?? {}) };
    if (body.message) knownAnswers.goal = body.message;

    const result = await handleInbound(svc, {
      client,
      channel: "SMS",
      phone: body.phone,
      email: body.email || null,
      name: body.name,
      source: "web_form",
      text: null,
      knownAnswers,
    });

    return reply.code(201).send({
      leadId: result.lead.id,
      conversationId: result.conversation.id,
      // The opener is also sent by SMS; returned here so the web form can show it instantly.
      opener: result.reply,
    });
  });

  /**
   * POST /conversations/:id/messages - web-chat channel (no Twilio). Lets the demo page
   * keep chatting in the browser after the form submit.
   */
  app.post<{ Params: { id: string }; Body: { text: string } }>("/conversations/:id/messages", async (req, reply) => {
    const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
    if (!text) return reply.code(400).send({ error: "text required" });
    const convo = await prisma.conversation.findUnique({
      where: { id: req.params.id },
      include: { client: true, lead: true },
    });
    if (!convo) return reply.code(404).send({ error: "Not found" });
    const result = await handleInbound(svc, {
      client: convo.client,
      channel: "WEB",
      phone: convo.lead.phone,
      email: convo.lead.email,
      name: convo.lead.name,
      text,
    });
    return { reply: result.reply, status: result.conversation.status, skipped: result.skipped ?? null };
  });
};
