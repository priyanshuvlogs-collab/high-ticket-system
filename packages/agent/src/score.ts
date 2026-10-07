import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { ClientConfig } from "./config.js";
import type { StoredMessage } from "./run.js";

export const LeadScoreSchema = z.object({
  score: z.number().int().min(0).max(100).describe("0 = no fit, 100 = perfect fit and ready to buy"),
  verdict: z.enum(["qualified", "unqualified", "needs_human"]),
  reasons: z.array(z.string()).max(5),
  objections: z.array(z.string()).max(5).describe("Concerns the lead raised, for the owner to prep"),
  nextStep: z.string().describe("One line the owner should do before/at the call"),
});
export type LeadScore = z.infer<typeof LeadScoreSchema>;

export type ScoreParser = (
  params: Parameters<Anthropic["messages"]["parse"]>[0],
) => Promise<{ parsed_output: LeadScore | null }>;

let client: Anthropic | undefined;

/**
 * Structured lead scoring at end of conversation. Runs once, so uses effort "high".
 */
export async function scoreLead(input: {
  config: ClientConfig;
  history: StoredMessage[];
  model?: string;
  parse?: ScoreParser;
}): Promise<LeadScore> {
  const transcript = input.history
    .map((m) => {
      const text =
        typeof m.content === "string"
          ? m.content
          : m.content
              .map((b) => {
                if (b.type === "text") return b.text;
                if (b.type === "tool_use") return `[tool ${b.name} ${JSON.stringify(b.input)}]`;
                if (b.type === "tool_result") return `[result ${typeof b.content === "string" ? b.content : JSON.stringify(b.content)}]`;
                return "";
              })
              .filter(Boolean)
              .join("\n");
      return `${m.role.toUpperCase()}: ${text}`;
    })
    .join("\n\n");

  const rubric = input.config.qualification
    .map((q) => `- ${q.key}: passes if ${q.passIf}`)
    .join("\n");

  const parse: ScoreParser =
    input.parse ??
    (async (params) => {
      client ??= new Anthropic();
      const res = await client.messages.parse(params);
      return { parsed_output: res.parsed_output as LeadScore | null };
    });

  const res = await parse({
    model: input.model ?? (process.env.AGENT_MODEL ?? "claude-opus-5-5"),
    max_tokens: 2048,
    thinking: { type: "adaptive" },
    output_config: { effort: "high", format: zodOutputFormat(LeadScoreSchema) },
    system: `You score inbound leads for ${input.config.businessName}. Ideal client: ${input.config.idealClient}. Not a fit: ${input.config.notAFit || "n/a"}.\nRubric:\n${rubric}`,
    messages: [
      {
        role: "user",
        content: `Score this conversation transcript.\n\n<transcript>\n${transcript}\n</transcript>`,
      },
    ],
  });

  if (!res.parsed_output) {
    return {
      score: 0,
      verdict: "needs_human",
      reasons: ["Scoring failed to parse"],
      objections: [],
      nextStep: "Review the transcript manually.",
    };
  }
  return res.parsed_output;
}
