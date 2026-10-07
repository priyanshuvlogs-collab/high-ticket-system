/**
 * Terminal demo of the agent with NO database, NO Twilio: just Claude + the mock calendar.
 * Great for tuning the prompt and for a quick "watch it work" on a sales call.
 *   ANTHROPIC_API_KEY=... pnpm demo:chat
 */
import "dotenv/config";
import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { DEMO_CLIENT_CONFIG, parseClientConfig, runTurn, type AgentStore, type StoredMessage } from "@bookedai/agent";
import { MockCalendar, formatInTz } from "@bookedai/integrations";

const timezone = process.env.DEMO_TIMEZONE ?? "America/New_York";
const config = parseClientConfig(DEMO_CLIENT_CONFIG);
const calendar = new MockCalendar();
const qualification: Record<string, string> = {};

const store: AgentStore = {
  lead: () => ({ name: "Demo Lead", phone: "+15550001111", email: null }),
  async updateLead({ key, value, note }) {
    qualification[key] = value;
    console.log(`   ↳ update_lead ${key}="${value}"${note ? ` (${note})` : ""}`);
  },
  async createBooking({ slot, meetingUrl }) {
    console.log(`   ↳ BOOKED ${slot.start} ${meetingUrl ?? ""}`);
    return { bookingId: "demo" };
  },
  async flagHandoff({ reason, urgency }) {
    console.log(`   ↳ HANDOFF [${urgency}] ${reason}`);
  },
  async endConversation({ outcome, summary }) {
    console.log(`   ↳ END outcome=${outcome}: ${summary}`);
  },
};

const rl = readline.createInterface({ input: stdin, output: stdout });
let history: StoredMessage[] = [];
let inbound: string | null = null;

console.log(`BookedAI demo for ${config.businessName}. Type as the lead. Ctrl+C to quit.\n`);
for (;;) {
  const result = await runTurn({
    deps: { config, timezone, calendar, store },
    lead: { leadName: "Demo Lead", leadPhone: "+15550001111", channel: "SMS", timezone, nowLocal: formatInTz(new Date(), timezone), knownAnswers: qualification },
    history,
    inbound,
  });
  history = [...history, ...result.appended];
  console.log(`\nAlex: ${result.reply}\n   (tokens in=${result.usage.input} out=${result.usage.output} cacheRead=${result.usage.cacheRead})\n`);
  inbound = (await rl.question("You: ")).trim() || "(no reply)";
}
