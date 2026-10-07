import type Anthropic from "@anthropic-ai/sdk";
import { MockCalendar, type TimeSlot } from "@bookedai/integrations";
import { parseClientConfig, type ClientConfig } from "../src/config.js";
import { DEMO_CLIENT_CONFIG } from "../src/demo-config.js";
import type { AgentDeps, AgentStore, ConversationOutcome } from "../src/tools.js";
import type { MessageCreator } from "../src/run.js";

export const TZ = "America/New_York";
/** A fixed "now": Tue 2026-10-06 10:00 ET */
export const NOW = new Date("2026-10-06T14:00:00Z");

export function demoConfig(): ClientConfig {
  return parseClientConfig(DEMO_CLIENT_CONFIG);
}

/** In-memory store that records every side effect. */
export class MemoryStore implements AgentStore {
  updates: Array<{ key: string; value: string; note?: string }> = [];
  bookings: Array<{ slot: TimeSlot; calendarEventId: string; meetingUrl?: string }> = [];
  handoffs: Array<{ reason: string; urgency: string }> = [];
  ended: Array<{ outcome: ConversationOutcome; summary: string }> = [];
  leadInfo = { name: "Sam", phone: "+15550001111", email: null as string | null };

  async updateLead(i: { key: string; value: string; note?: string }) {
    this.updates.push(i);
  }
  async createBooking(i: { slot: TimeSlot; calendarEventId: string; meetingUrl?: string }) {
    this.bookings.push(i);
    return { bookingId: `bk-${this.bookings.length}` };
  }
  async flagHandoff(i: { reason: string; urgency: "low" | "normal" | "high" }) {
    this.handoffs.push(i);
  }
  async endConversation(i: { outcome: ConversationOutcome; summary: string }) {
    this.ended.push(i);
  }
  lead() {
    return this.leadInfo;
  }
}

export function makeDeps(store = new MemoryStore(), calendar = new MockCalendar()): AgentDeps {
  return { config: demoConfig(), timezone: TZ, calendar, store, now: () => NOW };
}

/** One scripted assistant response: text and/or tool calls. */
export interface Scripted {
  text?: string;
  tools?: Array<{ name: string; input: Record<string, unknown> | ((last: string) => Record<string, unknown>) }>;
}

/**
 * Build a MessageCreator that replays scripted responses in order. Tool inputs may be
 * functions receiving the previous tool_result content so a script can pick a real slot.
 */
export function scriptedCreator(script: Scripted[]): MessageCreator & { calls: Anthropic.Messages.MessageCreateParamsNonStreaming[] } {
  let i = 0;
  const calls: Anthropic.Messages.MessageCreateParamsNonStreaming[] = [];
  const creator = (async (params: Anthropic.Messages.MessageCreateParamsNonStreaming) => {
    calls.push(params);
    const step = script[i++];
    if (!step) throw new Error(`Script exhausted at call ${i}`);
    const last = params.messages[params.messages.length - 1];
    let lastResult = "";
    if (last && typeof last.content !== "string") {
      const tr = last.content.find((b) => b.type === "tool_result");
      if (tr && tr.type === "tool_result") lastResult = typeof tr.content === "string" ? tr.content : "";
    }
    const content: Anthropic.Messages.ContentBlock[] = [];
    if (step.text) content.push({ type: "text", text: step.text, citations: null });
    for (const [n, t] of (step.tools ?? []).entries()) {
      content.push({
        type: "tool_use",
        id: `toolu_${i}_${n}`,
        name: t.name,
        input: typeof t.input === "function" ? t.input(lastResult) : t.input,
      } as Anthropic.Messages.ToolUseBlock);
    }
    const msg: Anthropic.Messages.Message = {
      id: `msg_${i}`,
      type: "message",
      role: "assistant",
      model: "claude-opus-5-5",
      content,
      stop_reason: step.tools?.length ? "tool_use" : "end_turn",
      stop_sequence: null,
      usage: {
        input_tokens: 100,
        output_tokens: 50,
        cache_read_input_tokens: i > 1 ? 80 : 0,
        cache_creation_input_tokens: i === 1 ? 80 : 0,
      } as unknown as Anthropic.Messages.Usage,
    } as unknown as Anthropic.Messages.Message;
    return msg;
  }) as MessageCreator & { calls: typeof calls };
  creator.calls = calls;
  return creator;
}

export function firstSlotStart(availabilityJson: string): string {
  const parsed = JSON.parse(availabilityJson) as { slots: Array<{ start: string }> };
  const first = parsed.slots[0];
  if (!first) throw new Error("no slots");
  return first.start;
}
