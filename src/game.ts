// The game layer: XP, levels, stats and achievements, kept in this browser only.
// Purely cosmetic; nothing here is sent anywhere.

const STORAGE_KEY = "fixit.player.v1";

export type AchievementId = "hello_world" | "secret_keeper" | "exterminator" | "log_diver" | "boss_hunter" | "rtfm";

export const ACHIEVEMENTS: Record<AchievementId, { name: string; hint: string; icon: string }> = {
  hello_world: { name: "Hello, World", hint: "Run your first analysis", icon: "◆" },
  secret_keeper: { name: "Secret Keeper", hint: "Have a secret redacted before sending", icon: "⛨" },
  exterminator: { name: "Exterminator", hint: "Tick off every step of a fix", icon: "✸" },
  log_diver: { name: "Log Diver", hint: "Digest your first log", icon: "≋" },
  boss_hunter: { name: "Boss Hunter", hint: "Send a log issue to Explain", icon: "⚔" },
  rtfm: { name: "Read The Manual", hint: "Tick off a HAZARD step", icon: "⚠" },
};

const TITLES = ["Newbie", "Tinkerer", "Debugger", "Bug Hunter", "Stack Tracer", "Log Whisperer", "Kernel Sage"];

interface Player {
  xp: number;
  fixes: number;
  secrets: number;
  logs: number;
  achievements: AchievementId[];
}

const fresh = (): Player => ({ xp: 0, fixes: 0, secrets: 0, logs: 0, achievements: [] });

function load(): Player {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return fresh();
    const p = JSON.parse(raw) as Partial<Player>;
    return {
      xp: Number(p.xp) || 0,
      fixes: Number(p.fixes) || 0,
      secrets: Number(p.secrets) || 0,
      logs: Number(p.logs) || 0,
      achievements: Array.isArray(p.achievements) ? p.achievements.filter((a): a is AchievementId => a in ACHIEVEMENTS) : [],
    };
  } catch {
    return fresh();
  }
}

let player = load();

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(player));
  } catch {
    // Private windows can block storage; the game still works for this visit.
  }
}

/** XP needed to reach a level: 0, 100, 250, 450, 700 ... */
function xpForLevel(level: number) {
  return 25 * (level - 1) * (level + 2);
}

export function levelInfo(xp = player.xp) {
  let level = 1;
  while (xp >= xpForLevel(level + 1)) level++;
  const floor = xpForLevel(level);
  const next = xpForLevel(level + 1);
  return {
    level,
    title: TITLES[Math.min(level - 1, TITLES.length - 1)],
    into: xp - floor,
    span: next - floor,
  };
}

// ---------- Toasts ----------

const toasts = () => document.getElementById("toasts")!;

export function toast(text: string, kind: "xp" | "achievement" | "level" = "xp") {
  const node = document.createElement("div");
  node.className = `toast toast-${kind}`;
  node.textContent = text;
  toasts().append(node);
  setTimeout(() => node.classList.add("leaving"), kind === "xp" ? 1800 : 3200);
  setTimeout(() => node.remove(), kind === "xp" ? 2300 : 3700);
}

// ---------- HUD ----------

export function renderHud() {
  const info = levelInfo();
  const pct = Math.round((info.into / info.span) * 100);
  document.getElementById("hud-level")!.textContent = `LV ${info.level}`;
  document.getElementById("hud-title")!.textContent = info.title;
  document.getElementById("xp-fill")!.style.width = `${pct}%`;
  const bar = document.getElementById("xp-bar")!;
  bar.setAttribute("aria-valuenow", String(pct));
  bar.setAttribute("aria-valuetext", `${info.into} of ${info.span} XP to level ${info.level + 1}`);
  document.getElementById("xp-text")!.textContent = `${info.into} / ${info.span} XP`;
  document.getElementById("stat-fixes")!.textContent = String(player.fixes);
  document.getElementById("stat-secrets")!.textContent = String(player.secrets);
  document.getElementById("stat-logs")!.textContent = String(player.logs);

  const ids = Object.keys(ACHIEVEMENTS) as AchievementId[];
  document.getElementById("ach-count")!.textContent = `${player.achievements.length}/${ids.length}`;
  const list = document.getElementById("ach-list")!;
  list.replaceChildren(
    ...ids.map((id) => {
      const a = ACHIEVEMENTS[id];
      const unlocked = player.achievements.includes(id);
      const li = document.createElement("li");
      li.className = unlocked ? "ach unlocked" : "ach";
      const icon = document.createElement("span");
      icon.className = "ach-icon";
      icon.setAttribute("aria-hidden", "true");
      icon.textContent = unlocked ? a.icon : "?";
      const name = document.createElement("strong");
      name.textContent = unlocked ? a.name : "locked";
      const hint = document.createElement("span");
      hint.className = "ach-hint";
      hint.textContent = a.hint;
      li.append(icon, name, hint);
      return li;
    }),
  );
}

// ---------- Rewards ----------

export function addXp(amount: number, reason: string) {
  const before = levelInfo().level;
  player.xp += amount;
  save();
  toast(`+${amount} XP  ${reason}`);
  const after = levelInfo();
  if (after.level > before) {
    setTimeout(() => toast(`LEVEL UP! LV ${after.level}: ${after.title}`, "level"), 400);
    document.querySelector(".hud")?.classList.add("flash");
    setTimeout(() => document.querySelector(".hud")?.classList.remove("flash"), 1200);
  }
  renderHud();
}

export function unlock(id: AchievementId) {
  if (player.achievements.includes(id)) return;
  player.achievements.push(id);
  save();
  const a = ACHIEVEMENTS[id];
  setTimeout(() => toast(`${a.icon} ACHIEVEMENT: ${a.name}`, "achievement"), 600);
  renderHud();
}

export function bump(stat: "fixes" | "secrets" | "logs", by = 1) {
  player[stat] += by;
  save();
  renderHud();
}

export function resetProgress() {
  player = fresh();
  save();
  renderHud();
}
