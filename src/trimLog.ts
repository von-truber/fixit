// Log pre-processing in the browser: collapse repeated lines, then keep the most
// useful lines within the character budget (errors and their neighbours first).

export interface TrimResult {
  text: string;
  originalLines: number;
  outputLines: number;
  /** Lines folded into a "[N occurrences in total]" note. */
  collapsedLines: number;
  /** Lines dropped to fit the budget. */
  omittedLines: number;
  trimmed: boolean;
}

const TIMESTAMP =
  /^\s*(?:\[?\d{4}[-/]\d{2}[-/]\d{2}[T ]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?(?:Z|[+-]\d{2}:?\d{2})?\]?|[A-Z][a-z]{2} +\d{1,2} \d{2}:\d{2}:\d{2})/;

const ERROR_RE =
  /\b(?:error|err|fatal|crit(?:ical)?|panic|emerg|alert|severe|exception|traceback|failed|failure|oom\w*|killed|segfault|denied|refused|timed? ?out|unhealthy)\b/i;
const WARN_RE = /\bwarn(?:ing)?\b/i;

const CONTEXT = 2;
const HEAD_LINES = 5;
const TAIL_LINES = 20;

function timestampOf(line: string): string | null {
  const m = line.match(TIMESTAMP);
  return m ? m[0].trim().replace(/^\[|\]$/g, "") : null;
}

/**
 * Lines that differ only in timestamps, numbers, ids and quoted values (URLs,
 * hosts) share a signature, so one count covers them all and the model never
 * has to add up several groups.
 */
export function signature(line: string): string {
  return line
    .replace(TIMESTAMP, "")
    .replace(/"[^"]*"/g, '"…"')
    // Unquoted paths and routes (/invoices/:id, /app/x.js:45:11) vary per line too.
    .replace(/(?<![\w/])\/[^\s"'),\]]+/g, "/…")
    .replace(/\b(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/g, "METHOD")
    .replace(/0x[0-9a-f]+/gi, "#")
    .replace(/\b[0-9a-f]{8,}\b/gi, "#")
    .replace(/\d+/g, "#")
    .replace(/\s+/g, " ")
    .trim();
}

/** The parts that `signature` hides (methods, routes, quoted values), digits normalised. */
function variantOf(line: string): string {
  const parts = line
    .replace(TIMESTAMP, "")
    .match(/\b(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+\/[^\s"'),\]]*|"[^"]*"|(?<![\w/])\/[^\s"'),\]]+/g);
  return (parts ?? []).map((p) => p.replace(/\d+/g, "#")).join(" ");
}

const MAX_VARIANTS = 50;
const SHOWN_VARIANTS = 4;

interface Group {
  first: string;
  count: number;
  lastTimestamp: string | null;
  variants: Set<string>;
}

export function collapseDuplicates(lines: string[]): { lines: string[]; collapsed: number } {
  const groups = new Map<string, Group>();
  const order: (Group | string)[] = [];

  for (const line of lines) {
    const sig = signature(line);
    if (sig.length < 4) {
      order.push(line); // blank or trivial lines are kept as they are
      continue;
    }
    const group = groups.get(sig);
    if (group) {
      group.count++;
      group.lastTimestamp = timestampOf(line) ?? group.lastTimestamp;
      if (group.variants.size < MAX_VARIANTS) group.variants.add(variantOf(line));
    } else {
      const g: Group = { first: line, count: 1, lastTimestamp: null, variants: new Set([variantOf(line)]) };
      groups.set(sig, g);
      order.push(g);
    }
  }

  let collapsed = 0;
  const out = order.map((item) => {
    if (typeof item === "string") return item;
    if (item.count === 1) return item.first;
    collapsed += item.count - 1;
    const last = item.lastTimestamp ? `, last at ${item.lastTimestamp}` : "";
    // Say when the folded lines hit different routes or values, so the model
    // does not describe them all by the first line's route.
    const kinds = [...item.variants].filter(Boolean);
    const across =
      kinds.length > 1
        ? `, across ${kinds.length >= MAX_VARIANTS ? `${MAX_VARIANTS}+` : kinds.length} variants such as ${kinds.slice(0, SHOWN_VARIANTS).join(" | ")}`
        : "";
    return `${item.first}  [${item.count} occurrences in total including this one${across}${last}]`;
  });
  return { lines: out, collapsed };
}

export function trimLog(input: string, budget: number): TrimResult {
  const original = input.replace(/\r\n?/g, "\n").replace(/\n+$/, "").split("\n");
  const { lines, collapsed } = collapseDuplicates(original);

  const result = (text: string, outputLines: number, omittedLines: number): TrimResult => ({
    text,
    originalLines: original.length,
    outputLines,
    collapsedLines: collapsed,
    omittedLines,
    trimmed: omittedLines > 0,
  });

  const joined = lines.join("\n");
  if (joined.length <= budget) return result(joined, lines.length, 0);

  // Score each line: errors 4, error context 3, warnings 2, warning context 1.
  const score = new Array<number>(lines.length).fill(0);
  lines.forEach((line, i) => {
    const level = ERROR_RE.test(line) ? 4 : WARN_RE.test(line) ? 2 : 0;
    if (!level) return;
    score[i] = Math.max(score[i], level);
    for (let d = 1; d <= CONTEXT; d++) {
      if (i - d >= 0) score[i - d] = Math.max(score[i - d], level - 1);
      if (i + d < lines.length) score[i + d] = Math.max(score[i + d], level - 1);
    }
  });

  // Always try to keep the start (process start-up) and the end (how it died).
  const priority = lines.map((_, i) => {
    const edge = i < HEAD_LINES || i >= lines.length - TAIL_LINES ? 5 : 0;
    return Math.max(score[i], edge);
  });

  // Highest priority first; within a level, later lines first (the end of a log matters most).
  const indices = lines.map((_, i) => i).sort((a, b) => priority[b] - priority[a] || b - a);

  const keep = new Set<number>();
  const MARKER_ALLOWANCE = 48;
  let used = 0;
  for (const i of indices) {
    const cost = lines[i].length + 1 + MARKER_ALLOWANCE;
    if (used + cost > budget) continue;
    keep.add(i);
    used += cost;
  }

  const out: string[] = [];
  let gap = 0;
  const flushGap = () => {
    if (gap) out.push(`... [${gap} line${gap > 1 ? "s" : ""} omitted] ...`);
    gap = 0;
  };
  lines.forEach((line, i) => {
    if (keep.has(i)) {
      flushGap();
      out.push(line.length > budget ? line.slice(0, budget) : line);
    } else {
      gap++;
    }
  });
  flushGap();

  return result(out.join("\n"), keep.size, lines.length - keep.size);
}
