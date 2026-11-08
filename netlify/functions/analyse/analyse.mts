import type { Config, Context } from "@netlify/functions";
import { redact } from "../../../shared/redact.ts";
import { LIMITS, RequestSchema, ResponseSchemas, type ErrorBody, type Mode } from "../../../shared/schema.ts";
import { callLLM, LLMTimeoutError, type ChatMessage } from "./llm.ts";
import { MAX_TOKENS, RETRY_MESSAGE, systemPrompt } from "./prompts.ts";

function env(name: string): string | undefined {
  // Netlify.env is available in deployed and `netlify dev` functions.
  return globalThis.Netlify?.env.get(name) ?? process.env[name];
}

function error(status: number, body: ErrorBody) {
  return Response.json(body, { status });
}

/** Logs only mode, input length, response time and status. Never the body. */
function log(mode: Mode | "unknown", inputLength: number, started: number, status: number) {
  console.log(JSON.stringify({ mode, inputLength, ms: Date.now() - started, status }));
}

function parseReply(text: string, mode: Mode) {
  // Tolerate a stray code fence around the JSON.
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    const result = ResponseSchemas[mode].safeParse(JSON.parse(cleaned));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

export default async (req: Request, _context: Context) => {
  const started = Date.now();

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    log("unknown", 0, started, 400);
    return error(400, { error: "invalid_request", message: "Body must be JSON." });
  }

  const parsed = RequestSchema.safeParse(raw);
  if (!parsed.success) {
    log("unknown", 0, started, 400);
    const issue = parsed.error.issues[0];
    const message = `${issue.path.join(".") || "body"}: ${issue.message}`;
    return error(400, { error: "invalid_request", message });
  }

  // Second redaction pass: the page already redacts, this catches anything that skipped it.
  const request = {
    ...parsed.data,
    input: redact(parsed.data.input).text,
    context: parsed.data.context === undefined ? undefined : redact(parsed.data.context).text,
  };
  const inputLength = request.input.length;
  const serverCap = Number(env("MAX_INPUT_CHARS")) || LIMITS.digest;
  const limit = Math.min(LIMITS[request.mode], serverCap);
  if (inputLength > limit) {
    log(request.mode, inputLength, started, 413);
    return error(413, { error: "too_large", limit });
  }

  const apiKey = env("ANTHROPIC_API_KEY");
  if (!apiKey) {
    console.error("ANTHROPIC_API_KEY is not set");
    log(request.mode, inputLength, started, 502);
    return error(502, { error: "upstream_failed" });
  }

  const schema = ResponseSchemas[request.mode];
  const messages: ChatMessage[] = [{ role: "user", content: request.input }];

  try {
    // First attempt, then one retry if the reply is not valid JSON for the schema.
    for (let attempt = 1; attempt <= 2; attempt++) {
      const text = await callLLM({
        apiKey,
        model: env("LLM_MODEL"),
        system: systemPrompt(request),
        messages,
        maxTokens: MAX_TOKENS[request.mode],
        schema,
      });
      const result = parseReply(text, request.mode);
      if (result) {
        log(request.mode, inputLength, started, 200);
        return Response.json(result);
      }
      messages.push({ role: "assistant", content: text || "(empty)" }, { role: "user", content: RETRY_MESSAGE });
    }
    log(request.mode, inputLength, started, 502);
    return error(502, { error: "upstream_failed" });
  } catch (err) {
    if (err instanceof LLMTimeoutError) {
      log(request.mode, inputLength, started, 504);
      return error(504, { error: "timeout" });
    }
    console.error("LLM call failed:", err instanceof Error ? err.name + ": " + err.message : "unknown");
    log(request.mode, inputLength, started, 502);
    return error(502, { error: "upstream_failed" });
  }
};

export const config: Config = {
  path: "/api/analyse",
  method: "POST",
};
