import { LIMITS } from "../shared/limits.ts";

const input = document.querySelector<HTMLTextAreaElement>("#input")!;
const button = document.querySelector<HTMLButtonElement>("#analyse")!;
const status = document.querySelector<HTMLSpanElement>("#status")!;
const result = document.querySelector<HTMLElement>("#result")!;
const output = document.querySelector<HTMLPreElement>("#output")!;

let busy = false;

function setStatus(text: string, isError = false) {
  status.textContent = text;
  status.classList.toggle("error", isError);
}

function refresh() {
  const length = input.value.trim().length;
  button.disabled = busy || length === 0;
  if (!busy && length > LIMITS.explain) {
    setStatus(`Too long: ${length.toLocaleString()} of ${LIMITS.explain.toLocaleString()} characters.`, true);
    button.disabled = true;
  } else if (!busy) {
    setStatus("");
  }
}

const ERROR_MESSAGES: Record<number, string> = {
  413: "That input is too long.",
  429: "Too many requests, try again in a minute.",
  502: "The AI service failed to answer. Please retry.",
  504: "The AI service took too long. Please retry.",
};

async function analyse() {
  busy = true;
  refresh();
  setStatus("Reading your error...");
  try {
    const res = await fetch("/api/analyse", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "explain", input: input.value }),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      setStatus(ERROR_MESSAGES[res.status] ?? body?.message ?? `Something went wrong (${res.status}).`, true);
      return;
    }
    // Phase 3: raw rendering. textContent keeps model output as plain text.
    output.textContent = JSON.stringify(body, null, 2);
    result.hidden = false;
    setStatus("");
  } catch {
    setStatus("Could not reach Fixit. Check your connection and retry.", true);
  } finally {
    busy = false;
    button.disabled = input.value.trim().length === 0;
  }
}

input.addEventListener("input", refresh);
button.addEventListener("click", analyse);
refresh();
