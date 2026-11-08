import "@fontsource/jetbrains-mono/latin-400.css";
import "@fontsource/jetbrains-mono/latin-700.css";
import "@fontsource/press-start-2p/latin-400.css";
import { LIMITS } from "../shared/limits.ts";
import { redact, type RedactionKind } from "../shared/redact.ts";
import type { DigestResponse, ExplainResponse, Mode } from "../shared/schema.ts";
import { addXp, bump, renderHud, resetProgress, unlock } from "./game.ts";
import { copyText, digestToMarkdown, el, explainToMarkdown, renderDigest, renderExplain, type DigestIssue } from "./render.ts";
import { DIGEST_SAMPLES, EXPLAIN_SAMPLES } from "./samples.ts";
import { trimLog } from "./trimLog.ts";

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

const tabs = [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
const panel = $<HTMLDivElement>("#panel");
const input = $<HTMLTextAreaElement>("#input");
const inputLabel = $<HTMLLabelElement>("#input-label");
const inputCard = $<HTMLElement>("#input-card");
const environment = $<HTMLSelectElement>("#environment");
const context = $<HTMLInputElement>("#context");
const explainFields = $<HTMLDivElement>("#explain-fields");
const dropZone = $<HTMLDivElement>("#drop-zone");
const fileInput = $<HTMLInputElement>("#file-input");
const fileName = $<HTMLParagraphElement>("#file-name");
const charCount = $<HTMLSpanElement>("#char-count");
const sampleButtons = $<HTMLDivElement>("#sample-buttons");
const redactCount = $<HTMLElement>("#redact-count");
const redactKinds = $<HTMLSpanElement>("#redact-kinds");
const trimLine = $<HTMLParagraphElement>("#trim-line");
const previewText = $<HTMLPreElement>("#preview-text");
const analyseButton = $<HTMLButtonElement>("#analyse");
const buttonLabel = analyseButton.querySelector<HTMLSpanElement>(".button-label")!;
const status = $<HTMLParagraphElement>("#status");
const results: Record<Mode, HTMLDivElement> = {
  explain: $<HTMLDivElement>("#result-explain"),
  digest: $<HTMLDivElement>("#result-digest"),
};

const MAX_FILE_BYTES = 1024 * 1024;

const KIND_LABELS: Record<RedactionKind, string> = {
  private_key: "private key",
  connection_string: "connection string",
  auth_header: "auth header",
  jwt: "JWT",
  api_key: "API key",
  secret_value: "password or secret",
  email: "email",
  ip: "IP address",
  home_dir: "user name in path",
  token: "token",
};

const KIND_PLURALS: Record<RedactionKind, string> = {
  private_key: "private keys",
  connection_string: "connection strings",
  auth_header: "auth headers",
  jwt: "JWTs",
  api_key: "API keys",
  secret_value: "passwords or secrets",
  email: "emails",
  ip: "IP addresses",
  home_dir: "user names in paths",
  token: "tokens",
};

const MODE_TEXT = {
  explain: {
    label: "stdin ← your error message",
    placeholder: "paste an error message, stack trace or command output",
    loading: ["reading your error", "parsing stack trace", "consulting the docs", "writing your fix"],
  },
  digest: {
    label: "stdin ← your log",
    placeholder: "paste a log here, or drop a .log / .txt file below",
    loading: ["reading your log", "grouping repeats", "tracking down the boss", "writing the report"],
  },
} as const;

const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

let mode: Mode = "explain";
let busy = false;
/** Each mode keeps its own text, so the Explain hand-off never wipes a log. */
const drafts: Record<Mode, string> = { explain: "", digest: "" };

interface Prepared {
  input: string;
  context: string;
  count: number;
  byKind: Partial<Record<RedactionKind, number>>;
  tooLong: string | null;
  trim: ReturnType<typeof trimLog> | null;
}

/** Exactly what will be sent, recomputed on every edit. */
function prepare(): Prepared {
  const main = redact(input.value);
  const byKind: Prepared["byKind"] = { ...main.byKind };
  let count = main.count;

  if (mode === "digest") {
    const tooBig = input.value.length > MAX_FILE_BYTES;
    const trim = tooBig ? null : trimLog(main.text, LIMITS.digest);
    return {
      input: trim?.text ?? "",
      context: "",
      count,
      byKind,
      tooLong: tooBig ? "That log is over 1 MB. Trim it to the part around the problem first." : null,
      trim,
    };
  }

  const ctx = redact(context.value);
  for (const [kind, n] of Object.entries(ctx.byKind) as [RedactionKind, number][]) {
    byKind[kind] = (byKind[kind] ?? 0) + n;
  }
  count += ctx.count;
  const tooLong =
    main.text.length > LIMITS.explain
      ? `Too long: ${main.text.length.toLocaleString()} characters. Explain Error takes up to ${LIMITS.explain.toLocaleString()}; trim it to the error and the lines around it, or use Log Digest.`
      : null;
  return { input: main.text, context: ctx.text, count, byKind, tooLong, trim: null };
}

function setStatus(message: string, kind: "info" | "error" = "info", retry = false) {
  status.replaceChildren(message);
  status.className = `status ${kind === "error" ? "status-error" : ""}`;
  status.dataset.retry = String(retry);
  if (retry) {
    const button = el("button", { type: "button", class: "secondary" }, "Retry");
    button.addEventListener("click", analyse);
    status.append(" ", button);
  }
}

function refresh() {
  const p = prepare();

  if (mode === "explain") {
    charCount.textContent = `${p.input.length.toLocaleString()} / ${LIMITS.explain.toLocaleString()}`;
  } else {
    const lines = p.trim?.originalLines ?? 0;
    charCount.textContent = input.value ? `${lines.toLocaleString()} line${lines === 1 ? "" : "s"}` : "";
  }
  charCount.classList.toggle("over", Boolean(p.tooLong));

  redactCount.textContent = String(p.count);
  redactKinds.textContent =
    p.count === 0
      ? ""
      : "(" +
        (Object.entries(p.byKind) as [RedactionKind, number][])
          .map(([kind, n]) => `${n} ${n === 1 ? KIND_LABELS[kind] : KIND_PLURALS[kind]}`)
          .join(", ") +
        ")";

  const t = p.trim;
  trimLine.hidden = !(t && (t.collapsedLines || t.trimmed));
  if (t && !trimLine.hidden) {
    const parts = [`${t.originalLines.toLocaleString()} lines → ${t.outputLines.toLocaleString()} sent`];
    if (t.collapsedLines) parts.push(`${t.collapsedLines.toLocaleString()} repeats collapsed`);
    if (t.trimmed) parts.push(`${t.omittedLines.toLocaleString()} quieter lines left out to fit`);
    trimLine.textContent = `[≋] trim: ${parts.join(", ")}`;
  }

  previewText.textContent = p.input || "(empty) nothing to send yet";

  analyseButton.disabled = busy || p.input.trim().length === 0 || Boolean(p.tooLong);
  if (busy) return;
  if (p.tooLong) setStatus(p.tooLong, "error");
  else if (status.classList.contains("status-error") && status.dataset.retry !== "true") setStatus("");
}

let refreshTimer = 0;
function scheduleRefresh() {
  // Large logs: avoid re-redacting on every keystroke.
  clearTimeout(refreshTimer);
  if (input.value.length < 20_000) refresh();
  else refreshTimer = window.setTimeout(refresh, 150);
}

let loadingTimer = 0;
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function setBusy(value: boolean) {
  busy = value;
  analyseButton.classList.toggle("loading", value);
  results[mode].setAttribute("aria-busy", String(value));
  for (const tab of tabs) tab.disabled = value;
  clearInterval(loadingTimer);
  if (value) {
    // Terminal-style spinner with rotating messages; the text alone carries the meaning.
    const messages = MODE_TEXT[mode].loading;
    let tick = 0;
    const draw = () => {
      const frame = reducedMotion ? "…" : SPINNER[tick % SPINNER.length];
      buttonLabel.textContent = `${frame} ${messages[Math.floor(tick / 12) % messages.length]}...`;
      tick++;
    };
    draw();
    loadingTimer = window.setInterval(draw, 90);
  } else {
    buttonLabel.textContent = "▶ RUN";
  }
  refresh();
}

const ERRORS: Record<number, { message: string; retry: boolean }> = {
  413: { message: "That input is too long for Fixit.", retry: false },
  429: { message: "Too many requests, try again in a minute.", retry: true },
  502: { message: "The AI service couldn't produce an answer.", retry: true },
  504: { message: "The AI service took too long to answer.", retry: true },
};

async function analyse() {
  if (busy) return;
  const p = prepare();
  if (!p.input.trim() || p.tooLong) return;
  const requestMode = mode;

  setBusy(true);
  setStatus("");
  try {
    const res = await fetch("/api/analyse", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        requestMode === "explain"
          ? { mode: "explain", input: p.input, environment: environment.value, context: p.context.trim() || undefined }
          : { mode: "digest", input: p.input },
      ),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      const known = ERRORS[res.status];
      const message = known?.message ?? body?.message ?? `Something went wrong (error ${res.status}).`;
      setStatus(message, "error", known?.retry ?? res.status >= 500);
      return;
    }
    if (requestMode === "explain") showExplain(body as ExplainResponse);
    else showDigest(body as DigestResponse);
    reward(requestMode, p.count);
  } catch {
    setStatus("Couldn't reach Fixit. Check your connection.", "error", true);
  } finally {
    setBusy(false);
  }
}

/** XP and achievements for a successful analysis. */
function reward(requestMode: Mode, secrets: number) {
  unlock("hello_world");
  if (requestMode === "explain") addXp(20, "diagnosis");
  else {
    addXp(30, "log digested");
    bump("logs");
    unlock("log_diver");
  }
  if (secrets > 0) {
    bump("secrets", secrets);
    setTimeout(() => addXp(Math.min(25, secrets * 5), `${secrets} secret${secrets > 1 ? "s" : ""} caught`), 350);
    unlock("secret_keeper");
  }
}

function showCard(target: Mode, card: HTMLElement, markdown: string) {
  const copyAll = el("button", { type: "button", class: "secondary" }, "copy as markdown");
  copyAll.addEventListener("click", () => copyText(markdown, copyAll));
  card.querySelector(".result-meta")!.append(copyAll);
  results[target].replaceChildren(card);
  // Move focus to the answer so keyboard and screen-reader users land on it.
  const title = card.querySelector<HTMLElement>("#result-title");
  title?.setAttribute("tabindex", "-1");
  title?.focus({ preventScroll: true });
  card.scrollIntoView({ behavior: "smooth", block: "start" });
}

function showExplain(data: ExplainResponse) {
  // Each step pays out once, and finishing the whole quest pays a bonus once.
  const paid = new Set<object>();
  let squashed = false;
  const card = renderExplain(data, {
    onStep(step, checked, done, total) {
      if (checked && !paid.has(step)) {
        paid.add(step);
        addXp(5, "step done");
        if (step.dangerous) unlock("rtfm");
      }
      if (done === total && !squashed) {
        squashed = true;
        bump("fixes");
        setTimeout(() => addXp(25, "BUG SQUASHED"), 300);
        unlock("exterminator");
      }
    },
  });
  showCard("explain", card, explainToMarkdown(data));
}

function showDigest(data: DigestResponse) {
  showCard("digest", renderDigest(data, explainIssue), digestToMarkdown(data));
}

/** "Explain this": send one digest issue to Explain Error and run it. */
function explainIssue(issue: DigestIssue) {
  unlock("boss_hunter");
  setMode("explain");
  input.value = issue.sample;
  environment.value = "auto";
  const seen = issue.count === 1 ? "once" : `${issue.count} times`;
  context.value = `This line comes from a log. The issue: ${issue.title} (seen ${seen}).`.slice(0, LIMITS.context);
  refresh();
  window.scrollTo({ top: 0, behavior: "smooth" });
  analyse();
}

function renderSamples() {
  sampleButtons.replaceChildren();
  if (mode === "explain") {
    for (const sample of EXPLAIN_SAMPLES.filter((s) => s.featured)) {
      const button = el("button", { type: "button", class: "chip" }, el("span", { "aria-hidden": "true" }, "> "), sample.label.toLowerCase());
      button.addEventListener("click", () => {
        input.value = sample.input;
        environment.value = sample.environment;
        context.value = sample.context ?? "";
        refresh();
        input.focus();
      });
      sampleButtons.append(button);
    }
  } else {
    for (const sample of DIGEST_SAMPLES) {
      const button = el("button", { type: "button", class: "chip" }, el("span", { "aria-hidden": "true" }, "> "), sample.label.toLowerCase());
      button.addEventListener("click", () => {
        input.value = sample.input;
        fileName.textContent = `loaded sample: ${sample.fileName}`;
        refresh();
        input.focus();
      });
      sampleButtons.append(button);
    }
  }
}

function setMode(next: Mode) {
  if (next === mode) return;
  drafts[mode] = input.value;
  mode = next;
  input.value = drafts[mode];

  for (const tab of tabs) {
    const selected = tab.dataset.mode === mode;
    tab.setAttribute("aria-selected", String(selected));
    tab.tabIndex = selected ? 0 : -1;
    if (selected) panel.setAttribute("aria-labelledby", tab.id);
  }
  inputLabel.textContent = MODE_TEXT[mode].label;
  input.placeholder = MODE_TEXT[mode].placeholder;
  explainFields.hidden = mode !== "explain";
  dropZone.hidden = mode !== "digest";
  results.explain.hidden = mode !== "explain";
  results.digest.hidden = mode !== "digest";
  if (mode === "explain") fileName.textContent = "";
  renderSamples();
  setStatus("");
  refresh();
}

async function loadFile(file: File) {
  if (mode !== "digest") setMode("digest");
  if (file.size > MAX_FILE_BYTES) {
    setStatus(`${file.name} is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is 1 MB.`, "error");
    return;
  }
  if (!/\.(log|txt)$/i.test(file.name) && file.type && !file.type.startsWith("text/")) {
    setStatus("Please choose a .log or .txt file.", "error");
    return;
  }
  input.value = await file.text();
  fileName.textContent = `loaded ${file.name} (${(file.size / 1024).toFixed(0)} KB)`;
  setStatus("");
  refresh();
}

// Tabs: click and arrow keys.
tabs.forEach((tab, i) => {
  tab.addEventListener("click", () => setMode(tab.dataset.mode as Mode));
  tab.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft" && e.key !== "Home" && e.key !== "End") return;
    e.preventDefault();
    const next =
      e.key === "Home" ? 0 : e.key === "End" ? tabs.length - 1 : (i + (e.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
    tabs[next].focus();
    setMode(tabs[next].dataset.mode as Mode);
  });
});

// File upload and drag-and-drop anywhere on the input card.
fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0];
  if (file) loadFile(file);
  fileInput.value = "";
});
for (const target of [inputCard]) {
  target.addEventListener("dragover", (e) => {
    if (!e.dataTransfer?.types.includes("Files")) return;
    e.preventDefault();
    inputCard.classList.add("dragging");
  });
  target.addEventListener("dragleave", (e) => {
    if (!inputCard.contains(e.relatedTarget as Node)) inputCard.classList.remove("dragging");
  });
  target.addEventListener("drop", (e) => {
    const file = e.dataTransfer?.files[0];
    inputCard.classList.remove("dragging");
    if (!file) return;
    e.preventDefault();
    loadFile(file);
  });
}

input.addEventListener("input", scheduleRefresh);
context.addEventListener("input", refresh);
analyseButton.addEventListener("click", analyse);
input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) analyse();
});

input.placeholder = MODE_TEXT.explain.placeholder;
inputLabel.textContent = MODE_TEXT.explain.label;
document.getElementById("reset-progress")!.addEventListener("click", () => {
  if (window.confirm("Reset your XP, stats and achievements?")) resetProgress();
});
renderHud();
renderSamples();
refresh();
