/**
 * Optional GoHighLevel push. GHL "Inbound Webhook" workflow triggers accept any JSON;
 * the client maps fields inside their workflow. Keeps the existing Hustle Buddies GHL
 * stack in the loop without coupling the agent to the GHL API.
 */
export interface GhlBookingPayload {
  event: "booking.created" | "booking.no_show" | "lead.qualified" | "lead.needs_human";
  client: { id: string; name: string };
  lead: { id: string; name?: string | null; phone?: string | null; email?: string | null };
  booking?: { id: string; startsAt: string; endsAt: string; meetingUrl?: string | null };
  qualification?: unknown;
  reason?: string;
}

export async function pushToGhl(webhookUrl: string, payload: GhlBookingPayload): Promise<void> {
  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(`GHL webhook failed: ${res.status} ${await res.text().catch(() => "")}`);
  }
}
