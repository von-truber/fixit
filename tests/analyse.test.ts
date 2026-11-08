import { beforeEach, describe, expect, it, vi } from "vitest";

// Replace the provider call so the test sees exactly what would leave the server.
const callLLM = vi.fn();
vi.mock("../netlify/functions/analyse/llm.ts", () => ({
  callLLM,
  LLMTimeoutError: class LLMTimeoutError extends Error {},
}));

const { default: handler } = await import("../netlify/functions/analyse/analyse.mts");

const VALID_REPLY = JSON.stringify({
  summary: "s",
  meaning: "m",
  causes: [],
  fix_steps: [],
  verify: "v",
  confidence: "low",
  detected_environment: "auto",
});

function post(body: unknown) {
  return handler(
    new Request("http://localhost/api/analyse", { method: "POST", body: JSON.stringify(body) }),
    {} as never,
  );
}

const SECRETS = ["sk-ant-test123abcdef456", "jane@company.com", "hunter2"];

beforeEach(() => {
  callLLM.mockReset();
  process.env.ANTHROPIC_API_KEY = "test-key";
});

describe("analyse function", () => {
  it("redacts again on the server, so secrets never reach the LLM or the log (S1)", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    callLLM.mockResolvedValue(VALID_REPLY);

    const res = await post({
      mode: "explain",
      input: `auth failed for jane@company.com key=${SECRETS[0]} password=hunter2`,
      context: "my email is jane@company.com",
    });

    expect(res.status).toBe(200);
    const sent = JSON.stringify(callLLM.mock.calls[0][0]);
    const logged = JSON.stringify(log.mock.calls);
    for (const secret of SECRETS) {
      expect(sent).not.toContain(secret);
      expect(logged).not.toContain(secret);
    }
    log.mockRestore();
  });

  it("retries once when the reply is not valid JSON, then succeeds", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    callLLM.mockResolvedValueOnce("not json").mockResolvedValueOnce(VALID_REPLY);
    const res = await post({ mode: "explain", input: "Error: boom" });
    expect(res.status).toBe(200);
    expect(callLLM).toHaveBeenCalledTimes(2);
  });

  it("returns 502 after two invalid replies", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    callLLM.mockResolvedValue("{}");
    const res = await post({ mode: "explain", input: "Error: boom" });
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "upstream_failed" });
  });

  it("rejects explain input over 8,000 characters with 413 (S2 server side)", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const res = await post({ mode: "explain", input: "x".repeat(8001) });
    expect(res.status).toBe(413);
    expect(callLLM).not.toHaveBeenCalled();
  });
});
