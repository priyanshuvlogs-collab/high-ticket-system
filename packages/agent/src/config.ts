import { z } from "zod";

/**
 * Per-client agent configuration. Stored as JSON on `Client.config`.
 * This is what Hustle Buddies fills in during onboarding (by hand in Phase 1, wizard in Phase 2).
 */
export const QualificationQuestionSchema = z.object({
  key: z.string().describe("Stable key stored in Lead.qualification, e.g. 'budget'"),
  question: z.string().describe("How the agent should ask it, conversationally"),
  /** Plain-language rule for what counts as a pass, e.g. 'budget >= $3,000 or open to financing'. */
  passIf: z.string(),
  required: z.boolean().default(true),
});

export const ClientConfigSchema = z.object({
  businessName: z.string(),
  ownerFirstName: z.string(),
  /** How the agent introduces itself. */
  agentName: z.string().default("Alex"),
  /** One-paragraph description of the offer and who it's for. */
  offer: z.string(),
  /** Price points the agent is allowed to state. Anything else: "the call covers pricing". */
  pricing: z.string().default("Pricing is discussed on the call."),
  /** Who is a great fit / who is not. */
  idealClient: z.string(),
  notAFit: z.string().default(""),
  /** Q&A the agent may answer from. */
  faq: z.array(z.object({ q: z.string(), a: z.string() })).default([]),
  qualification: z.array(QualificationQuestionSchema).min(1),
  /** Name of the call as the client markets it, e.g. "Strategy Session". */
  callName: z.string().default("Strategy Call"),
  callDurationMinutes: z.number().int().min(15).max(120).default(30),
  workingHours: z.object({ start: z.number().int().min(0).max(23), end: z.number().int().min(1).max(24) }).default({ start: 9, end: 17 }),
  /** 0=Sun..6=Sat */
  workingDays: z.array(z.number().int().min(0).max(6)).default([1, 2, 3, 4, 5]),
  minNoticeHours: z.number().min(0).default(4),
  daysAhead: z.number().int().min(1).max(30).default(7),
  /** Tone guidance, e.g. "warm, direct, no corporate speak, light emoji ok". */
  tone: z.string().default("warm, direct, human. Short messages like a real setter texting. No emoji spam."),
  /** Extra hard rules from the client. */
  rules: z.array(z.string()).default([]),
});

export type ClientConfig = z.infer<typeof ClientConfigSchema>;
export type ClientConfigInput = z.input<typeof ClientConfigSchema>;

export function parseClientConfig(raw: unknown): ClientConfig {
  return ClientConfigSchema.parse(raw);
}
