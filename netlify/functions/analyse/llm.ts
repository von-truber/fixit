// callLLM(): the only provider-specific file. Swap this out to change provider.
import Anthropic, { APIConnectionTimeoutError } from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";

export const LLM_TIMEOUT_MS = 25_000;
export const DEFAULT_MODEL = "claude-haiku-5-5";

export type ChatMessage = { role: "user" | "assistant"; content: string };

export class LLMTimeoutError extends Error {
  constructor() {
    super("LLM call timed out");
  }
}

export interface CallLLMOptions {
  apiKey: string;
  model?: string;
  system: string;
  messages: ChatMessage[];
  maxTokens: number;
  /** Zod schema the reply must match; sent to the model as a structured-output format. */
  schema: z.ZodType;
  /**
   * Send the schema as a structured-output format. Off by default: through Netlify's
   * AI Gateway it returned empty-but-valid JSON on about half of requests, while the
   * prompt alone (validated with Zod afterwards) gave complete answers.
   */
  structuredOutput?: boolean;
}

export interface LLMReply {
  text: string;
  /** The model that actually answered, as reported by the API. */
  model: string;
  /** Why generation stopped, e.g. "end_turn" or "max_tokens" (cut off). */
  stopReason: string | null;
  /** Content block types returned, e.g. "text" or "thinking,text". */
  blocks: string;
  outputTokens: number;
}

/** Returns the model's raw text reply. Throws LLMTimeoutError after 25 seconds. */
export async function callLLM(opts: CallLLMOptions): Promise<LLMReply> {
  const client = new Anthropic({
    apiKey: opts.apiKey,
    timeout: LLM_TIMEOUT_MS,
    maxRetries: 0, // retries are handled by the caller
  });

  try {
    const msg = await client.messages.create({
      model: opts.model || DEFAULT_MODEL,
      max_tokens: opts.maxTokens,
      system: opts.system,
      messages: opts.messages,
      // Thinking tokens count towards max_tokens and were cutting replies off mid-JSON.
      // These are short, well-specified answers, so skip it: faster and complete.
      thinking: { type: "disabled" },
      ...(opts.structuredOutput ? { output_config: { format: zodOutputFormat(opts.schema) } } : {}),
    });
    // Metadata only, never content.
    console.log(
      JSON.stringify({
        llm: msg.model,
        via: process.env.ANTHROPIC_BASE_URL ? "gateway" : "direct",
        structured: Boolean(opts.structuredOutput),
        outTokens: msg.usage.output_tokens,
        stop: msg.stop_reason,
      }),
    );
    const text = msg.content
      .map((block) => (block.type === "text" ? block.text : ""))
      .join("")
      .trim();
    return {
      text,
      model: msg.model,
      stopReason: msg.stop_reason,
      blocks: msg.content.map((b) => b.type).join(","),
      outputTokens: msg.usage.output_tokens,
    };
  } catch (err) {
    if (err instanceof APIConnectionTimeoutError) throw new LLMTimeoutError();
    throw err;
  }
}
