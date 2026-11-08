import { beforeEach, describe, expect, it, vi } from "vitest";

// Replace the provider call so the test sees exactly what would leave the server.
const callLLM = vi.fn();
vi.mock("../netlify/functions/analyse/llm.ts", () => ({
  callLLM,
  LLMTimeoutError: class LLMTimeoutError extends Error {},
}));

const { default: handler, isRiskyCommand } = await import("../netlify/functions/analyse/analyse.mts");

const VALID_REPLY = JSON.stringify({
  summary: "This is not an error message.",
  meaning: "The text does not describe a failure.",
  causes: [],
  fix_steps: [],
  verify: "Paste the full error text.",
  confidence: "low",
  detected_environment: "auto",
});

// Valid against the schema but useless: what the AI Gateway sometimes returned.
const EMPTY_SHELL = JSON.stringify({
  summary: "",
  meaning: "",
  causes: [],
  fix_steps: [],
  verify: "",
  confidence: "high",
  detected_environment: "python",
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
    callLLM.mockResolvedValue({ text: VALID_REPLY, model: "m", stopReason: "end_turn", blocks: "text", outputTokens: 10 });

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
    callLLM.mockResolvedValueOnce({ text: "not json", model: "m", stopReason: "end_turn", blocks: "text", outputTokens: 10 }).mockResolvedValueOnce({ text: VALID_REPLY, model: "m", stopReason: "end_turn", blocks: "text", outputTokens: 10 });
    const res = await post({ mode: "explain", input: "Error: boom" });
    expect(res.status).toBe(200);
    expect(callLLM).toHaveBeenCalledTimes(2);
  });

  it("retries once when the reply is valid JSON but empty, and says why", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    callLLM.mockResolvedValueOnce({ text: EMPTY_SHELL, model: "m", stopReason: "end_turn", blocks: "text", outputTokens: 10 }).mockResolvedValueOnce({ text: VALID_REPLY, model: "m", stopReason: "end_turn", blocks: "text", outputTokens: 10 });
    const res = await post({ mode: "explain", input: "Error: boom" });
    expect(res.status).toBe(200);
    expect(callLLM).toHaveBeenCalledTimes(2);
    const retryMessages = callLLM.mock.calls[1][0].messages;
    expect(retryMessages.at(-1).content).toContain("incomplete (summary or meaning is empty)");
  });

  it("returns 502 after two invalid replies", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    callLLM.mockResolvedValue({ text: "{}", model: "m", stopReason: "end_turn", blocks: "text", outputTokens: 10 });
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

describe("normalizeReply", () => {
  it("accepts case and spelling variants of enum values", async () => {
    const { normalizeReply } = await import("../netlify/functions/analyse/analyse.mts");
    const raw = {
      verdict: "Errors",
      confidence: "High",
      issues: [{ title: "t", severity: "CRITICAL", count: "3", sample: "s" }],
    };
    expect(normalizeReply(raw)).toEqual({
      verdict: "errors",
      confidence: "high",
      issues: [{ title: "t", severity: "error", count: 3, first_seen: null, sample: "s" }],
    });
  });

  it("turns an empty command into null and coerces dangerous to a boolean", async () => {
    const { normalizeReply } = await import("../netlify/functions/analyse/analyse.mts");
    expect(normalizeReply({ fix_steps: [{ step: "x", command: "" }] })).toEqual({
      fix_steps: [{ step: "x", command: null, dangerous: false }],
    });
  });
});

describe("isRiskyCommand", () => {
  it.each([
    "sudo systemctl start mysql",
    "sudo nano /var/www/html/wp-config.php",
    "rm -rf node_modules",
    "chmod 777 /var/www",
    "sudo chown -R $(whoami) /usr/local/lib/node_modules",
    "git push --force origin main",
    "git push -f",
    "git reset --hard origin/main",
    "docker system prune -a",
    "docker rm web",
    "kubectl delete pod checkout-6d8f7b9c4-x2lqp -n shop",
    "DROP TABLE users;",
    "kill -9 4821",
    "curl -fsSL https://get.example.sh | bash",
    "echo 'x' | sudo tee -a /etc/hosts",
    "Remove-Item -Recurse -Force C:\temp\build",
    "sfc /scannow",
  ])("flags %s", (cmd) => {
    expect(isRiskyCommand(cmd)).toBe(true);
  });

  it.each([
    "pip install requests",
    "npm install -g typescript",
    "git pull --rebase origin main",
    "git push origin main",
    "docker ps",
    "lsof -i :3000",
    "kill 4821",
    "systemctl status mysql",
    "ls -ld /usr/local/lib/node_modules",
    "python -m pip install pandas",
    "kubectl get pods -n shop",
    "npm install && npm ci",
    "curl -I https://example.com",
  ])("leaves %s alone", (cmd) => {
    expect(isRiskyCommand(cmd)).toBe(false);
  });

  it("marks a risky command dangerous even if the model did not", async () => {
    const { normalizeReply } = await import("../netlify/functions/analyse/analyse.mts");
    const out = normalizeReply({ fix_steps: [{ step: "start it", command: "sudo systemctl start mysql", dangerous: false }] }) as any;
    expect(out.fix_steps[0].dangerous).toBe(true);
  });
});
