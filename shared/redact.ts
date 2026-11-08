// One set of redaction rules for the browser and the server.
// The page runs redact() before sending; the function runs it again as a safety net.

export type RedactionKind =
  | "private_key"
  | "connection_string"
  | "auth_header"
  | "jwt"
  | "api_key"
  | "secret_value"
  | "email"
  | "ip"
  | "home_dir"
  | "token";

export interface RedactionResult {
  text: string;
  /** Total number of items replaced. */
  count: number;
  /** Count per kind of item, only kinds that were found. */
  byKind: Partial<Record<RedactionKind, number>>;
}

type Replacer = (match: string, ...groups: string[]) => string | null;

interface Rule {
  kind: RedactionKind;
  pattern: RegExp;
  /** Return the replacement, or null to leave this match alone. */
  replace: Replacer;
}

const isPlaceholder = (s: string) => /^\[[A-Z_]+\]$/.test(s);

const IPV4_OCTET = "(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)";

function isIPv6(candidate: string): boolean {
  // ":::3000" is the unspecified address "::" plus a port (Node's EADDRINUSE); keep it.
  if (candidate.includes(":::")) return false;
  const groups = candidate.split(":");
  const nonEmpty = groups.filter(Boolean);
  if (!nonEmpty.every((g) => /^[0-9a-f]{1,4}$/i.test(g))) return false;
  if (candidate.includes("::")) return candidate.split("::").length === 2 && groups.length <= 9;
  // Without "::", a full address has exactly 8 groups (rules out times like 09:14:02).
  return groups.length === 8;
}

// Order matters: whole blocks and structured secrets first, broad patterns last.
const RULES: Rule[] = [
  {
    kind: "private_key",
    pattern: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY-----|$)/g,
    replace: () => "[PRIVATE_KEY]",
  },
  {
    // scheme://user:pass@host -> scheme://[REDACTED]@host
    kind: "connection_string",
    pattern: /\b([a-z][a-z0-9+.-]*:\/\/)([^\s:@/]+):([^\s@/]+)@/gi,
    replace: (_m, scheme) => `${scheme}[REDACTED]@`,
  },
  {
    kind: "auth_header",
    pattern: /\b((?:proxy-)?authorization)(\s*[:=]\s*)(?:(?:bearer|basic|token|digest)\s+)?([^\s"',]+)/gi,
    replace: (_m, name, sep, value) => (isPlaceholder(value) ? null : `${name}${sep}[REDACTED]`),
  },
  {
    kind: "auth_header",
    pattern: /\bBearer\s+([A-Za-z0-9._~+/-]{8,}=*)/g,
    replace: (_m, value) => (isPlaceholder(value) ? null : "Bearer [REDACTED]"),
  },
  {
    kind: "jwt",
    pattern: /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/g,
    replace: () => "[JWT]",
  },
  {
    kind: "api_key",
    pattern:
      /\b(?:sk-[A-Za-z0-9_-]{8,}|(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|xox[abposr]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{30,})/g,
    replace: () => "[API_KEY]",
  },
  {
    // password=hunter2, DB_PASS: abc, "api_key": "123" -> name=[REDACTED]
    kind: "secret_value",
    pattern:
      /\b([A-Za-z0-9_.-]*(?:pass(?:word|wd)?|pwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|credentials?)[A-Za-z0-9_.-]*)(["']?\s*[:=]\s*)(["']?)([^\s"',;&]{3,})/gi,
    replace: (_m, name, sep, quote, value) =>
      isPlaceholder(value) || /^\[REDACTED\]/.test(value) ? null : `${name}${sep}${quote}[REDACTED]`,
  },
  {
    kind: "email",
    pattern: /\b([A-Za-z0-9._%+-]+)@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
    // git@github.com and similar service users are not personal data.
    replace: (_m, local) => (/^(git|noreply|no-reply)$/i.test(local) ? null : "[EMAIL]"),
  },
  {
    kind: "ip",
    pattern: new RegExp(`(?<![\\w.])${IPV4_OCTET}(?:\\.${IPV4_OCTET}){3}(?![\\w.])`, "g"),
    // Loopback and wildcard addresses identify no one and help diagnosis.
    replace: (m) => (/^(?:127\.|0\.0\.0\.0$)/.test(m) ? null : "[IP]"),
  },
  {
    kind: "ip",
    pattern: /(?<![\w:])(?:[0-9a-f]{0,4}:){2,8}[0-9a-f]{0,4}(?![\w:])/gi,
    replace: (m) => (isIPv6(m) && m !== "::1" && m !== "::" ? "[IP]" : null),
  },
  {
    // /home/michael/ , /Users/michael/ , C:\Users\Michael\ , C:/Users/Michael/
    kind: "home_dir",
    pattern: /((?:\/home\/|\/Users\/|[A-Za-z]:[\\/](?:Users|Documents and Settings)[\\/]))([^\\/\s"':]+)(?=[\\/]|\s|$|["':])/gi,
    replace: (_m, prefix, user) =>
      isPlaceholder(user) || /^(public|shared|default|all users)$/i.test(user) ? null : `${prefix}[USER]`,
  },
  {
    // 32+ characters of hex, or base64-like strings with mixed case and digits.
    kind: "token",
    pattern: /(?<![A-Za-z0-9+_=-])[A-Za-z0-9+_=-]{32,}(?![A-Za-z0-9+_=-])/g,
    replace: (m) => {
      const hex = /^[0-9a-f]+$/i.test(m.replace(/-/g, ""));
      const mixed = /[a-z]/.test(m) && /[A-Z]/.test(m) && /\d/.test(m);
      return hex || mixed ? "[TOKEN]" : null;
    },
  },
];

export function redact(input: string): RedactionResult {
  let text = input;
  let count = 0;
  const byKind: RedactionResult["byKind"] = {};

  for (const rule of RULES) {
    text = text.replace(rule.pattern, (match: string, ...rest: unknown[]) => {
      // rest = [...groups, offset, whole string] (no named groups are used)
      const groups = rest.slice(0, -2).map((g) => (g === undefined ? "" : String(g)));
      const replacement = rule.replace(match, ...groups);
      if (replacement === null || replacement === match) return match;
      count++;
      byKind[rule.kind] = (byKind[rule.kind] ?? 0) + 1;
      return replacement;
    });
  }

  return { text, count, byKind };
}
