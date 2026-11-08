import { describe, expect, it } from "vitest";
import { redact } from "../shared/redact.ts";

describe("redact: one case per rule in the PRD table", () => {
  it.each([
    ["email", "contact jane@company.com now", "contact [EMAIL] now"],
    ["IPv4", "connect to 192.168.1.24 failed", "connect to [IP] failed"],
    ["IPv6 full", "from 2001:0db8:85a3:0000:0000:8a2e:0370:7334 port", "from [IP] port"],
    ["IPv6 compressed", "listen [fe80::1ff:fe23:4567:890a]:80", "listen [[IP]]:80"],
    ["bearer header", "Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.abcdefghijk", "Authorization: [REDACTED]"],
    ["JWT", "token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.abcdefghijk end", "token [JWT] end"],
    ["Anthropic key", "key sk-ant-test1234567890abc used", "key [API_KEY] used"],
    ["GitHub token", "ghp_abcdefghijklmnopqrstuvwxyz0123456789", "[API_KEY]"],
    ["AWS key", "AKIAIOSFODNN7EXAMPLE rejected", "[API_KEY] rejected"],
    ["Slack token", "xoxb-1234567890-abcdefghij", "[API_KEY]"],
    ["password=value", "login with password=hunter2 failed", "login with password=[REDACTED] failed"],
    ["NAME: value", "DB_PASS: abc123", "DB_PASS: [REDACTED]"],
    ["JSON secret", '{"client_secret": "s3cr3tvalue"}', '{"client_secret": "[REDACTED]"}'],
    ["connection string", "postgres://user:pass@db.example.com/app", "postgres://[REDACTED]@db.example.com/app"],
    ["Linux home", "open /home/michael/project/app.py", "open /home/[USER]/project/app.py"],
    ["macOS home", "at /Users/michael/code/index.js", "at /Users/[USER]/code/index.js"],
    ["Windows home", "C:\\Users\\Michael\\AppData\\npm", "C:\\Users\\[USER]\\AppData\\npm"],
    ["long hex token", "sha 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08 ok", "sha [TOKEN] ok"],
    ["long base64 token", "secret aGVsbG8gV29ybGQgdGhpcyBpcyBhIHRlc3QgdG9rZW4x here", "secret [TOKEN] here"],
  ])("%s", (_name, input, expected) => {
    expect(redact(input).text).toBe(expected);
  });

  it("removes a private key block", () => {
    const input = "key:\n-----BEGIN RSA PRIVATE KEY-----\nMIIEow\nIBAAK\n-----END RSA PRIVATE KEY-----\ndone";
    expect(redact(input).text).toBe("key:\n[PRIVATE_KEY]\ndone");
  });
});

describe("redact: PRD test S1", () => {
  it("counts an API key, an email and a password as 3 and removes them all", () => {
    const input = "Error: auth failed for jane@company.com using sk-ant-test123abc with password=abc";
    const result = redact(input);
    expect(result.count).toBe(3);
    expect(result.text).not.toContain("sk-ant-test123abc");
    expect(result.text).not.toContain("jane@company.com");
    expect(result.text).not.toContain("password=abc");
    expect(result.byKind).toEqual({ api_key: 1, email: 1, secret_value: 1 });
  });
});

describe("redact: leaves ordinary error text alone", () => {
  it.each([
    "ModuleNotFoundError: No module named 'requests'",
    "EACCES: permission denied, mkdir '/usr/local/lib/node_modules'",
    "fatal: refusing to merge unrelated histories",
    "2026-11-08 09:14:02 [error] 1234#0: connect() failed (111: Connection refused)",
    "docker: Error response from daemon: port is already allocated",
    "git@github.com: Permission denied (publickey).",
    "error: std::vector<int>::at out of range",
    "npm ERR! node v20.11.1, npm v10.2.4",
    "SyntaxError: Unexpected token '<'",
    "at Object.<anonymous> (/usr/local/lib/node_modules/some_package/dist/index.js:12:5)",
    "/home/[USER]/app",
  ])("%s", (input) => {
    const result = redact(input);
    expect(result.text).toBe(input);
    expect(result.count).toBe(0);
  });
});

describe("redact: idempotent", () => {
  it("running twice changes nothing more", () => {
    const once = redact("jane@company.com sk-ant-abcdefgh123 password=xyz /home/bob/x 10.0.0.1");
    const twice = redact(once.text);
    expect(twice.text).toBe(once.text);
    expect(twice.count).toBe(0);
  });
});
