/**
 * Daily contract: a live-service staple. One task per calendar day, chosen
 * deterministically so every client agrees on it without a server. Progress
 * is counted from successful raids only, like the standing contracts.
 */
export interface DailyTask {
  id: string;
  title: string;
  desc: string;
  icon: string;
  metric: 'kills' | 'looted' | 'escapes';
  goal: number;
  reward: number;
}

export interface DailySave { date: string; progress: number; claimed: boolean }

interface Template { title: string; desc: string; icon: string; metric: DailyTask['metric']; goal: number; reward: number }

const TEMPLATES: Template[] = [
  { title: '日課：境界の掃除人', desc: '敵を4体倒して帰還する', icon: 'sword', metric: 'kills', goal: 4, reward: 220 },
  { title: '日課：拾い屋の朝', desc: '物資を6点持ち帰る', icon: 'stash', metric: 'looted', goal: 6, reward: 240 },
  { title: '日課：無事の帰還', desc: '生きて1回脱出する', icon: 'exit', metric: 'escapes', goal: 1, reward: 160 },
];

/** Local calendar day as YYYY-MM-DD (the day is the player's, not UTC's). */
export function todayLocalIso(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** The task for a given day: stable hash picks the template and its size. */
export function dailyFor(dateIso: string): DailyTask {
  let hash = 7;
  for (const ch of dateIso) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  const t = TEMPLATES[hash % TEMPLATES.length];
  const heavy = hash % 3 === 1 && t.metric === 'kills';
  return {
    id: `daily:${dateIso}`,
    title: t.title,
    desc: heavy ? t.desc.replace('4体', '6体') : t.desc,
    icon: t.icon,
    metric: t.metric,
    goal: t.goal + (heavy ? 2 : 0),
    reward: t.reward + (heavy ? 80 : 0),
  };
}

/**
 * Adds one raid's delta to today's progress, rolling over cleanly when the
 * day has changed. Claimed tasks stop accruing. Returns the updated slot.
 */
export function recordDailyProgress(slot: DailySave, dateIso: string, amount: number, goal: number): DailySave {
  const next: DailySave = slot.date === dateIso ? { ...slot } : { date: dateIso, progress: 0, claimed: false };
  if (!next.claimed && amount > 0) next.progress = Math.min(goal, next.progress + Math.floor(amount));
  return next;
}
