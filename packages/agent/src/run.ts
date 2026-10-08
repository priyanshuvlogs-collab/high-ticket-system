import Anthropic from "@anthropic-ai/sdk";
import { buildStableSystemPrompt, buildVolatileContext, type LeadContext } from "./prompt.js";
import { buildTools, toApiTools, type AgentDeps, type AgentTool, type ToolCallRecord } from "./tools.js";

export const DEFAULT_MODEL = process.env.AGENT_MODEL ?? "claude-opus-5-5";

/**
 * A stored turn. We persist the raw content-block arrays so history is replayed
 * append-only (thinking + tool_use blocks intact), which the API requires.
 */
export type StoredMessage = Anthropic.Messages.MessageParam;

/** Minimal surface the loop needs from the SDK; tests inject a scripted fake. */
export type MessageCreator = (
  params: Anthropic.Messages.MessageCreateParamsNonStreaming,
) => Promise<Anthropic.Messages.Message>;

export interface RunTurnInput {
  deps: AgentDeps;
  lead: LeadContext;
  /** Full prior history for this conversation (user + assistant turns, in order). */
  history: StoredMessage[];
  /** The new inbound text from the lead. If null, this is the agent's opener (web-form lead). */
  inbound: string | null;
  model?: string;
  create?: MessageCreator;
  maxIterations?: number;
}

export interface RunTurnResult {
  /** Text to send back to the lead (may be empty if the agent only acted). */
  reply: string;
  /** New messages to append to the stored history, in order. */
  appended: StoredMessage[];
  toolCalls: ToolCallRecord[];
  stopReason: Anthropic.Messages.Message["stop_reason"];
  usage: { input: number; output: number; cacheRead: number; cacheWrite: number };
}

let defaultClient: Anthropic | undefined;
function defaultCreate(): MessageCreator {
  defaultClient ??= new Anthropic();
  const client = defaultClient;
  return (params) => client.messages.create(params);
}

/**
 * Run one agent turn: append the inbound message, loop over tool calls until Claude stops,
 * return the outbound text and everything to persist.
 */
export async function runTurn(input: RunTurnInput): Promise<RunTurnResult> {
  const { deps, lead } = input;
  const create = input.create ?? defaultCreate();
  const model = input.model ?? DEFAULT_MODEL;
  const maxIterations = input.maxIterations ?? 8;

  const tools = buildTools(deps);
  const byName = new Map<string, AgentTool<any>>(tools.map((t) => [t.name, t]));
  const apiTools = toApiTools(tools);

  // The top-level system prompt must be byte-identical across every turn of a conversation:
  // Claude Opus 5.5 binds thinking blocks to the prefix they were produced with, and a changed
  // system prompt invalidates replayed history. Per-turn lead context goes into `messages` as a
  // system-role message instead (append-only, cache-friendly).
  const system: Anthropic.Messages.TextBlockParam[] = [
    {
      type: "text",
      text: buildStableSystemPrompt(deps.config),
      cache_control: { type: "ephemeral" },
    },
  ];

  const messages: StoredMessage[] = [...input.history];
  const appended: StoredMessage[] = [];
  const push = (m: StoredMessage) => {
    messages.push(m);
    appended.push(m);
  };

  push({
    role: "user",
    content:
      input.inbound ??
      "[system: the lead just submitted the web form. Send your opening message now.]",
  });
  push({ role: "system", content: buildVolatileContext(lead) });

  const toolCalls: ToolCallRecord[] = [];
  const replyParts: string[] = [];
  let interimFallback = "";
  const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  let stopReason: Anthropic.Messages.Message["stop_reason"] = null;

  for (let i = 0; i < maxIterations; i++) {
    const res = await create({
      model,
      max_tokens: 2048,
      system,
      messages,
      tools: apiTools,
      thinking: { type: "adaptive" },
      output_config: { effort: "medium" },
    });

    usage.input += res.usage.input_tokens;
    usage.output += res.usage.output_tokens;
    usage.cacheRead += res.usage.cache_read_input_tokens ?? 0;
    usage.cacheWrite += res.usage.cache_creation_input_tokens ?? 0;
    stopReason = res.stop_reason;

    // Replay the assistant turn verbatim (thinking + tool_use blocks included).
    push({ role: "assistant", content: res.content });

    if (res.stop_reason === "refusal") {
      replyParts.length = 0;
      replyParts.push("Thanks for reaching out! Someone from the team will follow up with you shortly.");
      await deps.store.flagHandoff({ reason: "Model refusal", urgency: "normal" });
      break;
    }

    const toolUses = res.content.filter(
      (b): b is Anthropic.Messages.ToolUseBlock => b.type === "tool_use",
    );
    const isFinal = res.stop_reason !== "tool_use" || toolUses.length === 0;
    const texts = res.content
      .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
      .map((b) => b.text.trim())
      .filter(Boolean);

    // Only the final assistant message is the reply the lead sees. Text emitted alongside tool
    // calls is the model's working note ("checking the calendar...") and must not reach the SMS.
    if (isFinal) {
      replyParts.length = 0;
      replyParts.push(...texts);
    } else if (texts.length && replyParts.length === 0) {
      // Keep the latest interim text only as a fallback if the loop ends without a final message.
      interimFallback = texts.join("\n\n");
    }
    if (isFinal) break;

    // Execute all tool calls, return all results in ONE user message.
    const results: Anthropic.Messages.ToolResultBlockParam[] = [];
    for (const tu of toolUses) {
      const tool = byName.get(tu.name);
      let output: string;
      let isError = false;
      if (!tool) {
        output = JSON.stringify({ error: `Unknown tool ${tu.name}` });
        isError = true;
      } else {
        const parsed = tool.schema.safeParse(tu.input);
        if (!parsed.success) {
          output = JSON.stringify({ error: "Invalid input", issues: parsed.error.issues });
          isError = true;
        } else {
          try {
            output = await tool.run(parsed.data);
          } catch (err) {
            output = JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
            isError = true;
          }
        }
      }
      toolCalls.push({ name: tu.name, input: tu.input, output });
      results.push({ type: "tool_result", tool_use_id: tu.id, content: output, is_error: isError || undefined });
    }
    push({ role: "user", content: results });
  }

  return {
    reply: replyParts.length ? replyParts.join("\n\n") : interimFallback,
    appended,
    toolCalls,
    stopReason,
    usage,
  };
}
