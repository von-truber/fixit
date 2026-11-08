import type { Config, Context } from "@netlify/functions";
import { redact } from "../../../shared/redact.ts";
import {
  LIMITS,
  RequestSchema,
  ResponseSchemas,
  type DigestResponse,
  type ErrorBody,
  type ExplainResponse,
  type Mode,
} from "../../../shared/schema.ts";
import { callLLM, LLMTimeoutError, type ChatMessage } from "./llm.ts";
import { MAX_TOKENS, RETRY_MESSAGE, systemPrompt } from "./prompts.ts";

function env(name: string): string | undefined {
  // Netlify.env is available in deployed and `netlify dev` functions.
  return globalThis.Netlify?.env.get(name) ?? process.env[name];
}

/** `problems` are our own fixed descriptions (never content), sent as a diagnostic header. */
function error(status: number, body: ErrorBody, problems: string[] = []) {
  const headers: Record<string, string> = problems.length ? { "X-Fixit-Problem": problems.join("; ").slice(0, 300) } : {};
  return Response.json(body, { status, headers });
}

/** Logs only mode, input length, response time and status. Never the body. */
function log(mode: Mode | "unknown", inputLength: number, started: number, status: number, attempts?: number) {
  console.log(JSON.stringify({ mode, inputLength, ms: Date.now() - started, status, attempts }));
}

/**
 * Valid JSON can still be an empty shell (blank summary, no steps). Treat that as a
 * failed reply so the one retry kicks in. Returns the problem, or null if it is usable.
 */
export function qualityProblem(data: ExplainResponse | DigestResponse, mode: Mode): string | null {
  const blank = (s: string) => s.trim().length < 3;
  if (mode === "explain") {
    const d = data as ExplainResponse;
    if (blank(d.summary) || blank(d.meaning)) return "summary or meaning is empty";
    if (d.confidence !== "low" && d.fix_steps.length === 0) return "no fix steps";
    if (d.fix_steps.some((s) => blank(s.step))) return "a fix step is empty";
    return null;
  }
  const d = data as DigestResponse;
  if (blank(d.overview) || blank(d.root_cause)) return "overview or root cause is empty";
  if (d.verdict !== "healthy" && d.issues.length === 0) return "no issues listed";
  return null;
}

const ENUM_SYNONYMS: Record<string, Record<string, string>> = {
  confidence: { high: "high", "very high": "high", medium: "medium", moderate: "medium", "medium-high": "medium", "medium-low": "medium", low: "low", "very low": "low" },
  verdict: { healthy: "healthy", ok: "healthy", warning: "warnings", warnings: "warnings", error: "errors", errors: "errors", "errors found": "errors" },
  severity: { error: "error", errors: "error", critical: "error", fatal: "error", warning: "warning", warn: "warning", info: "info", notice: "info", debug: "info" },
};

function normalizeEnum(field: keyof typeof ENUM_SYNONYMS, value: unknown) {
  if (typeof value !== "string") return value;
  return ENUM_SYNONYMS[field][value.trim().toLowerCase()] ?? value;
}

/** Accept harmless variations ("High", "warn", a missing first_seen) before strict validation. */
export function normalizeReply(raw: unknown): unknown {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const r = { ...(raw as Record<string, unknown>) };
  if ("confidence" in r) r.confidence = normalizeEnum("confidence", r.confidence);
  if ("verdict" in r) r.verdict = normalizeEnum("verdict", r.verdict);
  if (Array.isArray(r.issues)) {
    r.issues = r.issues.map((issue) =>
      issue && typeof issue === "object"
        ? {
            ...issue,
            severity: normalizeEnum("severity", (issue as Record<string, unknown>).severity),
            first_seen: (issue as Record<string, unknown>).first_seen ?? null,
            count: Number((issue as Record<string, unknown>).count) || 1,
          }
        : issue,
    );
  }
  if (Array.isArray(r.fix_steps)) {
    r.fix_steps = r.fix_steps.map((step) =>
      step && typeof step === "object"
        ? {
            ...step,
            command: (step as Record<string, unknown>).command || null,
            dangerous: Boolean((step as Record<string, unknown>).dangerous),
          }
        : step,
    );
  }
  return r;
}

function parseReply(text: string, mode: Mode) {
  // Tolerate a stray code fence or a sentence around the JSON object.
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  const json = start >= 0 && end > start ? cleaned.slice(start, end + 1) : cleaned;
  try {
    const result = ResponseSchemas[mode].safeParse(normalizeReply(JSON.parse(json)));
    if (!result.success) {
      const issue = result.error.issues[0];
      return { data: null, problem: `did not match the schema at ${issue.path.join(".") || "root"}: ${issue.code}` };
    }
    const problem = qualityProblem(result.data, mode);
    return problem ? { data: null, problem } : { data: result.data, problem: null };
  } catch {
    return { data: null, problem: "was not valid JSON" };
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
  const problems: string[] = [];

  try {
    // First attempt, then one retry if the reply is invalid or an empty shell.
    for (let attempt = 1; attempt <= 2; attempt++) {
      const { text, model, stopReason, blocks, outputTokens } = await callLLM({
        apiKey,
        model: env("LLM_MODEL"),
        system: systemPrompt(request),
        messages,
        maxTokens: MAX_TOKENS[request.mode],
        schema,
        structuredOutput: env("LLM_STRUCTURED_OUTPUT") === "on",
      });
      const { data, problem } = parseReply(text, request.mode);
      if (data) {
        log(request.mode, inputLength, started, 200, attempt);
        // Diagnostic metadata only: which model answered and whether a retry was needed.
        const headers: Record<string, string> = {
          "X-Fixit-Model": model,
          "X-Fixit-Attempts": String(attempt),
          "X-Fixit-Output": `${outputTokens} tokens; ${blocks}`,
        };
        if (problems.length) headers["X-Fixit-Problem"] = problems.join("; ").slice(0, 300);
        return Response.json(data, { headers });
      }
      console.log(JSON.stringify({ retry: attempt, problem }));
      problems.push(`${attempt}: ${problem} (stop: ${stopReason}, ${outputTokens} tokens, ${blocks})`);
      messages.push({ role: "assistant", content: text || "(empty)" }, { role: "user", content: RETRY_MESSAGE(problem) });
    }
    log(request.mode, inputLength, started, 502);
    return error(502, { error: "upstream_failed" }, problems);
  } catch (err) {
    if (err instanceof LLMTimeoutError) {
      log(request.mode, inputLength, started, 504);
      return error(504, { error: "timeout" });
    }
    const name = err instanceof Error ? err.name : "unknown";
    console.error("LLM call failed:", err instanceof Error ? `${name}: ${err.message}` : "unknown");
    log(request.mode, inputLength, started, 502);
    return error(502, { error: "upstream_failed" }, [...problems, `call failed: ${name}`]);
  }
};

export const config: Config = {
  path: "/api/analyse",
  method: "POST",
  // 10 analyses per minute per visitor; Netlify answers 429 before the function runs.
  // Raise windowLimit to 20 on demo day if judges share one office network.
  rateLimit: {
    windowLimit: 10,
    windowSize: 60,
    aggregateBy: ["ip", "domain"],
  },
};
