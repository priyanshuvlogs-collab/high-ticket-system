import {
  parseClientConfig,
  runTurn,
  scoreLead,
  type AgentStore,
  type StoredMessage,
} from "@bookedai/agent";
import { prisma, type Channel, type Client, type Conversation, type Lead } from "@bookedai/db";
import { pushToGhl, formatInTz } from "@bookedai/integrations";
import type { Services } from "./services.js";
import { scheduleBookingJobs } from "./jobs.js";
import { withLock } from "./lock.js";

/**
 * Orchestrates one inbound event: find/create lead + conversation, run the agent,
 * persist, send the reply, fire side effects. Used by the Twilio webhook, the web form,
 * and the worker (no-show re-engagement).
 */

export interface InboundEvent {
  client: Client;
  channel: Channel;
  /** Lead identity. phone for SMS/WhatsApp, email for web-only. */
  phone?: string | null;
  email?: string | null;
  name?: string | null;
  source?: string;
  /** Text the lead sent. null = agent should open the conversation. */
  text: string | null;
  externalId?: string;
  /** Answers captured on the web form, keyed by qualification key. */
  knownAnswers?: Record<string, string>;
}

export interface InboundResult {
  conversation: Conversation;
  lead: Lead;
  reply: string;
  skipped?: "human_takeover" | "ended";
}

export async function handleInbound(svc: Services, ev: InboundEvent): Promise<InboundResult> {
  const lead = await upsertLead(ev);
  // Serialize turns per lead so rapid-fire texts don't race on the conversation history.
  return withLock(`lead:${lead.id}`, () => runInbound(svc, ev, lead));
}

async function runInbound(svc: Services, ev: InboundEvent, lead: Lead): Promise<InboundResult> {
  let conversation = await prisma.conversation.findFirst({
    where: { leadId: lead.id, status: { in: ["ACTIVE", "HUMAN_TAKEOVER"] } },
    orderBy: { createdAt: "desc" },
  });
  if (!conversation) {
    conversation = await prisma.conversation.create({
      data: { clientId: ev.client.id, leadId: lead.id, channel: ev.channel },
    });
    await prisma.lead.update({ where: { id: lead.id }, data: { status: "IN_CONVERSATION" } });
  }

  // Always persist what the lead said, even if a human has taken over.
  if (ev.text !== null) {
    await prisma.message.create({
      data: {
        conversationId: conversation.id,
        role: "USER",
        content: ev.text,
        text: ev.text,
        externalId: ev.externalId,
      },
    });
  }
  if (conversation.status === "HUMAN_TAKEOVER") {
    return { conversation, lead, reply: "", skipped: "human_takeover" };
  }

  const config = parseClientConfig(ev.client.config);
  const history = await loadHistory(conversation.id, ev.text !== null);
  const store = buildStore(svc, ev.client, lead, conversation);

  const result = await runTurn({
    deps: {
      config,
      timezone: ev.client.timezone,
      calendar: svc.calendarFor(ev.client),
      store,
    },
    lead: {
      leadName: lead.name,
      leadPhone: lead.phone,
      channel: ev.channel,
      timezone: ev.client.timezone,
      nowLocal: formatInTz(new Date(), ev.client.timezone),
      knownAnswers: { ...(lead.qualification as Record<string, string> | null), ...ev.knownAnswers },
    },
    history,
    inbound: ev.text,
    model: svc.env.AGENT_MODEL,
  });

  // Persist the new turns verbatim (skip index 0 when it's the inbound we already stored as text).
  const toStore = ev.text !== null ? result.appended.slice(1) : result.appended;
  for (const m of toStore) {
    const isFinalAssistant = m.role === "assistant" && m === result.appended[result.appended.length - 1];
    await prisma.message.create({
      data: {
        conversationId: conversation.id,
        role: m.role === "assistant" ? "ASSISTANT" : m.role === "system" ? "SYSTEM" : "USER",
        content: m.content as object,
        text: isFinalAssistant ? result.reply : null,
      },
    });
  }

  if (result.reply && lead.phone && ev.client.twilioNumber) {
    const from = ev.channel === "WHATSAPP" ? `whatsapp:${ev.client.twilioNumber}` : ev.client.twilioNumber;
    const to = ev.channel === "WHATSAPP" && !lead.phone.startsWith("whatsapp:") ? `whatsapp:${lead.phone}` : lead.phone;
    await svc.messenger.send({ from, to, body: result.reply });
  }

  console.log(
    `[agent] client=${ev.client.slug} lead=${lead.id} tools=${result.toolCalls.map((t) => t.name).join(",") || "-"} ` +
      `tokens in=${result.usage.input} out=${result.usage.output} cacheRead=${result.usage.cacheRead}`,
  );

  const fresh = await prisma.conversation.findUniqueOrThrow({ where: { id: conversation.id } });
  return { conversation: fresh, lead, reply: result.reply };
}

async function upsertLead(ev: InboundEvent): Promise<Lead> {
  if (ev.phone) {
    return prisma.lead.upsert({
      where: { clientId_phone: { clientId: ev.client.id, phone: ev.phone } },
      create: {
        clientId: ev.client.id,
        phone: ev.phone,
        email: ev.email ?? undefined,
        name: ev.name ?? undefined,
        source: ev.source ?? ev.channel.toLowerCase(),
        qualification: ev.knownAnswers ?? undefined,
      },
      update: {
        name: ev.name ?? undefined,
        email: ev.email ?? undefined,
      },
    });
  }
  if (ev.email) {
    const existing = await prisma.lead.findFirst({ where: { clientId: ev.client.id, email: ev.email } });
    if (existing) return existing;
  }
  return prisma.lead.create({
    data: {
      clientId: ev.client.id,
      email: ev.email ?? undefined,
      name: ev.name ?? undefined,
      source: ev.source ?? "web_form",
      qualification: ev.knownAnswers ?? undefined,
    },
  });
}

/** Rebuild the API message history from stored turns. */
export async function loadHistory(conversationId: string, dropLastUser: boolean): Promise<StoredMessage[]> {
  const rows = await prisma.message.findMany({
    where: { conversationId },
    orderBy: { createdAt: "asc" },
  });
  const msgs: StoredMessage[] = rows.map((r) => ({
    role: r.role === "ASSISTANT" ? "assistant" : r.role === "SYSTEM" ? "system" : "user",
    content: r.content as StoredMessage["content"],
  }));
  // The inbound we just stored will be re-added by runTurn.
  if (dropLastUser && msgs.length && msgs[msgs.length - 1]?.role === "user") msgs.pop();
  return msgs;
}

function buildStore(svc: Services, client: Client, lead: Lead, conversation: Conversation): AgentStore {
  return {
    lead: () => ({ name: lead.name, phone: lead.phone, email: lead.email }),

    async updateLead({ key, value }) {
      const current = (lead.qualification as Record<string, string> | null) ?? {};
      const qualification = { ...current, [key]: value };
      const data: Record<string, unknown> = { qualification };
      if (key === "name") data.name = value;
      if (key === "email") data.email = value;
      const updated = await prisma.lead.update({ where: { id: lead.id }, data });
      Object.assign(lead, updated);
    },

    async createBooking({ slot, calendarEventId, meetingUrl, notes }) {
      const booking = await prisma.booking.create({
        data: {
          clientId: client.id,
          leadId: lead.id,
          startsAt: new Date(slot.start),
          endsAt: new Date(slot.end),
          calendarEventId,
          meetingUrl,
          notes,
        },
      });
      await prisma.lead.update({ where: { id: lead.id }, data: { status: "BOOKED" } });
      await scheduleBookingJobs(svc, booking.id, booking.startsAt);
      if (client.ghlWebhookUrl) {
        pushToGhl(client.ghlWebhookUrl, {
          event: "booking.created",
          client: { id: client.id, name: client.name },
          lead: { id: lead.id, name: lead.name, phone: lead.phone, email: lead.email },
          booking: { id: booking.id, startsAt: booking.startsAt.toISOString(), endsAt: booking.endsAt.toISOString(), meetingUrl },
          qualification: lead.qualification,
        }).catch((err) => console.error("[ghl] push failed", err));
      }
      return { bookingId: booking.id };
    },

    async flagHandoff({ reason, urgency }) {
      await prisma.conversation.update({
        where: { id: conversation.id },
        data: { status: "HUMAN_TAKEOVER", handoffReason: reason },
      });
      await prisma.lead.update({ where: { id: lead.id }, data: { status: "NEEDS_HUMAN" } });
      if (client.ownerPhone && client.twilioNumber) {
        await svc.messenger
          .send({
            from: client.twilioNumber,
            to: client.ownerPhone,
            body: `[BookedAI ${urgency.toUpperCase()}] ${lead.name ?? lead.phone ?? "A lead"} needs you: ${reason}. Reply from the dashboard.`,
          })
          .catch((err) => console.error("[handoff] alert failed", err));
      }
      if (client.ghlWebhookUrl) {
        pushToGhl(client.ghlWebhookUrl, {
          event: "lead.needs_human",
          client: { id: client.id, name: client.name },
          lead: { id: lead.id, name: lead.name, phone: lead.phone, email: lead.email },
          reason,
        }).catch(() => undefined);
      }
    },

    async endConversation({ outcome, summary }) {
      await prisma.conversation.update({
        where: { id: conversation.id },
        data: { status: outcome === "handed_off" ? "HUMAN_TAKEOVER" : "ENDED", summary },
      });
      const status =
        outcome === "booked" ? "BOOKED" : outcome === "unqualified" ? "UNQUALIFIED" : outcome === "handed_off" ? "NEEDS_HUMAN" : "CLOSED";
      await prisma.lead.update({ where: { id: lead.id }, data: { status } });

      // Score asynchronously; don't hold up the SMS reply.
      if (svc.env.ANTHROPIC_API_KEY) {
        svc.defer((async () => {
          try {
            const history = await loadHistory(conversation.id, false);
            const score = await scoreLead({ config: parseClientConfig(client.config), history, model: svc.env.AGENT_MODEL });
            await prisma.lead.update({
              where: { id: lead.id },
              data: {
                score: score.score,
                qualification: { ...((lead.qualification as object | null) ?? {}), _score: score },
              },
            });
          } catch (err) {
            console.error("[score] failed", err);
          }
        })());
      }
    },
  };
}
