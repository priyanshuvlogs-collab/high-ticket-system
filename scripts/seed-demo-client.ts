/**
 * Seeds the "Scale Studio Coaching" demo client so the demo works in one command.
 *   pnpm seed:demo
 * Env: DATABASE_URL (required), DEMO_TWILIO_NUMBER (optional, E.164), DEMO_OWNER_PHONE (optional)
 */
import "dotenv/config";
import { prisma } from "@bookedai/db";
import { DEMO_CLIENT_CONFIG, parseClientConfig } from "@bookedai/agent";

const slug = process.env.DEMO_CLIENT_SLUG ?? "demo-coach";
const config = parseClientConfig(DEMO_CLIENT_CONFIG);

const client = await prisma.client.upsert({
  where: { slug },
  create: {
    slug,
    name: config.businessName,
    ownerName: "Jordan Lee",
    ownerEmail: process.env.DEMO_OWNER_EMAIL ?? "jordan@example.com",
    ownerPhone: process.env.DEMO_OWNER_PHONE ?? null,
    timezone: process.env.DEMO_TIMEZONE ?? "America/New_York",
    plan: "TRIAL",
    trialEndsAt: new Date(Date.now() + 30 * 86_400_000),
    twilioNumber: process.env.DEMO_TWILIO_NUMBER ?? null,
    config,
  },
  update: {
    config,
    twilioNumber: process.env.DEMO_TWILIO_NUMBER ?? undefined,
    ownerPhone: process.env.DEMO_OWNER_PHONE ?? undefined,
  },
});

console.log(`Seeded demo client "${client.name}" (slug=${client.slug}, twilio=${client.twilioNumber ?? "none"})`);
await prisma.$disconnect();
