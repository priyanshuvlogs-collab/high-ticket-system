import { describe, expect, it } from "vitest";
import { runTurn, type StoredMessage } from "../src/run.js";
import { buildStableSystemPrompt } from "../src/prompt.js";
import { buildTools, toApiTools } from "../src/tools.js";
import { MemoryStore, NOW, TZ, demoConfig, firstSlotStart, makeDeps, scriptedCreator } from "./helpers.js";
import { MockCalendar, generateSlots } from "@bookedai/integrations";

const lead = { leadName: "Sam", leadPhone: "+15550001111", channel: "SMS" as const, nowLocal: "Tue Oct 6, 10:00 AM", timezone: TZ };

describe("qualified lead gets booked", () => {
  it("runs update_lead -> get_availability -> book_slot -> end_conversation and creates a booking", async () => {
    const store = new MemoryStore();
    const deps = makeDeps(store);

    // Turn 1: lead answers the business question; agent records and asks next.
    const t1 = await runTurn({
      deps,
      lead,
      history: [],
      inbound: "I run a fitness coaching biz, about $6k/mo",
      create: scriptedCreator([
        { tools: [{ name: "update_lead", input: { key: "business", value: "fitness coaching, $6k/mo", note: "passes" } }] },
        { text: "Nice, $6k/mo is a solid base. What's the number you want to hit in the next 90 days?" },
      ]),
    });
    expect(t1.toolCalls.map((c) => c.name)).toEqual(["update_lead"]);
    expect(t1.reply).toContain("90 days");
    expect(store.updates[0]?.key).toBe("business");

    // Turn 2: lead picks a time after the agent fetches availability.
    const history: StoredMessage[] = [...t1.appended];
    const t2 = await runTurn({
      deps,
      lead,
      history,
      inbound: "$15k. I can pay in full and start next week. Thursday works.",
      create: scriptedCreator([
        {
          tools: [
            { name: "update_lead", input: { key: "budget", value: "pay in full" } },
            { name: "update_lead", input: { key: "timeline", value: "next week" } },
          ],
        },
        { tools: [{ name: "get_availability", input: {} }] },
        { tools: [{ name: "book_slot", input: (avail) => ({ start: firstSlotStart(avail), leadName: "Sam", notes: "wants $15k/mo" }) }] },
        {
          text: "You're booked. Calendar invite is on its way.",
          tools: [{ name: "end_conversation", input: { outcome: "booked", summary: "Fitness coach at $6k/mo, wants $15k, pays in full." } }],
        },
        { text: "" },
      ]),
    });

    expect(t2.toolCalls.map((c) => c.name)).toEqual([
      "update_lead",
      "update_lead",
      "get_availability",
      "book_slot",
      "end_conversation",
    ]);
    expect(store.bookings).toHaveLength(1);
    expect(store.ended[0]?.outcome).toBe("booked");
    expect(t2.reply).toContain("booked");
    // Parallel tool results are returned in ONE user message.
    // appended = [inbound user, system(lead context), assistant(tool_use x2), user(tool_result x2), ...]
    const resultMsg = t2.appended[3];
    expect(resultMsg?.role).toBe("user");
    expect(Array.isArray(resultMsg?.content) && resultMsg.content.length).toBe(2);
    // Booking landed on the calendar, in working hours, after min notice.
    const cal = deps.calendar as MockCalendar;
    const evt = [...cal.events.values()][0];
    expect(evt).toBeDefined();
    expect(new Date(evt!.start).getTime()).toBeGreaterThanOrEqual(NOW.getTime() + 4 * 3_600_000);
  });
});

describe("unqualified lead is closed without a booking", () => {
  it("never calls book_slot", async () => {
    const store = new MemoryStore();
    const deps = makeDeps(store);
    const t = await runTurn({
      deps,
      lead,
      history: [],
      inbound: "I don't have a business yet, just exploring ideas",
      create: scriptedCreator([
        { tools: [{ name: "update_lead", input: { key: "business", value: "no business yet", note: "fails" } }] },
        {
          text: "Appreciate the honesty. The program is built for people already making $3k/mo, so it isn't the right fit yet.",
          tools: [{ name: "end_conversation", input: { outcome: "unqualified", summary: "No business yet." } }],
        },
        { text: "" },
      ]),
    });
    expect(t.toolCalls.map((c) => c.name)).toEqual(["update_lead", "end_conversation"]);
    expect(store.bookings).toHaveLength(0);
    expect(store.ended[0]?.outcome).toBe("unqualified");
  });
});

describe("off-script lead is handed to a human", () => {
  it("calls handoff_to_human and flags the conversation", async () => {
    const store = new MemoryStore();
    const deps = makeDeps(store);
    const t = await runTurn({
      deps,
      lead,
      history: [],
      inbound: "I paid Jordan last year and want a refund, this is ridiculous",
      create: scriptedCreator([
        { tools: [{ name: "handoff_to_human", input: { reason: "Refund request, angry", urgency: "high" } }] },
        { text: "I'm sorry about that. A team member will reach out to you directly today." },
      ]),
    });
    expect(t.toolCalls.map((c) => c.name)).toEqual(["handoff_to_human"]);
    expect(store.handoffs[0]?.urgency).toBe("high");
    expect(store.bookings).toHaveLength(0);
  });
});

describe("guardrails", () => {
  it("rejects book_slot for a start time not returned by get_availability", async () => {
    const store = new MemoryStore();
    const deps = makeDeps(store);
    const t = await runTurn({
      deps,
      lead,
      history: [],
      inbound: "Book me Thursday 3pm",
      create: scriptedCreator([
        { tools: [{ name: "book_slot", input: { start: "2026-10-08T15:00:00-04:00", leadName: "Sam" } }] },
        { text: "Let me check the calendar first." },
      ]),
    });
    expect(store.bookings).toHaveLength(0);
    expect(t.toolCalls[0]?.output).toContain("not in the last availability list");
  });

  it("returns a tool error (not a crash) for invalid tool input", async () => {
    const t = await runTurn({
      deps: makeDeps(),
      lead,
      history: [],
      inbound: "hi",
      create: scriptedCreator([
        { tools: [{ name: "end_conversation", input: { outcome: "nope" } }] },
        { text: "ok" },
      ]),
    });
    const res = t.appended[3];
    expect(res && typeof res.content !== "string" && res.content[0]?.type === "tool_result" && res.content[0].is_error).toBe(true);
  });

  it("stops at maxIterations", async () => {
    const script = Array.from({ length: 10 }, () => ({ tools: [{ name: "update_lead", input: { key: "x", value: "y" } }] }));
    const t = await runTurn({ deps: makeDeps(), lead, history: [], inbound: "loop", maxIterations: 3, create: scriptedCreator(script) });
    expect(t.toolCalls).toHaveLength(3);
  });
});

describe("prompt + tools", () => {
  it("system prompt carries the offer, pricing, rubric, and hard rules", () => {
    const p = buildStableSystemPrompt(demoConfig());
    expect(p).toContain("Scale Studio Coaching");
    expect(p).toContain("$4,500");
    expect(p).toContain("[budget]");
    expect(p).toContain("Never invent prices");
  });

  it("keeps the top-level system prompt identical across turns and sends lead context as a system message", async () => {
    const deps = makeDeps();
    const c1 = scriptedCreator([{ text: "hi" }]);
    const t1 = await runTurn({ deps, lead, history: [], inbound: null, create: c1 });
    const c2 = scriptedCreator([{ text: "ok" }]);
    await runTurn({ deps, lead: { ...lead, nowLocal: "Wed Oct 7, 9:00 AM", knownAnswers: { budget: "yes" } }, history: t1.appended, inbound: "hello", create: c2 });
    expect(JSON.stringify(c1.calls[0]!.system)).toBe(JSON.stringify(c2.calls[0]!.system));
    const sys = c2.calls[0]!.messages.filter((m) => m.role === "system");
    expect(sys).toHaveLength(2);
    expect(String(sys[1]!.content)).toContain("budget: yes");
    // system context sits right after the user turn it describes
    const msgs = c2.calls[0]!.messages;
    const lastSys = msgs.map((m) => m.role).lastIndexOf("system");
    expect(msgs[lastSys - 1]!.role).toBe("user");
  });

  it("puts a cache breakpoint on the stable block and exposes strict tool schemas", async () => {
    const create = scriptedCreator([{ text: "hi" }]);
    await runTurn({ deps: makeDeps(), lead, history: [], inbound: null, create });
    const params = create.calls[0]!;
    expect(Array.isArray(params.system) && params.system[0]?.cache_control?.type).toBe("ephemeral");
    expect(params.tools?.map((t) => ("name" in t ? t.name : "?"))).toEqual(["get_availability", "book_slot", "update_lead", "handoff_to_human", "end_conversation"]);
    for (const t of toApiTools(buildTools(makeDeps()))) {
      expect(t.strict).toBe(true);
      expect(t.input_schema.additionalProperties).toBe(false);
    }
    expect(params.thinking).toEqual({ type: "adaptive" });
  });
});

describe("slot generation", () => {
  it("respects working hours, working days, min notice and busy blocks", () => {
    const slots = generateSlots(
      {
        timezone: TZ,
        workingHours: { start: 9, end: 17 },
        workingDays: [1, 2, 3, 4, 5],
        durationMinutes: 30,
        daysAhead: 7,
        minNoticeHours: 4,
        limit: 50,
        now: NOW,
      },
      [{ start: "2026-10-06T15:00:00-04:00", end: "2026-10-06T16:00:00-04:00" }],
    );
    expect(slots.length).toBeGreaterThan(10);
    for (const s of slots) {
      const d = new Date(s.start);
      expect(d.getTime()).toBeGreaterThanOrEqual(NOW.getTime() + 4 * 3_600_000);
      const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", hour12: false }).format(d));
      expect(hour).toBeGreaterThanOrEqual(9);
      expect(hour).toBeLessThan(17);
      const wd = new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "short" }).format(d);
      expect(["Sat", "Sun"]).not.toContain(wd);
    }
    // 3pm Tue is busy
    expect(slots.find((s) => s.start === "2026-10-06T15:00:00-04:00")).toBeUndefined();
    // Tue 14:00 ET is exactly 4h after now -> allowed; 10:00 is not.
    expect(slots[0]?.start).toBe("2026-10-06T14:00:00-04:00");
  });
});
