# Fixit: Error and Log Troubleshooter PRD

Nov 8, 2026 · @Michael Osborne

## Overview

Fixit is a free website where anyone can paste a terminal error or upload a log file and get a plain-language explanation and a suggested fix in seconds. It runs entirely on Netlify: a static page for the interface and one Netlify Function that calls an LLM. Users need no account, no install and no API key.

**Working name:** Fixit (placeholder; rename freely).

**Problem.** Error messages and logs are written for machines. Beginners copy them into search engines and land on outdated forum threads. Experienced engineers lose time scanning hundreds of log lines for the one that matters.

**Hackathon fit.** Theme 1, Simplify the Everyday: it turns a daily frustration for anyone who uses a computer into a one-click answer.

**Goals**

- Explain any pasted error in plain English, with the likely cause and a step-by-step fix.
- Summarise a log file into grouped issues, counts and the probable root cause.
- Strip secrets from input in the browser before anything leaves the device.
- Ship a working, public prototype on Netlify within 3 to 6 hours.

**Non-goals for the hackathon**

- User accounts, saved history or payments.
- Running commands or changing anything on the user's machine.
- Guaranteed-correct fixes. The tool advises; the user decides.
- The terminal CLI. It moves to a later phase and reuses the same backend.

## Users and user stories

| User | Need | Story |
| --- | --- | --- |
| Beginner developer or student | Understand an error without jargon | As a beginner, I paste a Python traceback and get what went wrong and how to fix it in words I understand. |
| Everyday computer user | Fix a software or installer error | As a non-technical user, I paste an error from an app or installer and get safe steps to try. |
| Support or ops engineer | Triage a noisy log quickly | As a support engineer, I upload a 2,000-line log and see the top issues ranked, with counts and first occurrence. |
| Hackathon judge | Try the tool in seconds | As a judge, I open the link, click a sample and see a useful result with no sign-up. |

The judge story matters most for the hackathon: every design choice should shorten the path from opening the link to seeing a good result.

## Features

The site has two modes behind one input area: **Explain Error** for a single error or stack trace, and **Log Digest** for a whole log file. Both share the redaction step, the backend and the result layout.

### Mode 1: Explain Error

- **Input:** pasted text up to 8,000 characters (an error message, stack trace or command output).
- **Optional context:** a dropdown for the environment (Auto-detect, Linux, macOS, Windows, Python, Node.js, Docker, Git, WordPress or PHP, Other) and a free-text "What were you trying to do?" field.
- **Output:** a one-line summary, what it means in plain English, the likely causes ranked, step-by-step fix with copyable commands, how to confirm it worked, and a confidence level (High, Medium or Low).
- **Safety flag:** any suggested command that deletes data, changes permissions or needs `sudo` is marked with a warning badge.

### Mode 2: Log Digest

- **Input:** a pasted log or an uploaded `.log` or `.txt` file up to 1 MB.
- **Pre-processing in the browser:** redact secrets, collapse duplicate lines, then keep the most useful 40,000 characters (all ERROR, FATAL and WARN lines plus their surrounding lines first).
- **Output:** a health verdict (Healthy, Warnings or Errors found), the top issues grouped with counts and first-seen timestamp, a probable root cause, recommended next steps and an "Explain this" button on each issue that sends it to Mode 1.

### Shared

- Three built-in samples per mode so judges can try it with one click.
- Copy result as Markdown, and copy any single command.
- A visible "Secrets removed: 3" counter with a preview of what will be sent.
- Light and dark theme that follows the system setting.

### Scope

| Feature | Priority |
| --- | --- |
| Explain Error mode with structured output | Must-have |
| Browser-side redaction with preview | Must-have |
| Sample errors for one-click demo | Must-have |
| Netlify Function with rate limiting | Must-have |
| Log Digest mode (paste) | Must-have |
| Log file upload and smart trimming | Should-have |
| "Explain this" hand-off from Digest to Explain | Should-have |
| Copy as Markdown | Should-have |
| Shareable result link | Stretch |
| Terminal CLI using the same API | Stretch (post-hackathon) |

## User experience

Everything sits on one page, top to bottom, so a first-time visitor reaches a result in three clicks: pick a sample, review, analyse.

**Page layout**

1. **Header:** name, one-line pitch ("Paste an error. Get a fix.") and a link to the GitHub repo.
2. **Mode tabs:** Explain Error | Log Digest.
3. **Input card:** large monospace text area, file drop zone (Log Digest only), environment dropdown, "What were you trying to do?" field and sample buttons.
4. **Privacy strip:** "Secrets removed: N" with a "Preview what will be sent" toggle.
5. **Analyse button:** disabled while empty; shows a spinner and "Reading your error..." while waiting.
6. **Result card:** rendered sections, copy buttons and the confidence badge.
7. **Footer:** a short disclaimer that suggestions may be wrong and destructive commands should be checked first.

**Flow**

1. The user pastes text, drops a file or clicks a sample.
2. The browser redacts secrets, trims the log if needed and updates the counter.
3. The user clicks Analyse; the page sends a POST to `/api/analyse`.
4. The function returns structured JSON; the page renders it into the result card.
5. In Log Digest, the user can click "Explain this" on any issue, which fills Mode 1 and runs it.

**States to design:** empty, loading, success, rate-limited ("Too many requests, try again in a minute"), input too long, and server error with a retry button.

**Accessibility:** keyboard-usable tabs and buttons, visible focus rings, `aria-live` on the result area, and colour never the only signal for warnings.

## Architecture

Fixit is a static page plus one serverless function on Netlify. The browser never sees the API key, and the AI provider never sees unredacted text.

&#91;embedded content: Fixit architecture · browser, Netlify, AI provider\]

The page redacts and trims input, then posts it to the function. The function checks it again, calls the model with the key from Netlify's environment variables and returns validated JSON for the result card.

**Tech stack**

| Layer | Choice | Why |
| --- | --- | --- |
| Front end | HTML, CSS and TypeScript, bundled by Vite | No framework to learn or debug; fast for an agent to build |
| Backend | One Netlify Function (`.mts`, Node) | Same repo, same deploy, no server to run |
| LLM | Anthropic API, Claude Haiku 5.5 | Fast and cheap; swappable in one file |
| Validation | Zod schemas in `shared/` | One source of truth for page and function |
| Tests | Vitest | Runs the redaction and trimming tests in seconds |
| Hosting | Netlify, deployed from GitHub | Every push redeploys; free subdomain |

## Privacy and redaction

Redaction runs in the browser before the request is sent, and the server runs the same rules again as a safety net. Nothing is stored: no database, no logging of request bodies.

| Pattern | Example | Replaced with |
| --- | --- | --- |
| Email addresses | `jane@company.com` | `[EMAIL]` |
| IPv4 and IPv6 addresses | `192.168.1.24` | `[IP]` |
| Bearer and auth headers | `Authorization: Bearer eyJ...` | `Authorization: [REDACTED]` |
| JWTs | `eyJhbGciOi...` (three dot-separated parts) | `[JWT]` |
| Known API key shapes | `sk-...`, `ghp_...`, `AKIA...`, `xox...` | `[API_KEY]` |
| `key=value` secrets | `password=hunter2`, `DB_PASS: abc` | `password=[REDACTED]` |
| Connection strings | `postgres://user:pass@host/db` | `postgres://[REDACTED]@host/db` |
| Private keys | `-----BEGIN ... PRIVATE KEY-----` block | `[PRIVATE_KEY]` |
| Home directory user names | `/home/michael/`, `C:\Users\Michael\` | `/home/[USER]/` |
| Long random tokens | 32+ characters of hex or base64 | `[TOKEN]` |

**Rules**

- The counter shows how many items were removed, and the preview shows exactly what will be sent.
- Redaction lives in one shared module (`redact.ts`) used by both the page and the function, so the rules never drift apart.
- Function logs record only mode, input length, response time and status code.
- The footer says plainly: "Your text is sent to an AI provider to generate the answer and is not stored by Fixit."

## API contract

One endpoint serves both modes: `POST /api/analyse`, JSON in and JSON out. The future CLI will call the same endpoint.

**Request**

```json
{
  "mode": "explain",
  "input": "ModuleNotFoundError: No module named 'requests'",
  "environment": "python",
  "context": "Running my script after cloning a repo"
}
```

- `mode`: `"explain"` or `"digest"` (required).
- `input`: redacted text; max 8,000 characters for explain, 40,000 for digest (required).
- `environment`: one of the dropdown values, default `"auto"`.
- `context`: optional, max 300 characters.

**Response: explain**

```json
{
  "summary": "Python can't find the 'requests' package.",
  "meaning": "Your script imports a library that isn't installed in the Python environment you're using.",
  "causes": ["The package was never installed", "You're in a different virtual environment"],
  "fix_steps": [
    {"step": "Install the package", "command": "pip install requests", "dangerous": false},
    {"step": "If you use a virtual environment, activate it first", "command": "source .venv/bin/activate", "dangerous": false}
  ],
  "verify": "Run python -c \"import requests\"; no error means it's fixed.",
  "confidence": "high",
  "detected_environment": "python"
}
```

**Response: digest**

```json
{
  "verdict": "errors",
  "overview": "Nginx can't reach the upstream app, which keeps restarting after running out of memory.",
  "issues": [
    {"title": "Upstream connection refused", "severity": "error", "count": 214, "first_seen": "2026-11-08 09:14:02", "sample": "connect() failed (111: Connection refused)"}
  ],
  "root_cause": "The app process is killed by the OOM killer, so Nginx has nothing to connect to.",
  "next_steps": ["Check memory limits for the app service", "Review the app's own logs around 09:14"],
  "confidence": "medium"
}
```

**Errors**

| Status | When | Body |
| --- | --- | --- |
| 400 | Missing or invalid `mode` or `input` | `{"error": "invalid_request", "message": "..."}` |
| 413 | Input over the size limit | `{"error": "too_large", "limit": 8000}` |
| 429 | Rate limit reached | Returned by Netlify before the function runs |
| 502 | LLM call failed or returned invalid JSON twice | `{"error": "upstream_failed"}` |
| 504 | LLM took too long | `{"error": "timeout"}` |

## LLM prompts and output

The function uses a fast, low-cost model by default and forces JSON output that matches the response shapes above. The default assumes the Anthropic API with Claude Haiku 5.5 (`claude-haiku-5-5`); the provider sits behind one `callLLM()` function, so switching to OpenAI or Gemini changes one file and two environment variables.

**System prompt: explain**

```text
You are Fixit, a patient senior support engineer. A user has pasted an error.
Explain it for someone who may be a beginner: short sentences, no unexplained jargon.
Return ONLY JSON matching this schema: {summary, meaning, causes[], fix_steps[{step, command, dangerous}], verify, confidence, detected_environment}.
Rules:
- summary: one sentence, under 20 words.
- causes: most likely first, at most 4.
- fix_steps: at most 6; command is null when no command applies.
- dangerous = true for any command that deletes data, changes permissions, uses sudo, force-pushes or edits system files.
- If the input is not an error, say so in summary and set confidence to "low".
- Never invent file paths or package names that are not in the input or standard for the tool.
Environment hint: {environment}. User context: {context}.
```

**System prompt: digest**

```text
You are Fixit, an experienced SRE reviewing a log excerpt.
Group related lines into issues, count them, note first_seen timestamps when present, and find the most probable root cause.
Return ONLY JSON matching: {verdict, overview, issues[{title, severity, count, first_seen, sample}], root_cause, next_steps[], confidence}.
Rules:
- verdict: "healthy", "warnings" or "errors".
- issues: at most 8, most severe first; sample is one representative line.
- root_cause: one or two sentences; say "unclear from this excerpt" when it is.
- Note that the log may be trimmed; do not assume missing lines.
```

**Handling the reply**

- Validate the JSON against a schema (Zod). On failure, retry once with "Your last reply was not valid JSON. Return only the JSON object."
- Set `max_tokens` to about 1,200 for explain and 1,800 for digest to keep answers short and fast.
- Use temperature 0.2 for consistent answers.
- The front end treats every string as plain text (no HTML injection) and renders `command` values in code blocks with a copy button.

## Netlify setup

The whole app deploys as one Netlify project from a GitHub repo: static files from `public/` and one function from `netlify/functions/`. Netlify's current defaults fit this app comfortably.

| Netlify limit | Value | What it means for Fixit |
| --- | --- | --- |
| Synchronous function execution | 60 seconds, not configurable | A Haiku reply takes a few seconds; set our own 25 second timeout on the LLM call |
| Buffered request and response payload | 6 MB | Far above our 40,000 character cap |
| Memory | 1024 MB | Plenty; no tuning needed |
| Rate limiting in code | Available on all plans | Protects the API key from abuse |

Source: [Netlify functions configuration](https://docs.netlify.com/build/functions/configuration/) and [Netlify rate limiting](https://docs.netlify.com/manage/security/secure-access-to-sites/rate-limiting/). Rate limits for functions go in the function's exported `config`, not in `netlify.toml`.

**netlify.toml**

```toml
[build]
  command = "npm run build"
  publish = "public"
  functions = "netlify/functions"

[functions]
  node_bundler = "esbuild"

[[headers]]
  for = "/*"
  [headers.values]
    X-Content-Type-Options = "nosniff"
    Referrer-Policy = "strict-origin-when-cross-origin"
    Content-Security-Policy = "default-src 'self'; style-src 'self' 'unsafe-inline'"
```

**Function config (inside `netlify/functions/analyse.mts`)**

```ts
import type { Config } from "@netlify/functions";

export const config: Config = {
  path: "/api/analyse",
  method: "POST",
  rateLimit: {
    windowLimit: 10,
    windowSize: 60,
    aggregateBy: ["ip", "domain"],
  },
};
```

This allows 10 analyses per minute per visitor. Raise it to 20 on demo day if judges share one office network.

**Environment variables** (Project configuration, Environment variables; mark the key as a secret)

| Name | Example | Purpose |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | `sk-ant-...` | LLM access; never sent to the browser |
| `LLM_MODEL` | `claude-haiku-5-5` | Swap models without a code change |
| `MAX_INPUT_CHARS` | `40000` | Server-side size cap |

Read them in the function with `Netlify.env.get("ANTHROPIC_API_KEY")`.

**Cost guard:** set a monthly spend limit in the LLM provider's console before going public. Netlify also offers an [AI Gateway](https://www.netlify.com/blog/how-to-rate-limit-ai-features-and-avoid-surprise-costs) that injects provider keys for you; check whether your plan includes it, as it would remove the need to manage the key yourself.

**Deploy steps**

1. Push the repo to GitHub.
2. In Netlify, Add new project, Import from Git, pick the repo. Build settings come from `netlify.toml`.
3. Add the environment variables, then trigger a deploy.
4. Test locally first with `npx netlify dev`, which runs the page and function together on `localhost:8888`.
5. Optional: set a custom subdomain such as `fixit-errors.netlify.app`.

## Repo structure

Plain HTML, CSS and TypeScript with no front-end framework keeps the build fast and the agent's job simple. Vite bundles the front end so `redact.ts` can be shared with the function.

```text
fixit/
├── netlify.toml
├── package.json
├── tsconfig.json
├── vite.config.ts          # builds src/ into public/
├── .env.example            # ANTHROPIC_API_KEY=, LLM_MODEL=, MAX_INPUT_CHARS=
├── README.md               # pitch, screenshot, live link, how it works
├── src/
│   ├── index.html          # single page
│   ├── styles.css
│   ├── main.ts             # tabs, input, fetch, rendering
│   ├── render.ts           # JSON result to HTML (text only, no innerHTML)
│   ├── trimLog.ts          # dedupe and keep error-dense lines
│   └── samples.ts          # 3 errors + 3 logs for one-click demo
├── shared/
│   ├── redact.ts           # one set of rules for browser and server
│   └── schema.ts           # Zod schemas for request and both responses
├── netlify/
│   └── functions/
│       ├── analyse.mts     # validate, redact again, call LLM, validate reply
│       ├── llm.ts          # callLLM(): the only provider-specific file
│       └── prompts.ts      # explain and digest system prompts
└── tests/
    ├── redact.test.ts
    ├── trimLog.test.ts
    └── fixtures/           # sample errors and logs used by tests and demo
```

**Dependencies:** `@netlify/functions`, `@anthropic-ai/sdk`, `zod`; dev: `vite`, `typescript`, `vitest`, `netlify-cli`.

## Build plan

The plan reaches a deployed, working Explain mode by hour 2, so everything after that is improvement, not rescue. Each phase ends with a check that must pass before moving on.

1. **Hour 0 to 0.5: Set-up.** Create the repo, `netlify.toml`, Vite and TypeScript config, `.env` with the API key. Link the Netlify project and run `npx netlify dev`.
   - *Check:* a "hello" function answers at `localhost:8888/api/analyse`.
2. **Hour 0.5 to 1.5: Backend for Explain.** Write `schema.ts`, `prompts.ts`, `llm.ts` and `analyse.mts` with validation, the 25 second timeout and one JSON retry.
   - *Check:* `curl` with the `ModuleNotFoundError` sample returns valid JSON.
3. **Hour 1.5 to 2: Minimal front end and first deploy.** Text area, Analyse button, raw result rendering. Deploy to Netlify and add the environment variables.
   - *Check:* the live URL explains a sample error. **This is the safety net: you now have a submittable project.**
4. **Hour 2 to 3: Redaction and polish for Explain.** Shared `redact.ts`, the counter and preview, proper result card, copy buttons, danger badges, samples, loading and error states.
   - *Check:* the redaction tests pass and a pasted fake API key never reaches the function log.
5. **Hour 3 to 4: Log Digest.** Digest prompt and schema, `trimLog.ts`, file drop zone, issue list and the "Explain this" hand-off.
   - *Check:* the Nginx and Docker sample logs return sensible grouped issues.
6. **Hour 4 to 5: Hardening.** Rate limit config, security headers, mobile layout, dark mode, keyboard access, README with screenshot.
   - *Check:* the full test list below passes on the live site, on desktop and phone.
7. **Hour 5 to 6: Demo prep.** Record a 60 second screen capture as a backup, rehearse the demo script and submit.

If time runs short, cut from the bottom of the scope table: shareable links first, then the hand-off, then file upload. Never cut redaction.

## Testing

Twelve fixtures cover both modes, the privacy promise and the failure states; they double as the demo samples.

**Explain fixtures**

| # | Input | Expected result |
| --- | --- | --- |
| E1 | `ModuleNotFoundError: No module named 'requests'` | Install the package; check the virtual environment; confidence high |
| E2 | `EACCES: permission denied, mkdir '/usr/local/lib/node_modules'` | Explains global install permissions; any `sudo` step flagged dangerous |
| E3 | `fatal: refusing to merge unrelated histories` | Explains Git histories; mentions `--allow-unrelated-histories` with care |
| E4 | `Error establishing a database connection` (WordPress) | Checks `wp-config.php` credentials and database service status |
| E5 | `docker: Error response from daemon: port is already allocated` | Find and stop the process using the port, or map another port |
| E6 | "Hello, how are you?" | Says this is not an error; confidence low |

**Digest fixtures**

| # | Input | Expected result |
| --- | --- | --- |
| D1 | Nginx error log with repeated `connect() failed (111)` | Groups upstream errors with a count; points at the app process |
| D2 | Docker container log ending in `OOMKilled` | Root cause: memory limit |
| D3 | Clean systemd journal with only INFO lines | Verdict healthy |

**Safety and edge cases**

| # | Test | Pass when |
| --- | --- | --- |
| S1 | Input containing `sk-ant-test123...`, an email and `password=abc` | Counter shows 3; preview and function log show none of them |
| S2 | 9,000 character explain input | Clear "too long" message; no request sent |
| S3 | 15 requests in one minute | Requests 11 to 15 show the rate-limit message |

**Acceptance criteria**

- [ ] Live Netlify URL works on desktop Chrome and a phone browser.
- [ ] E1 to E6 and D1 to D3 give sensible, valid results.
- [ ] S1 to S3 pass.
- [ ] Median response under 10 seconds on the live site.
- [ ] No API key in the page source or network responses.
- [ ] README has the live link, a screenshot and a "How it works" section.

## Demo script and submission

The demo runs 90 seconds and shows the problem, both modes and the privacy feature, in that order.

1. **Hook (10 s):** "Error messages are written for machines. Fixit translates them for humans."
2. **Explain (30 s):** paste E2, the Node permission error. Point out the plain summary, the steps and the red badge on the `sudo` command.
3. **Privacy (15 s):** paste text with a fake API key and an email. Show "Secrets removed: 2" and the preview.
4. **Digest (25 s):** drop the Nginx log (D1). Show grouped issues and the root cause, then click "Explain this" on the top issue.
5. **Close (10 s):** "Free, no sign-up, live now at \[your URL\]. Next: the same engine as a terminal command."

**Submission checklist**

- [ ] Live Netlify link
- [ ] Public GitHub repo with README
- [ ] 60 second backup video in case the live demo fails
- [ ] One-paragraph description naming the theme (Simplify the Everyday)
- [ ] Note that it was built with AI coding agents, as the hackathon welcomes

## Risks, open questions and next phases

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Bad or unsafe fix suggested | User breaks their system | Danger badges, confidence level, footer disclaimer, prompt forbids invented paths |
| Secrets missed by redaction | Private data sent to the AI provider | Two-pass redaction, preview before sending, tests S1 |
| API cost spike from abuse | Unexpected bill | Netlify rate limit, size caps, provider spend limit |
| Slow or failed LLM reply on demo day | Weak demo | 25 second timeout with retry message, backup video |
| Model returns invalid JSON | Broken result card | Zod validation and one automatic retry |

**Open questions**

- Which LLM provider and key will you use? This PRD assumes Anthropic with Claude Haiku 5.5; only `llm.ts` and the environment variables change if not.
- Final product name and Netlify subdomain.

**After the hackathon**

1. **CLI:** `fixit explain` and `fixit logs` as an npm package that calls the same `/api/analyse` endpoint, with the same redaction module.
2. **Shareable results:** short links stored in Netlify Blobs with a 7 day expiry.
3. **Offline mode:** a CLI flag to use a local model through Ollama, so logs never leave the machine.
