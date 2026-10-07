import { prisma } from "@bookedai/db";
import { labelSlot, pushToGhl } from "@bookedai/integrations";
import type { Services } from "./services.js";
import type { JobHandler } from "./jobs.js";
import { handleInbound } from "./conversation.js";

/**
 * What actually happens when a scheduled job fires. Shared by the BullMQ worker and
 * the in-process dev scheduler.
 */
export function buildJobHandler(svc: Services): JobHandler {
  return async (name, { bookingId }) => {
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      include: { client: true, lead: true },
    });
    if (!booking) return;
    if (booking.status === "CANCELLED" || booking.status === "RESCHEDULED") return;
    const { client, lead } = booking;
    const when = labelSlot({ start: booking.startsAt.toISOString(), end: booking.endsAt.toISOString() }, client.timezone);
    const canText = Boolean(lead.phone && client.twilioNumber);

    switch (name) {
      case "reminder_24h":
      case "reminder_1h": {
        if (!canText) return;
        const soon = name === "reminder_1h";
        const body = soon
          ? `Hey ${lead.name ?? "there"}, your call with ${client.name} is in about an hour (${when}).${booking.meetingUrl ? ` Join here: ${booking.meetingUrl}` : ""} Reply if anything changed.`
          : `Hi ${lead.name ?? "there"}, quick reminder: your call with ${client.name} is tomorrow, ${when}. Reply with a 👍 to confirm, or let me know if you need to move it.`;
        await svc.messenger.send({ from: client.twilioNumber!, to: lead.phone!, body });
        await prisma.booking.update({ where: { id: bookingId }, data: { status: "REMINDED" } });
        return;
      }
      case "no_show_check": {
        // If the owner marked it completed, nothing to do. Otherwise assume no-show and re-engage.
        if (booking.status === "COMPLETED") return;
        await prisma.booking.update({ where: { id: bookingId }, data: { status: "NO_SHOW" } });
        if (client.ghlWebhookUrl) {
          pushToGhl(client.ghlWebhookUrl, {
            event: "booking.no_show",
            client: { id: client.id, name: client.name },
            lead: { id: lead.id, name: lead.name, phone: lead.phone, email: lead.email },
            booking: { id: booking.id, startsAt: booking.startsAt.toISOString(), endsAt: booking.endsAt.toISOString() },
          }).catch(() => undefined);
        }
        if (!canText) return;
        // Re-open the conversation and let the agent rebook.
        await prisma.conversation.updateMany({
          where: { leadId: lead.id, status: "ENDED" },
          data: { status: "ACTIVE" },
        });
        await handleInbound(svc, {
          client,
          channel: lead.phone!.startsWith("whatsapp:") ? "WHATSAPP" : "SMS",
          phone: lead.phone,
          name: lead.name,
          text: `[system: the lead missed their ${when} call. Send a short, no-guilt message offering to rebook, then call get_availability if they say yes.]`,
        });
        return;
      }
    }
  };
}
