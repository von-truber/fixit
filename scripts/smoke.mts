// Runs the PRD's test fixtures against a Fixit deployment and prints what came back.
//
//   node scripts/smoke.mts https://fixit-errors.netlify.app          E1-E6 and D1-D3
//   node scripts/smoke.mts https://fixit-errors.netlify.app --s3     rate-limit test S3
//
// Requests run one at a time so the timings are honest. The 9 fixtures stay under
// the 10-per-minute rate limit; run --s3 on its own, a minute later.
import { readFileSync } from "node:fs";
import { redact } from "../shared/redact.ts";
import { trimLog } from "../src/trimLog.ts";

const base = (process.argv[2] ?? "http://localhost:8888").replace(/\/$/, "");
const fixture = (name: string) => readFileSync(new URL(`../tests/fixtures/${name}`, import.meta.url), "utf8");

interface ExplainSample {
  id: string;
  input: string;
  environment: string;
  context?: string;
  expected: string;
}

const DIGEST = [
  { id: "D1", file: "nginx-error.log", expected: "Groups upstream errors with a count; points at the app process" },
  { id: "D2", file: "docker-oom.log", expected: "Root cause: memory limit" },
  { id: "D3", file: "systemd-clean.log", expected: "Verdict healthy" },
];

async function post(body: unknown) {
  const started = performance.now();
  const res = await fetch(`${base}/api/analyse`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  const ms = performance.now() - started;
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {}
  const meta = [
    res.headers.get("x-fixit-attempts") && `attempts=${res.headers.get("x-fixit-attempts")}`,
    res.headers.get("x-fixit-output") && `output=${res.headers.get("x-fixit-output")}`,
    res.headers.get("x-fixit-problem") && `problem=${res.headers.get("x-fixit-problem")}`,
  ]
    .filter(Boolean)
    .join(" ");
  return { status: res.status, ms, json, text: meta ? `${text}\n${meta}` : text, meta };
}

async function rateLimitTest() {
  // Invalid bodies are rejected by the function (400) without calling the LLM,
  // but still count towards Netlify's rate limit, so this test costs nothing.
  const statuses: number[] = [];
  for (let i = 0; i < 15; i++) statuses.push((await post({ mode: "explain" })).status);
  console.log(`S3 statuses: ${statuses.join(" ")}`);
  const pass = statuses.slice(0, 10).every((s) => s !== 429) && statuses.slice(10).every((s) => s === 429);
  console.log(pass ? "S3 PASS: requests 11-15 were rate limited" : "S3 FAIL: expected 429 for requests 11-15 only");
  process.exitCode = pass ? 0 : 1;
}

async function fixtures() {
  const times: number[] = [];
  const explain: ExplainSample[] = JSON.parse(fixture("explain-samples.json"));

  for (const s of explain.filter((s) => /^E\d$/.test(s.id))) {
    const r = await post({
      mode: "explain",
      input: redact(s.input).text,
      environment: s.environment,
      context: s.context ? redact(s.context).text : undefined,
    });
    times.push(r.ms);
    console.log(`\n=== ${s.id} HTTP ${r.status} in ${(r.ms / 1000).toFixed(1)}s ${r.meta}`);
    console.log(`expected: ${s.expected}`);
    if (r.status !== 200) {
      console.log(r.text.slice(0, 400));
      continue;
    }
    const j = r.json;
    console.log(`summary:  ${j.summary}  [confidence: ${j.confidence}]`);
    for (const step of j.fix_steps) {
      console.log(`  ${step.dangerous ? "⚠ DANGER" : "-"} ${step.step}${step.command ? `\n      $ ${step.command}` : ""}`);
    }
  }

  for (const d of DIGEST) {
    const input = trimLog(redact(fixture(d.file)).text, 40_000).text;
    const r = await post({ mode: "digest", input });
    times.push(r.ms);
    console.log(`\n=== ${d.id} ${d.file} HTTP ${r.status} in ${(r.ms / 1000).toFixed(1)}s ${r.meta}`);
    console.log(`expected: ${d.expected}`);
    if (r.status !== 200) {
      console.log(r.text.slice(0, 300));
      continue;
    }
    const j = r.json;
    console.log(`verdict:  ${j.verdict}  [confidence: ${j.confidence}]`);
    for (const i of j.issues) console.log(`  - [${i.severity}] ${i.title} ×${i.count}`);
    console.log(`root cause: ${j.root_cause}`);
  }

  const sorted = [...times].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  console.log(
    `\nTimes (s): ${times.map((t) => (t / 1000).toFixed(1)).join(", ")}\nMedian: ${(median / 1000).toFixed(1)}s (target under 10s)`,
  );
}

if (process.argv.includes("--s3")) await rateLimitTest();
else await fixtures();
