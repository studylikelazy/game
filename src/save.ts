import { ITEMS, type Item } from './game';
export interface Save { version: 1; name: string; coins: number; stash: Item[]; raids: number; escapes: number; kills: number; collected: number; claimed: string[]; volume: number; reducedMotion: boolean }
const initial = (): Save => ({ version: 1, name: '名もなき旅人', coins: 1250, stash: [], raids: 0, escapes: 0, kills: 0, collected: 0, claimed: [], volume: .25, reducedMotion: false });
export function loadSave(): Save {
  try {
    const raw = JSON.parse(localStorage.getItem('ashenfell-save-v1') || 'null');
    if (!raw || raw.version !== 1) return initial();
    const safe = initial();
    safe.name = typeof raw.name === 'string' ? raw.name.slice(0, 16) : safe.name;
    for (const key of ['coins', 'raids', 'escapes', 'kills', 'collected'] as const) if (Number.isFinite(raw[key]) && raw[key] >= 0) safe[key] = Math.min(1e9, Math.floor(raw[key]));
    safe.stash = Array.isArray(raw.stash) ? raw.stash.filter((i: Item) => i && Object.hasOwn(ITEMS, i.kind) && Number.isInteger(i.amount) && i.amount > 0 && i.amount <= 100).slice(0, 1000) : [];
    safe.claimed = Array.isArray(raw.claimed) ? raw.claimed.filter((x: unknown) => typeof x === 'string').slice(0, 20) : [];
    safe.volume = typeof raw.volume === 'number' && Number.isFinite(raw.volume) ? Math.max(0, Math.min(1, raw.volume)) : .25;
    safe.reducedMotion = raw.reducedMotion === true;
    return safe;
  } catch { return initial(); }
}
export function storeSave(save: Save): boolean { try { localStorage.setItem('ashenfell-save-v1', JSON.stringify(save)); return true; } catch { return false; } }
