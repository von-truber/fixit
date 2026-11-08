// JSON result to DOM. Every model string goes in via textContent, never innerHTML.
import type { DigestResponse, ExplainResponse } from "../shared/schema.ts";

type Child = Node | string | null | undefined | false;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === "class") node.className = value;
    else node.setAttribute(key, value);
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    node.append(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return node;
}

export async function copyText(text: string, button: HTMLButtonElement) {
  const original = button.textContent;
  try {
    await navigator.clipboard.writeText(text);
    button.textContent = "copied";
  } catch {
    button.textContent = "copy failed";
  }
  setTimeout(() => (button.textContent = original), 1500);
}

function copyButton(text: string, label: string, ariaLabel: string) {
  const button = el("button", { type: "button", class: "copy", "aria-label": ariaLabel }, label);
  button.addEventListener("click", () => copyText(text, button));
  return button;
}

const CONFIDENCE_LABEL = { high: "High", medium: "Medium", low: "Low" } as const;
const CONFIDENCE_PIPS = { high: 5, medium: 3, low: 1 } as const;

/** A 5-pip stat bar, e.g. CONFIDENCE ▰▰▰▱▱ MEDIUM. The text says the value too. */
function statBar(label: string, filled: number, value: string, tone: string) {
  const pips = el("span", { class: "pips", "aria-hidden": "true" });
  for (let i = 0; i < 5; i++) pips.append(el("i", { class: i < filled ? "on" : "" }));
  return el("span", { class: `stat stat-${tone}` }, el("span", { class: "stat-label" }, label), pips, el("strong", {}, value));
}

function section(title: string, ...body: Child[]) {
  return el("section", { class: "result-section" }, el("h3", {}, el("span", { "aria-hidden": "true" }, "## "), title), ...body);
}

// ---------- Explain: a quest ----------

export interface QuestEvents {
  /** A step was ticked or unticked; `done` is how many are ticked now. */
  onStep(step: ExplainResponse["fix_steps"][number], checked: boolean, done: number, total: number): void;
}

export function renderExplain(data: ExplainResponse, events: QuestEvents): HTMLElement {
  const total = data.fix_steps.length;
  const progressFill = el("span", { class: "quest-fill" });
  const progressText = el("span", { class: "quest-count" }, `0/${total}`);
  const progress = el(
    "div",
    { class: "quest-progress", role: "progressbar", "aria-label": "Steps done", "aria-valuemin": "0", "aria-valuemax": String(total), "aria-valuenow": "0" },
    el("span", { class: "quest-track" }, progressFill),
    progressText,
  );

  const steps = el("ol", { class: "steps" });
  data.fix_steps.forEach((step, i) => {
    const id = `step-${i}-${Math.random().toString(36).slice(2, 7)}`;
    const box = el("input", { type: "checkbox", id, class: "step-check" });
    const li = el(
      "li",
      { class: step.dangerous ? "step dangerous" : "step" },
      el(
        "div",
        { class: "step-head" },
        box,
        el(
          "label",
          { for: id, class: "step-text" },
          el("span", { class: "step-num", "aria-hidden": "true" }, String(i + 1).padStart(2, "0")),
          el("span", { class: "step-body" }, step.dangerous && el("span", { class: "badge badge-hazard" }, "⚠ HAZARD"), step.step),
        ),
      ),
    );
    if (step.command) {
      li.append(
        el(
          "div",
          { class: "command" },
          el("pre", {}, el("code", {}, el("span", { class: "cmd-prompt", "aria-hidden": "true" }, "$ "), step.command)),
          copyButton(step.command, "copy", `Copy command for step ${i + 1}`),
        ),
      );
      if (step.dangerous) {
        li.append(el("p", { class: "danger-note" }, "This can delete data, change permissions or needs admin rights. Read it before running it."));
      }
    }
    box.addEventListener("change", () => {
      li.classList.toggle("done", box.checked);
      const done = steps.querySelectorAll(".step-check:checked").length;
      progressFill.style.width = `${(done / total) * 100}%`;
      progressText.textContent = `${done}/${total}`;
      progress.setAttribute("aria-valuenow", String(done));
      progress.classList.toggle("complete", done === total);
      events.onStep(step, box.checked, done, total);
    });
    steps.append(li);
  });

  const tone = data.confidence === "high" ? "good" : data.confidence === "medium" ? "warn" : "bad";
  return el(
    "article",
    { class: "result-card quest" },
    el(
      "header",
      { class: "result-header" },
      el("p", { class: "eyebrow" }, el("span", { class: "eyebrow-tag" }, "QUEST"), "diagnosis complete"),
      el("h2", { id: "result-title" }, data.summary),
      el(
        "div",
        { class: "result-meta" },
        statBar("CONFIDENCE", CONFIDENCE_PIPS[data.confidence], CONFIDENCE_LABEL[data.confidence].toUpperCase(), tone),
        el("span", { class: "env-tag" }, `env: ${data.detected_environment}`),
      ),
    ),
    section("what it means", el("p", {}, data.meaning)),
    data.causes.length > 0 &&
      section(
        "suspects",
        el(
          "ol",
          { class: "suspects" },
          ...data.causes.map((c, i) => el("li", {}, el("span", { class: "rank", "aria-hidden": "true" }, `#${i + 1}`), el("span", {}, c))),
        ),
      ),
    total > 0 && section("fix it", el("p", { class: "quest-hint" }, "Tick each step as you do it."), progress, steps),
    data.verify && section("win condition", el("p", { class: "verify" }, el("span", { "aria-hidden": "true" }, "✔ "), data.verify)),
  );
}

export function explainToMarkdown(data: ExplainResponse): string {
  const lines = [`## ${data.summary}`, "", `**Confidence:** ${CONFIDENCE_LABEL[data.confidence]}`, "", "### What it means", "", data.meaning, ""];
  if (data.causes.length) {
    lines.push("### Likely causes", "", ...data.causes.map((c, i) => `${i + 1}. ${c}`), "");
  }
  if (data.fix_steps.length) {
    lines.push("### How to fix it", "");
    data.fix_steps.forEach((s, i) => {
      lines.push(`${i + 1}. ${s.dangerous ? "⚠ **Caution:** " : ""}${s.step}`);
      if (s.command) lines.push("", "   ```", `   ${s.command}`, "   ```");
    });
    lines.push("");
  }
  if (data.verify) lines.push("### Check it worked", "", data.verify, "");
  lines.push(`_Generated by Fixit. Suggestions may be wrong; check commands before running them._`);
  return lines.join("\n");
}

// ---------- Log Digest: a boss raid ----------

export type DigestIssue = DigestResponse["issues"][number];

const VERDICT = {
  healthy: { label: "ALL CLEAR", line: "no enemies found", icon: "✔" },
  warnings: { label: "WARNINGS", line: "minor threats detected", icon: "!" },
  errors: { label: "ERRORS FOUND", line: "hostiles in the log", icon: "✕" },
} as const;

const SEVERITY = {
  error: { label: "BOSS", name: "error" },
  warning: { label: "ELITE", name: "warning" },
  info: { label: "MINION", name: "info" },
} as const;

export function renderDigest(data: DigestResponse, onExplain: (issue: DigestIssue) => void): HTMLElement {
  const maxCount = Math.max(1, ...data.issues.map((i) => i.count));
  const issues = el("ol", { class: "enemies" });
  data.issues.forEach((issue) => {
    const sev = SEVERITY[issue.severity];
    const hp = Math.max(6, Math.round((issue.count / maxCount) * 100));
    const explain = el("button", { type: "button", class: "fight" }, "⚔ explain this");
    explain.setAttribute("aria-label", `Explain this issue: ${issue.title}`);
    explain.addEventListener("click", () => onExplain(issue));
    issues.append(
      el(
        "li",
        { class: `enemy sev-${issue.severity}` },
        el(
          "div",
          { class: "enemy-head" },
          el("span", { class: `badge badge-sev sev-${issue.severity}` }, `${sev.label} · ${sev.name}`),
          el("h4", {}, issue.title),
        ),
        el(
          "div",
          { class: "hp" },
          el("span", { class: "hp-label", "aria-hidden": "true" }, "HP"),
          el("span", { class: "hp-track", "aria-hidden": "true" }, el("span", { class: "hp-fill", style: `width:${hp}%` })),
          el("span", { class: "hp-count" }, `×${issue.count.toLocaleString()}`, el("span", { class: "visually-hidden" }, " occurrences")),
        ),
        issue.first_seen && el("p", { class: "enemy-meta" }, `first seen ${issue.first_seen}`),
        el("pre", { class: "enemy-sample" }, el("code", {}, issue.sample)),
        el("div", { class: "enemy-actions" }, explain),
      ),
    );
  });

  const v = VERDICT[data.verdict];
  const tone = data.confidence === "high" ? "good" : data.confidence === "medium" ? "warn" : "bad";
  return el(
    "article",
    { class: `result-card raid verdict-${data.verdict}` },
    el(
      "header",
      { class: "result-header" },
      el("p", { class: "eyebrow" }, el("span", { class: "eyebrow-tag" }, "LOG RAID"), v.line),
      el("p", { class: "verdict" }, el("span", { class: "verdict-icon", "aria-hidden": "true" }, v.icon), `VERDICT: ${v.label}`),
      el("h2", { id: "result-title" }, data.overview),
      el("div", { class: "result-meta" }, statBar("CONFIDENCE", CONFIDENCE_PIPS[data.confidence], CONFIDENCE_LABEL[data.confidence].toUpperCase(), tone)),
    ),
    data.issues.length > 0 && section(`enemies (${data.issues.length})`, issues),
    section("final boss: root cause", el("p", { class: "root-cause" }, data.root_cause)),
    data.next_steps.length > 0 &&
      section(
        "next moves",
        el("ol", { class: "suspects" }, ...data.next_steps.map((s, i) => el("li", {}, el("span", { class: "rank", "aria-hidden": "true" }, `${i + 1}.`), el("span", {}, s)))),
      ),
  );
}

export function digestToMarkdown(data: DigestResponse): string {
  const lines = [
    `## Log digest: ${VERDICT[data.verdict].label.toLowerCase()}`,
    "",
    data.overview,
    "",
    `**Confidence:** ${CONFIDENCE_LABEL[data.confidence]}`,
    "",
  ];
  if (data.issues.length) {
    lines.push("### Top issues", "");
    data.issues.forEach((issue, i) => {
      const seen = issue.first_seen ? `, first seen ${issue.first_seen}` : "";
      lines.push(`${i + 1}. **${issue.title}** (${issue.severity}, ×${issue.count}${seen})`, "", "   ```", `   ${issue.sample}`, "   ```");
    });
    lines.push("");
  }
  lines.push("### Probable root cause", "", data.root_cause, "");
  if (data.next_steps.length) lines.push("### Next steps", "", ...data.next_steps.map((s, i) => `${i + 1}. ${s}`), "");
  lines.push(`_Generated by Fixit. The log may have been trimmed before analysis._`);
  return lines.join("\n");
}
