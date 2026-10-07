/**
 * Buy (or attach) a Twilio number, point its SMS webhook at the API, and attach it to a client.
 *
 *   pnpm twilio:setup                          # search US toll-free, pick one, buy, wire, attach to demo-coach
 *   pnpm twilio:setup --type local --area 305  # local number in area code 305 instead
 *   pnpm twilio:setup --dry-run                # list candidates only, buy nothing
 *   pnpm twilio:setup --attach +18885551234    # existing number: re-sync webhook + attach (run after ngrok URL changes)
 *   pnpm twilio:setup --client demo-coach      # Client.slug to attach to (default demo-coach)
 *
 * Env: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, API_PUBLIC_URL (public https URL), DATABASE_URL (optional)
 */
import "dotenv/config";
import { parseArgs } from "node:util";
import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import twilio from "twilio";

const { values: args } = parseArgs({
  options: {
    type: { type: "string", default: "tollfree" },
    area: { type: "string" },
    contains: { type: "string" },
    "dry-run": { type: "boolean", default: false },
    attach: { type: "string" },
    client: { type: "string", default: process.env.DEMO_CLIENT_SLUG ?? "demo-coach" },
    yes: { type: "boolean", default: false },
  },
});

const sid = process.env.TWILIO_ACCOUNT_SID;
const token = process.env.TWILIO_AUTH_TOKEN;
const publicUrl = (process.env.API_PUBLIC_URL ?? "").replace(/\/$/, "");
const clientSlug = args.client!;

function fail(msg: string): never {
  console.error(`\n✖ ${msg}\n`);
  process.exit(1);
}

if (!sid || !token) fail("Set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN in .env (Twilio Console → Account Info).");
if (!args["dry-run"]) {
  if (!/^https:\/\//.test(publicUrl) || /localhost|127\.0\.0\.1/.test(publicUrl)) {
    fail(
      `API_PUBLIC_URL must be a public https URL Twilio can reach (currently "${publicUrl || "unset"}").\n` +
        `  Dev: run \`ngrok http 4000\` and set API_PUBLIC_URL=https://xxxx.ngrok-free.app\n` +
        `  Prod: your Railway/Fly/Render URL for apps/api.`,
    );
  }
}
if (args.type !== "tollfree" && args.type !== "local") fail("--type must be tollfree or local");

const tw = twilio(sid, token);
const smsUrl = `${publicUrl}/webhooks/twilio`;
const e164 = (n: string) => (n.startsWith("+") ? n : `+${n.replace(/\D/g, "")}`);

async function pickNumber(): Promise<string> {
  const search = { smsEnabled: true, limit: 5 } as { smsEnabled: boolean; limit: number; areaCode?: number; contains?: string };
  if (args.area) search.areaCode = Number(args.area);
  if (args.contains) search.contains = args.contains;

  const country = tw.availablePhoneNumbers("US");
  const list = args.type === "local" ? await country.local.list(search) : await country.tollFree.list(search);
  if (!list.length) fail(`No ${args.type} numbers available for that search. Try another --area or drop --contains.`);

  console.log(`\nAvailable US ${args.type} numbers (SMS-enabled):`);
  list.forEach((n, i) => console.log(`  [${i + 1}] ${n.phoneNumber}  ${n.friendlyName}${n.locality ? `  ${n.locality}, ${n.region}` : ""}`));

  if (args["dry-run"]) {
    console.log("\n--dry-run: nothing purchased.\n");
    process.exit(0);
  }

  let choice = 1;
  if (!args.yes) {
    const rl = readline.createInterface({ input: stdin, output: stdout });
    const ans = (await rl.question(`\nBuy which one? [1-${list.length}, or q to quit] `)).trim();
    rl.close();
    if (ans.toLowerCase() === "q" || ans === "") fail("Aborted.");
    choice = Number(ans);
    if (!Number.isInteger(choice) || choice < 1 || choice > list.length) fail("Invalid choice.");
  }
  return list[choice - 1]!.phoneNumber;
}

async function buy(phoneNumber: string): Promise<string> {
  const bought = await tw.incomingPhoneNumbers.create({
    phoneNumber,
    smsUrl,
    smsMethod: "POST",
    friendlyName: `BookedAI ${clientSlug}`,
  });
  console.log(`\n✔ Purchased ${bought.phoneNumber} (sid ${bought.sid})`);
  return bought.phoneNumber;
}

async function attach(phoneNumber: string): Promise<string> {
  const [existing] = await tw.incomingPhoneNumbers.list({ phoneNumber, limit: 1 });
  if (!existing) fail(`${phoneNumber} is not on this Twilio account.`);
  await tw.incomingPhoneNumbers(existing.sid).update({ smsUrl, smsMethod: "POST", friendlyName: `BookedAI ${clientSlug}` });
  console.log(`\n✔ Webhook on ${existing.phoneNumber} set to ${smsUrl}`);
  return existing.phoneNumber;
}

async function saveToClient(phoneNumber: string): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.log(`\nDATABASE_URL not set. Attach it later with:\n  DEMO_TWILIO_NUMBER=${phoneNumber} pnpm seed:demo`);
    return;
  }
  const { prisma } = await import("@bookedai/db");
  try {
    const client = await prisma.client.findUnique({ where: { slug: clientSlug } });
    if (!client) {
      console.log(`\nNo client with slug "${clientSlug}" yet. Run:\n  DEMO_TWILIO_NUMBER=${phoneNumber} pnpm seed:demo`);
    } else {
      await prisma.client.update({ where: { slug: clientSlug }, data: { twilioNumber: phoneNumber } });
      console.log(`✔ Attached ${phoneNumber} to client "${client.name}" (${clientSlug})`);
    }
  } catch (err) {
    console.log(
      `\nCould not reach DATABASE_URL from here (${err instanceof Error ? err.message.split("\n")[0] : String(err)}).\n` +
        `If the API runs on Railway, set DEMO_TWILIO_NUMBER=${phoneNumber} there; the boot seed attaches it.`,
    );
  } finally {
    await prisma.$disconnect().catch(() => undefined);
  }
}

const number = args.attach ? await attach(e164(args.attach)) : await buy(await pickNumber());
await saveToClient(number);

console.log(`
Next steps
  1. US SMS is blocked until the number is registered. For toll-free: Twilio Console → Phone Numbers →
     Regulatory Compliance → Toll-Free Verification → submit (free, usually 1-5 business days).
     For local: Messaging → Regulatory Compliance → A2P 10DLC (brand + campaign).
     Use the sample message + opt-in wording from README.md.
  2. Start the API with that public URL:  API_PUBLIC_URL=${publicUrl} pnpm dev:api
  3. Fake an inbound text without Twilio (signature check off):
       TWILIO_VALIDATE_SIGNATURE=false pnpm dev:api
       curl -X POST ${publicUrl}/webhooks/twilio -d "From=%2B15550001111&To=${encodeURIComponent(number)}&Body=hi&MessageSid=SM1"
  4. After verification approves: text ${number} from your phone. Reply should land in < 10s.
  5. ngrok URL changed? Re-run:  pnpm twilio:setup --attach ${number}
`);
