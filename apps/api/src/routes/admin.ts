import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { prisma } from "@bookedai/db";
import { ClientConfigSchema } from "@bookedai/agent";
import type { Services } from "../services.js";
import { cancelBookingJobs } from "../jobs.js";
import { attachSmsWebhook } from "@bookedai/integrations";

/**
 * Dashboard / admin API. Phase 1 auth = shared ADMIN_TOKEN bearer. Phase 2 swaps in per-client logins.
 */
export const adminRoutes: FastifyPluginAsync<{ svc: Services }> = async (app, { svc }) => {
  const auth = async (req: FastifyRequest, reply: FastifyReply) => {
    const header = req.headers.authorization ?? "";
    if (header !== `Bearer ${svc.env.ADMIN_TOKEN}`) {
      return reply.code(401).send({ error: "Unauthorized" });
    }
  };

  app.register(async (r) => {
    r.addHook("preHandler", auth);

    r.get("/admin/clients", async () =>
      prisma.client.findMany({
        select: { id: true, slug: true, name: true, plan: true, twilioNumber: true, timezone: true, googleCalendar: true, createdAt: true },
        orderBy: { createdAt: "asc" },
      }).then((rows) => rows.map((c) => ({ ...c, googleCalendar: Boolean(c.googleCalendar) }))),
    );

    const UpsertClient = z.object({
      slug: z.string().min(1),
      name: z.string().min(1),
      ownerName: z.string().min(1),
      ownerEmail: z.string().email(),
      ownerPhone: z.string().optional(),
      timezone: z.string().default("America/New_York"),
      twilioNumber: z.string().optional(),
      ghlWebhookUrl: z.string().url().optional(),
      config: ClientConfigSchema,
    });
    r.put("/admin/clients", async (req, reply) => {
      const parsed = UpsertClient.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
      const d = parsed.data;
      const client = await prisma.client.upsert({
        where: { slug: d.slug },
        create: { ...d, config: d.config },
        update: { ...d, config: d.config },
      });
      return client;
    });

    /** Point the client's Twilio number at this API's inbound webhook. */
    r.post<{ Body: { clientSlug?: string } }>("/admin/twilio/attach", async (req, reply) => {
      const { env } = svc;
      if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN) return reply.code(400).send({ error: "Twilio not configured" });
      const slug = req.body?.clientSlug ?? "demo-coach";
      const client = await prisma.client.findUnique({ where: { slug } });
      if (!client?.twilioNumber) return reply.code(404).send({ error: `No client/number for slug ${slug}` });
      const result = await attachSmsWebhook(
        { accountSid: env.TWILIO_ACCOUNT_SID, authToken: env.TWILIO_AUTH_TOKEN },
        client.twilioNumber,
        `${env.API_PUBLIC_URL}/webhooks/twilio`,
        `BookedAI ${slug}`,
      );
      return result;
    });

    r.get<{ Querystring: { clientSlug?: string } }>("/admin/overview", async (req) => {
      const client = req.query.clientSlug ? await prisma.client.findUnique({ where: { slug: req.query.clientSlug } }) : null;
      const where = client ? { clientId: client.id } : {};
      const [leads, booked, needsHuman, upcoming] = await Promise.all([
        prisma.lead.count({ where }),
        prisma.booking.count({ where: { ...where, status: { in: ["SCHEDULED", "REMINDED", "COMPLETED"] } } }),
        prisma.conversation.count({ where: { ...where, status: "HUMAN_TAKEOVER" } }),
        prisma.booking.findMany({
          where: { ...where, startsAt: { gte: new Date() }, status: { in: ["SCHEDULED", "REMINDED"] } },
          include: { lead: { select: { name: true, phone: true } } },
          orderBy: { startsAt: "asc" },
          take: 10,
        }),
      ]);
      return { leads, booked, needsHuman, upcoming };
    });

    r.get<{ Querystring: { clientSlug?: string } }>("/admin/conversations", async (req) => {
      const client = req.query.clientSlug ? await prisma.client.findUnique({ where: { slug: req.query.clientSlug } }) : null;
      return prisma.conversation.findMany({
        where: client ? { clientId: client.id } : {},
        include: {
          lead: { select: { id: true, name: true, phone: true, status: true, score: true } },
          messages: { where: { text: { not: null } }, orderBy: { createdAt: "desc" }, take: 1, select: { text: true, role: true, createdAt: true } },
        },
        orderBy: { updatedAt: "desc" },
        take: 100,
      });
    });

    r.get<{ Params: { id: string } }>("/admin/conversations/:id", async (req, reply) => {
      const convo = await prisma.conversation.findUnique({
        where: { id: req.params.id },
        include: {
          lead: true,
          messages: { where: { text: { not: null } }, orderBy: { createdAt: "asc" }, select: { id: true, role: true, text: true, createdAt: true } },
        },
      });
      if (!convo) return reply.code(404).send({ error: "Not found" });
      return convo;
    });

    /** Owner takes over: agent stops replying; owner messages go out from the same number. */
    r.post<{ Params: { id: string } }>("/admin/conversations/:id/takeover", async (req, reply) => {
      const convo = await prisma.conversation.update({ where: { id: req.params.id }, data: { status: "HUMAN_TAKEOVER" } }).catch(() => null);
      if (!convo) return reply.code(404).send({ error: "Not found" });
      await prisma.lead.update({ where: { id: convo.leadId }, data: { status: "NEEDS_HUMAN" } });
      return convo;
    });

    r.post<{ Params: { id: string } }>("/admin/conversations/:id/resume", async (req, reply) => {
      const convo = await prisma.conversation.update({ where: { id: req.params.id }, data: { status: "ACTIVE", handoffReason: null } }).catch(() => null);
      if (!convo) return reply.code(404).send({ error: "Not found" });
      await prisma.lead.update({ where: { id: convo.leadId }, data: { status: "IN_CONVERSATION" } });
      return convo;
    });

    r.post<{ Params: { id: string }; Body: { text: string } }>("/admin/conversations/:id/reply", async (req, reply) => {
      const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
      if (!text) return reply.code(400).send({ error: "text required" });
      const convo = await prisma.conversation.findUnique({ where: { id: req.params.id }, include: { client: true, lead: true } });
      if (!convo) return reply.code(404).send({ error: "Not found" });
      if (convo.lead.phone && convo.client.twilioNumber) {
        await svc.messenger.send({ from: convo.client.twilioNumber, to: convo.lead.phone, body: text });
      }
      await prisma.message.create({
        data: { conversationId: convo.id, role: "ASSISTANT", content: [{ type: "text", text: `[owner] ${text}` }], text },
      });
      return { ok: true };
    });

    r.get<{ Querystring: { clientSlug?: string } }>("/admin/bookings", async (req) => {
      const client = req.query.clientSlug ? await prisma.client.findUnique({ where: { slug: req.query.clientSlug } }) : null;
      return prisma.booking.findMany({
        where: client ? { clientId: client.id } : {},
        include: { lead: { select: { id: true, name: true, phone: true, score: true } } },
        orderBy: { startsAt: "desc" },
        take: 100,
      });
    });

    const BookingStatus = z.enum(["SCHEDULED", "REMINDED", "COMPLETED", "NO_SHOW", "CANCELLED", "RESCHEDULED"]);
    r.patch<{ Params: { id: string }; Body: { status: string } }>("/admin/bookings/:id", async (req, reply) => {
      const status = BookingStatus.safeParse(req.body?.status);
      if (!status.success) return reply.code(400).send({ error: "bad status" });
      const booking = await prisma.booking.findUnique({ where: { id: req.params.id }, include: { client: true } });
      if (!booking) return reply.code(404).send({ error: "Not found" });
      if (status.data === "CANCELLED" && booking.calendarEventId) {
        await svc.calendarFor(booking.client).cancelEvent(booking.calendarEventId).catch((err) => req.log.warn(err, "calendar cancel failed"));
        await cancelBookingJobs(svc, booking.id);
      }
      if (status.data === "COMPLETED") await cancelBookingJobs(svc, booking.id);
      return prisma.booking.update({ where: { id: booking.id }, data: { status: status.data } });
    });
  });
};
