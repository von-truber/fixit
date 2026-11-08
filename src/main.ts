import { LIMITS } from "../shared/limits.ts";
import { redact, type RedactionKind } from "../shared/redact.ts";
import type { ExplainResponse } from "../shared/schema.ts";
import { copyText, el, explainToMarkdown, renderExplain } from "./render.ts";
import { EXPLAIN_SAMPLES } from "./samples.ts";

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

const input = $<HTMLTextAreaElement>("#input");
const environment = $<HTMLSelectElement>("#environment");
const context = $<HTMLInputElement>("#context");
const charCount = $<HTMLSpanElement>("#char-count");
const sampleButtons = $<HTMLDivElement>("#sample-buttons");
const redactCount = $<HTMLElement>("#redact-count");
const redactKinds = $<HTMLSpanElement>("#redact-kinds");
const previewText = $<HTMLPreElement>("#preview-text");
const analyseButton = $<HTMLButtonElement>("#analyse");
const buttonLabel = analyseButton.querySelector<HTMLSpanElement>(".button-label")!;
const status = $<HTMLParagraphElement>("#status");
const result = $<HTMLDivElement>("#result");

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

let busy = false;

/** What will actually be sent, recomputed on every edit. */
function prepared() {
  const main = redact(input.value);
  const ctx = redact(context.value);
  const byKind: Partial<Record<RedactionKind, number>> = { ...main.byKind };
  for (const [kind, n] of Object.entries(ctx.byKind) as [RedactionKind, number][]) {
    byKind[kind] = (byKind[kind] ?? 0) + n;
  }
  return { input: main.text, context: ctx.text, count: main.count + ctx.count, byKind };
}

function setStatus(message: string, kind: "info" | "error" = "info", retry = false) {
  status.replaceChildren(message);
  status.className = `status ${kind === "error" ? "status-error" : ""}`;
  if (retry) {
    const button = el("button", { type: "button", class: "secondary" }, "Retry");
    button.addEventListener("click", analyse);
    status.append(" ", button);
  }
}

function refresh() {
  const p = prepared();
  const length = p.input.trim().length;
  const tooLong = p.input.length > LIMITS.explain;

  charCount.textContent = `${p.input.length.toLocaleString()} / ${LIMITS.explain.toLocaleString()}`;
  charCount.classList.toggle("over", tooLong);

  redactCount.textContent = String(p.count);
  redactKinds.textContent =
    p.count === 0
      ? ""
      : "(" +
        (Object.entries(p.byKind) as [RedactionKind, number][])
          .map(([kind, n]) => `${n} ${KIND_LABELS[kind]}${n > 1 ? "s" : ""}`)
          .join(", ") +
        ")";
  previewText.textContent = p.input || "Nothing to send yet.";

  analyseButton.disabled = busy || length === 0 || tooLong;
  if (busy) return;
  if (tooLong) {
    setStatus(
      `Too long: ${p.input.length.toLocaleString()} characters. Explain Error takes up to ${LIMITS.explain.toLocaleString()}; trim it to the error and the lines around it.`,
      "error",
    );
  } else if (status.classList.contains("status-error") && !status.querySelector("button")) {
    setStatus("");
  }
}

function setBusy(value: boolean) {
  busy = value;
  analyseButton.classList.toggle("loading", value);
  buttonLabel.textContent = value ? "Reading your error..." : "Analyse";
  result.setAttribute("aria-busy", String(value));
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
  const p = prepared();
  if (!p.input.trim() || p.input.length > LIMITS.explain) return;

  setBusy(true);
  setStatus("");
  try {
    const res = await fetch("/api/analyse", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "explain",
        input: p.input,
        environment: environment.value,
        context: p.context.trim() || undefined,
      }),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      const known = ERRORS[res.status];
      const message = known?.message ?? body?.message ?? `Something went wrong (error ${res.status}).`;
      setStatus(message, "error", known?.retry ?? res.status >= 500);
      return;
    }
    showResult(body as ExplainResponse);
  } catch {
    setStatus("Couldn't reach Fixit. Check your connection.", "error", true);
  } finally {
    setBusy(false);
  }
}

function showResult(data: ExplainResponse) {
  const card = renderExplain(data);
  const copyAll = el("button", { type: "button", class: "secondary" }, "Copy as Markdown");
  copyAll.addEventListener("click", () => copyText(explainToMarkdown(data), copyAll));
  card.querySelector(".result-header")!.append(copyAll);
  result.replaceChildren(card);
  card.scrollIntoView({ behavior: "smooth", block: "start" });
}

for (const sample of EXPLAIN_SAMPLES.filter((s) => s.featured)) {
  const button = el("button", { type: "button", class: "chip" }, sample.label);
  button.addEventListener("click", () => {
    input.value = sample.input;
    environment.value = sample.environment;
    context.value = sample.context ?? "";
    refresh();
    input.focus();
  });
  sampleButtons.append(button);
}

input.addEventListener("input", refresh);
context.addEventListener("input", refresh);
analyseButton.addEventListener("click", analyse);
input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) analyse();
});
refresh();
