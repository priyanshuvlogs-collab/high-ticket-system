import { z } from "zod";
import type Anthropic from "@anthropic-ai/sdk";
import { labelSlot, type CalendarProvider, type TimeSlot } from "@bookedai/integrations";
import type { ClientConfig } from "./config.js";

/**
 * What the agent needs from the outside world. apps/api wires Prisma + Twilio implementations;
 * tests wire in-memory ones.
 */
export interface AgentStore {
  updateLead(input: { key: string; value: string; note?: string }): Promise<void>;
  createBooking(input: {
    slot: TimeSlot;
    calendarEventId: string;
    meetingUrl?: string;
    notes?: string;
  }): Promise<{ bookingId: string }>;
  flagHandoff(input: { reason: string; urgency: "low" | "normal" | "high" }): Promise<void>;
  endConversation(input: { outcome: ConversationOutcome; summary: string }): Promise<void>;
  /** Lead details used when creating the calendar event. */
  lead(): { name?: string | null; phone?: string | null; email?: string | null };
}

export type ConversationOutcome = "booked" | "unqualified" | "opted_out" | "handed_off" | "no_response";

export interface AgentDeps {
  config: ClientConfig;
  timezone: string;
  calendar: CalendarProvider;
  store: AgentStore;
  now?: () => Date;
}

/** A tool = JSON schema for Claude + a typed `run`. Mirrors the SDK's betaZodTool shape. */
export interface AgentTool<I = unknown> {
  name: string;
  description: string;
  schema: z.ZodType<I>;
  run(input: I): Promise<string>;
}

/** Tool call record the loop collects for tests/dashboard. */
export interface ToolCallRecord {
  name: string;
  input: unknown;
  output: string;
}

const GetAvailabilityInput = z.object({
  preferredDays: z
    .array(z.string())
    .optional()
    .describe("Optional day hints from the lead, e.g. ['Thursday', 'next week']"),
});

const BookSlotInput = z.object({
  start: z.string().describe("Exact `start` value of a slot previously returned by get_availability"),
  leadName: z.string().describe("Lead's name as they gave it"),
  leadEmail: z.string().optional().describe("Email for the calendar invite, if the lead shared one"),
  notes: z.string().optional().describe("One-line summary of what the lead wants from the call"),
});

const UpdateLeadInput = z.object({
  key: z.string().describe("Qualification key from the config, or 'name' / 'email' / 'goal'"),
  value: z.string().describe("The lead's answer, verbatim or lightly cleaned"),
  note: z.string().optional().describe("Your read on whether this passes the rule and why"),
});

const HandoffInput = z.object({
  reason: z.string().describe("Why a human needs to step in"),
  urgency: z.enum(["low", "normal", "high"]).default("normal"),
});

const EndConversationInput = z.object({
  outcome: z.enum(["booked", "unqualified", "opted_out", "handed_off", "no_response"]),
  summary: z.string().describe("2-3 sentence summary for the client's dashboard"),
});

export function buildTools(deps: AgentDeps): AgentTool<any>[] {
  const { config, timezone, calendar, store } = deps;
  let lastSlots: TimeSlot[] = [];

  const getAvailability: AgentTool<z.infer<typeof GetAvailabilityInput>> = {
    name: "get_availability",
    description:
      "Fetch the next open slots on the calendar. Call before offering any time. Returns slots with an exact `start` you must pass to book_slot.",
    schema: GetAvailabilityInput,
    async run() {
      lastSlots = await calendar.getAvailability({
        timezone,
        workingHours: config.workingHours,
        workingDays: config.workingDays,
        durationMinutes: config.callDurationMinutes,
        daysAhead: config.daysAhead,
        minNoticeHours: config.minNoticeHours,
        limit: 8,
        now: deps.now?.(),
      });
      if (!lastSlots.length) {
        return JSON.stringify({ slots: [], note: "No openings in the next window. Offer to have the owner reach out." });
      }
      return JSON.stringify({
        timezone,
        slots: lastSlots.map((s) => ({ start: s.start, label: labelSlot(s, timezone) })),
        instruction: "Offer 2-3 of these spread across different days. Use the label wording.",
      });
    },
  };

  const bookSlot: AgentTool<z.infer<typeof BookSlotInput>> = {
    name: "book_slot",
    description:
      "Book the call at a slot the lead explicitly chose. `start` must exactly match a slot from get_availability.",
    schema: BookSlotInput,
    async run(input) {
      const slot = lastSlots.find((s) => s.start === input.start);
      if (!slot) {
        return JSON.stringify({
          ok: false,
          error: "That start time was not in the last availability list. Call get_availability and offer a listed slot.",
        });
      }
      const lead = store.lead();
      const evt = await calendar.createEvent({
        start: slot.start,
        end: slot.end,
        timezone,
        title: `${config.callName}: ${input.leadName} x ${config.businessName}`,
        description: [
          `Booked by BookedAI for ${config.businessName}.`,
          `Lead: ${input.leadName}${lead.phone ? ` (${lead.phone})` : ""}`,
          input.notes ? `Notes: ${input.notes}` : "",
        ]
          .filter(Boolean)
          .join("\n"),
        attendeeEmail: input.leadEmail ?? lead.email ?? undefined,
        attendeeName: input.leadName,
      });
      const { bookingId } = await store.createBooking({
        slot,
        calendarEventId: evt.eventId,
        meetingUrl: evt.meetingUrl,
        notes: input.notes,
      });
      lastSlots = lastSlots.filter((s) => s.start !== slot.start);
      return JSON.stringify({
        ok: true,
        bookingId,
        when: labelSlot(slot, timezone),
        meetingUrl: evt.meetingUrl ?? null,
      });
    },
  };

  const updateLead: AgentTool<z.infer<typeof UpdateLeadInput>> = {
    name: "update_lead",
    description: "Record a qualification answer or contact detail as soon as the lead gives it.",
    schema: UpdateLeadInput,
    async run(input) {
      await store.updateLead(input);
      return JSON.stringify({ ok: true });
    },
  };

  const handoff: AgentTool<z.infer<typeof HandoffInput>> = {
    name: "handoff_to_human",
    description:
      "Alert the business owner to take over this conversation. Use for anger, confusion, refunds, legal/medical topics, or anything outside your instructions. After calling, send one short message saying someone from the team will follow up.",
    schema: HandoffInput,
    async run(input) {
      await store.flagHandoff(input);
      return JSON.stringify({ ok: true, note: "Owner alerted. Say a team member will follow up shortly, then stop." });
    },
  };

  const endConversation: AgentTool<z.infer<typeof EndConversationInput>> = {
    name: "end_conversation",
    description: "Mark the conversation finished with an outcome and a short summary. Call once, at the end.",
    schema: EndConversationInput,
    async run(input) {
      await store.endConversation(input);
      return JSON.stringify({ ok: true });
    },
  };

  return [getAvailability, bookSlot, updateLead, handoff, endConversation];
}

/** Convert our tools to the API's tool definitions (strict so inputs always validate). */
export function toApiTools(tools: AgentTool<any>[]): Anthropic.Messages.Tool[] {
  return tools.map((t) => {
    const schema = z.toJSONSchema(t.schema, { target: "draft-7" }) as Record<string, unknown>;
    delete schema.$schema;
    return {
      name: t.name,
      description: t.description,
      strict: true,
      input_schema: {
        ...(schema as Anthropic.Messages.Tool.InputSchema),
        type: "object",
        additionalProperties: false,
      },
    } satisfies Anthropic.Messages.Tool;
  });
}
