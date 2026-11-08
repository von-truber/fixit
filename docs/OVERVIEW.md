# Fixit: how it works, what to look at, and why it's worth using

**Live:** https://fixit-errors.netlify.app · **Code:** https://github.com/von-truber/fixit

## In one paragraph

Fixit turns error messages and log files into answers a person can act on. Paste an error and you get a plain-English summary, the likely causes, numbered fix steps with copyable commands, and a way to check it worked. Paste or drop a log and you get the problems grouped and counted, the probable root cause and what to do next. Secrets are stripped out in your browser before anything is sent. There's nothing to install and no account to make, and it works on a phone.

---

## Why it's worth using

**Error messages are written for machines.** `EACCES: permission denied, mkdir '/usr/local/lib/node_modules'` tells an expert everything and a beginner nothing. Searching for it usually lands on a forum thread from years ago with five conflicting answers. Fixit gives one answer, in short sentences, specific to the error you pasted.

**It tells you when a fix is risky.** Any command that deletes data, changes permissions, uses `sudo`, force-pushes or edits system files gets a **⚠ HAZARD** badge and a warning line. Fixit puts the safe fix first and the risky shortcut last, labelled. Copying fixes from the internet usually does the opposite.

**It's safe to paste real output into.** Real error output contains real secrets: API keys in config dumps, passwords in connection strings, emails, IP addresses, home folder names. Fixit removes them before the text leaves your device. It shows you how many it caught and exactly what will be sent, then removes them again on the server. Most "paste your error into an AI" workflows skip this.

**It reads logs so you don't have to.** A 2,000-line log is mostly noise. Fixit folds repeated lines into one with an exact count, keeps the errors and the lines around them, and hands back a ranked list: "connection refused ×214, first seen 09:14:06". It also gives the probable root cause. Any issue can be sent to Explain with one click.

**It costs nothing to try.** You open the link, click a sample and press Run. A typical answer arrives in about 4 seconds.

**It's a bit of fun.** The page looks like a terminal, and fixing things earns XP. Fix steps are a checklist that "squashes the bug" when you finish it, and log problems appear as enemies with HP bars. This nudges people to actually work through the steps rather than skim them. It's purely cosmetic and stored only in your browser.

---

## Who it's for

| Person | What they paste | What they get |
| --- | --- | --- |
| **A student or beginner developer** | A Python traceback after cloning a repo | "Python can't find the `requests` library", then install it, check your virtual environment, and how to confirm the fix |
| **Someone who doesn't code** | An error from an installer or a WordPress site | Safe steps in plain words: check `wp-config.php`, check the database is running, when to contact the host |
| **A working developer in a hurry** | A Git, Docker or npm error they half-recognise | The exact command, with the safe option first, e.g. "find what's using port 8080, or map a different port" |
| **A support or ops engineer** | A noisy Nginx, Docker or systemd log | Issues grouped and counted, first-seen times, the root cause ("the app on port 3000 is down") and next moves |
| **A team lead or teacher** | Anything, then **copy as markdown** | A clean write-up to paste into a ticket, chat or lesson |

### Example use cases

1. **"It worked on my friend's laptop."** A student clones a project and runs it: `ModuleNotFoundError: No module named 'requests'`. Fixit explains that the library isn't installed, suggests `pip install -r requirements.txt` first, and mentions virtual environments.
2. **The `sudo` trap.** `npm install -g` fails with EACCES. The internet says `sudo`. Fixit offers the safe fix (a user-owned npm folder) first, and marks `sudo npm install -g` as a HAZARD alternative.
3. **The 3 a.m. log.** An on-call engineer drops a 1 MB Nginx error log. Fixit reports 214 "connection refused" errors to `127.0.0.1:3000` starting at 09:14:06, plus checkout requests cut off mid-response. Root cause: the app behind Nginx is down. Clicking **explain this** on the top issue gives the fix steps.
4. **The container that keeps dying.** A Docker log ends in `exited true 137` with OOMKilled. Fixit connects the rising heap warnings and long garbage-collection pauses to the 512 MiB memory limit, and names the job that pushed it over.
5. **Sharing an error safely.** Someone pastes a database error that happens to include `DATABASE_URL=postgres://jane:hunter2@...` and an API key. The privacy strip shows "4 secrets caught" and the preview shows `postgres://[REDACTED]@...` before anything is sent.

---

## How it works

```
┌──────────────── Browser ────────────────┐      ┌──────── Netlify Function ─────────┐      ┌─ AI provider ─┐
│ 1. paste / drop / pick a sample         │      │ 5. validate request (Zod)         │      │               │
│ 2. redact secrets           (redact.ts) │      │ 6. size limits (8k / 40k chars)   │      │               │
│ 3. logs: collapse + trim   (trimLog.ts) │ POST │ 7. redact again  (same redact.ts) │ ───► │ Claude Haiku  │
│ 4. show count + exact preview           │ ───► │ 8. build prompt     (prompts.ts)  │      │ 5.5 via the   │
│                                         │      │ 9. call model, 25 s    (llm.ts)   │ ◄─── │ Netlify AI    │
│ 12. render as text (render.ts)          │ ◄─── │ 10. parse, normalise, check       │      │ Gateway       │
│ 13. XP + achievements      (game.ts)    │ JSON │ 11. retry once if incomplete      │      │               │
└─────────────────────────────────────────┘      └───────────────────────────────────┘      └───────────────┘
        rate limited by Netlify before the function runs: 10 per minute per visitor
```

### Explain Error, step by step

1. **Input.** You paste up to 8,000 characters. You can also choose an environment (`--env`, e.g. node.js) and say what you were trying to do (`--context`).
2. **Redaction in the browser.** Rules for ten kinds of secret run on every keystroke, in a fixed order: private keys, credentials in connection strings, auth headers, JWTs, API keys (`sk-…`, `ghp_…`, `AKIA…`, `xox…`, `AIza…`), `password=`-style values, emails, IPv4 and IPv6 addresses, user names in home-folder paths, and long random tokens. Each match becomes a placeholder such as `[API_KEY]`. Loopback addresses (`127.0.0.1`, `0.0.0.0`, `::1`) are kept because they help diagnosis and identify no one. The page shows the count by type and the exact text it will send.
3. **Request.** `POST /api/analyse` with `{mode, input, environment, context}`.
4. **Server checks.** The function validates the shape with Zod and enforces the size limit (413 if too long). It then runs the same redaction again, in case a request skipped the page.
5. **Prompt.** A system prompt asks for a beginner-friendly answer in a fixed JSON shape, with rules: summary under 20 words, at most 4 causes and 6 steps, and `dangerous: true` for risky commands. It also says not to invent file paths or package names, and to say so when the input isn't an error.
6. **Model call.** Claude Haiku 5.5, a 25-second timeout, and extended thinking off (see below).
7. **Checking the reply.** The function pulls the JSON object out of the reply and tidies harmless variations: "High" becomes high, "warn" becomes warning, and an empty command becomes null. It then validates against the schema. It also rejects replies that are valid but empty, such as a blank summary or no fix steps when confidence isn't low. If either check fails, it asks once more and says why, e.g. "Your last reply was incomplete (summary or meaning is empty)". Two failures return a 502 and the page offers Retry.
8. **Rendering.** Every string from the model goes into the page as plain text, never as HTML, so a malicious reply can't inject markup. Commands get a copy button; dangerous steps get the HAZARD badge.

### Log Digest, step by step

1. **Input.** Paste a log, or drop or choose a `.log` / `.txt` file up to 1 MB.
2. **Redaction.** The same rules as above, over the whole file.
3. **Collapse.** Lines that differ only in timestamps, numbers, IDs or quoted values (URLs, hosts) are folded into one line ending `[214 occurrences in total including this one, last at …]`. This shrinks the sample Nginx log from 62 kB to 3 kB, and gives the model exact counts so it never has to add numbers up.
4. **Trim.** If the log is still over 40,000 characters, lines are kept by priority until the budget is full: the first and last lines (start-up and how it died), errors, the two lines around each error, warnings, then everything else, newest first. Gaps are marked `... [N lines omitted] ...`, and the privacy strip says what was trimmed.
5. **Model.** A log-specific prompt groups lines into at most 8 issues with a severity, a count, a first-seen time and a sample line. It adds a verdict (healthy, warnings or errors), a root cause ("unclear from this excerpt" when it is) and next steps.
6. **Rendering.** Each issue is an "enemy" with a severity tag and an HP bar sized by its count. **explain this** sends the issue's sample line, with context, to Explain Error and runs it. The log result stays when you switch back.

### The game layer

Everything here lives in [`src/game.ts`](../src/game.ts) and the browser's local storage, and none of it is sent anywhere.

- **XP:**
  - +20 per diagnosis, +30 per log digest.
  - +5 per secret caught, capped at +25.
  - +5 per ticked step, +25 for ticking every step ("bug squashed").
- **Levels:** XP thresholds are 100, 250, 450 and so on. Titles go Newbie → Tinkerer → Debugger → Bug Hunter → Stack Tracer → Log Whisperer → Kernel Sage.
- **Six achievements:**
  - Hello, World: your first analysis.
  - Secret Keeper: a secret was redacted.
  - Exterminator: every step of a fix ticked.
  - Log Diver: your first log.
  - Boss Hunter: used explain this.
  - Read The Manual: ticked a HAZARD step.
- **Rewards can't be farmed:** each step pays out once, and finishing a quest pays its bonus once.

---

## The parts to look at

In order of what matters most.

| File | What it does | Why it's interesting |
| --- | --- | --- |
| [`shared/redact.ts`](../shared/redact.ts) | The redaction rules (ten kinds of secret) | The privacy promise lives here. One file is used by both browser and server, so the rules can't drift apart. Order matters: whole blocks first, broad patterns last, so a password inside a connection string is caught as one item. |
| [`netlify/functions/analyse/analyse.mts`](../netlify/functions/analyse/analyse.mts) | The API endpoint | Validation, size limits, second redaction, the retry loop, the completeness check, the rate-limit config, and logging that records only metadata. |
| [`src/trimLog.ts`](../src/trimLog.ts) | Collapse and trim logs | Turns a 1 MB log into what fits in the model's budget without losing the important lines, and gives the model exact counts. |
| [`netlify/functions/analyse/prompts.ts`](../netlify/functions/analyse/prompts.ts) | The two system prompts | Where answer quality is tuned: length rules, the danger rule, "don't invent paths", how to read the collapse markers. |
| [`netlify/functions/analyse/llm.ts`](../netlify/functions/analyse/llm.ts) | `callLLM()` | The only provider-specific file. Swapping to another provider means changing this file and two environment variables. |
| [`shared/schema.ts`](../shared/schema.ts) | Zod schemas | One definition of the request and both response shapes, shared by page and function. |
| [`src/main.ts`](../src/main.ts) | Page logic | Tabs, the redact-and-preview loop, file drop, loading states, error messages, the explain this hand-off. |
| [`src/render.ts`](../src/render.ts) | Results to the page | Builds quests and raids from the JSON using text only, never `innerHTML`. |
| [`src/game.ts`](../src/game.ts) | XP, levels, achievements | Self-contained; works without storage (e.g. in private windows). |
| [`src/styles.css`](../src/styles.css) | Look and feel | Two themes driven by CSS variables (phosphor terminal and paper terminal), a phone layout, reduced-motion support. |
| [`netlify.toml`](../netlify.toml) | Build and headers | Strict Content-Security-Policy (only the site's own files), no framing, permissions locked down. |
| [`tests/`](../tests) and [`scripts/smoke.mts`](../scripts/smoke.mts) | Tests | 81 unit tests, plus a live script that runs all the sample errors and logs and reports timings. |

---

## Design decisions worth knowing

- **Thinking is switched off.** Through Netlify's AI Gateway, the model's hidden "thinking" tokens counted against the answer's token limit and cut replies off mid-JSON. Turning it off fixed every failure and brought the median live reply from about 11 s to **3.7 s**.
- **Structured-output mode is off by default.** Through the gateway it returned valid-but-empty JSON about half the time. A clear prompt, validated with Zod afterwards, gave complete answers every time. It can be switched back on with `LLM_STRUCTURED_OUTPUT=on`.
- **A shape check isn't enough.** A reply can match the schema and still be useless, so the function also checks the content is there before accepting it.
- **Counts come from code, not the model.** When the model had to add up several groups of repeated lines it got 214 wrong (261). Now the browser folds them into one exact count, and the prompt says to use it.
- **Plain HTML, CSS and TypeScript.** No framework, so the page script is about 100 kB, most of it the three sample logs.
- **Nothing is stored.** There's no database, and request bodies are never logged. Function logs record mode, input length, time and status.

---

## How it holds up

| Check | Result |
| --- | --- |
| Six sample errors (Python, npm, Git, WordPress, Docker, "Hello") | All correct on the first try; risky steps flagged; "Hello" gets low confidence |
| Three sample logs (Nginx, Docker OOM, clean systemd) | Exact counts; correct root causes; the clean log is "healthy" |
| Secrets test (fake key, email, password) | Counter shows 3; none appear in the preview or the live function logs |
| 9,000-character input | Blocked with a clear message; nothing sent |
| Response time (live, 9 samples, one at a time) | Median 3.7 s, slowest 5.5 s |
| API key exposure | Not in the page, its scripts or any response |
| Phone, dark and light mode, keyboard only | Checked |

The rate limit (10 per minute per visitor) works but is approximate. Netlify's counter can let a request or two through before it catches up.

---

## Limits

- **Answers can be wrong.** Fixit advises and you decide; read every command, especially those marked HAZARD.
- **Size limits:** 8,000 characters for an error, 1 MB for a log file (40,000 characters sent after trimming).
- **Redaction is pattern-based.** It catches common secret shapes, not every possible one; the preview is there so you can check.
- **Answers only:** Fixit never runs anything on your machine.

## What could come next

- A **terminal command** (`fixit explain`, `fixit logs`) that calls the same API, so you can pipe an error straight in.
- **Shareable result links** that expire after a week.
- An **offline mode** using a local model, so logs never leave the machine at all.
