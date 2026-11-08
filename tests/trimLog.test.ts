import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { redact } from "../shared/redact.ts";
import { collapseDuplicates, signature, trimLog } from "../src/trimLog.ts";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

describe("signature", () => {
  it("ignores timestamps, numbers and ids", () => {
    expect(signature("2026/11/08 09:14:06 [error] 1024#1024: *4823 connect() failed")).toBe(
      signature("2026/11/08 09:20:41 [error] 1024#1024: *4469 connect() failed"),
    );
  });
  it("ignores unquoted routes and file paths", () => {
    expect(signature("ERROR GET /invoices/:id 500 5000ms Error: timeout (/app/node_modules/pg-pool/index.js:45:11)")).toBe(
      signature("ERROR POST /payments 500 5000ms Error: timeout (/app/node_modules/pg-pool/index.js:45:11)"),
    );
  });

  it("keeps different messages apart", () => {
    expect(signature("connect() failed")).not.toBe(signature("upstream timed out"));
  });
});

describe("collapseDuplicates", () => {
  it("folds similar lines into the first one with a count and last timestamp", () => {
    const { lines, collapsed } = collapseDuplicates([
      "2026-11-08T10:00:01Z ERROR db timeout after 30s",
      "2026-11-08T10:00:02Z INFO ok",
      "2026-11-08T10:00:03Z ERROR db timeout after 31s",
      "2026-11-08T10:00:09Z ERROR db timeout after 30s",
    ]);
    expect(collapsed).toBe(2);
    expect(lines).toEqual([
      "2026-11-08T10:00:01Z ERROR db timeout after 30s  [3 occurrences in total including this one, last at 2026-11-08T10:00:09Z]",
      "2026-11-08T10:00:02Z INFO ok",
    ]);
  });
});

describe("trimLog", () => {
  it("returns short logs unchanged apart from collapsing", () => {
    const r = trimLog("a line\nanother line\n", 1000);
    expect(r.text).toBe("a line\nanother line");
    expect(r.trimmed).toBe(false);
  });

  it("keeps every error line and drops INFO noise when over budget", () => {
    const lines = Array.from({ length: 2000 }, (_, i) =>
      i === 1500 ? "FATAL out of memory: killed process 77" : `INFO request handled for session ${(i * 7919 + 1e6).toString(36).replace(/\d/g, "x")}`,
    );
    const r = trimLog(lines.join("\n"), 3000);
    expect(r.text.length).toBeLessThanOrEqual(3000);
    expect(r.text).toContain("FATAL out of memory");
    expect(r.trimmed).toBe(true);
    expect(r.text).toMatch(/\[\d+ lines omitted\]/);
  });

  it("D1 Nginx log: collapses 214 upstream errors and fits within 40,000 characters", () => {
    const raw = fixture("nginx-error.log");
    expect(raw.length).toBeGreaterThan(40_000);
    const r = trimLog(redact(raw).text, 40_000);
    expect(r.text.length).toBeLessThanOrEqual(40_000);
    // One group with the exact count, so the model doesn't have to add numbers up.
    const groups = [...r.text.matchAll(/connect\(\) failed.*\[(\d+) occurrences in total/g)].map((m) => Number(m[1]));
    expect(groups).toEqual([214]);
    expect(r.text).toContain("no live upstreams");
  });

  it("D2 Docker log: keeps the OOMKilled ending", () => {
    const r = trimLog(fixture("docker-oom.log"), 40_000);
    expect(r.text).toContain("exited true 137");
    expect(r.text).toContain("JavaScript heap out of memory");
  });
});
