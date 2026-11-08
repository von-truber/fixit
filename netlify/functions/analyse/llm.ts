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
}

/** Returns the model's raw text reply. Throws LLMTimeoutError after 25 seconds. */
export async function callLLM(opts: CallLLMOptions): Promise<string> {
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
      output_config: { format: zodOutputFormat(opts.schema) },
    });
    return msg.content
      .map((block) => (block.type === "text" ? block.text : ""))
      .join("")
      .trim();
  } catch (err) {
    if (err instanceof APIConnectionTimeoutError) throw new LLMTimeoutError();
    throw err;
  }
}
