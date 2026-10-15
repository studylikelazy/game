import { ITEMS, SLOTS, isGear, sanitizeGear, type BagEntry, type Gear, type MaterialKind, type Slot } from './items';

export interface Save {
  version: 2;
  name: string;
  coins: number;
  /** Materials and gear waiting in the stash. */
  stash: BagEntry[];
  /** Gear the traveller has equipped for the next raid. */
  loadout: Partial<Record<Slot, Gear>>;
  /** Which issued melee weapon is worn when no found weapon is equipped. */
  meleeChoice: 'sword' | 'katana';
  raids: number;
  escapes: number;
  kills: number;
  collected: number;
  claimed: string[];
  volume: number;
  /** Environmental bed (wind, fire, wildlife) volume, kept separate from combat SFX. */
  ambientVolume: number;
  reducedMotion: boolean;
}

const initial = (): Save => ({ version: 2, name: '名もなき旅人', coins: 1250, stash: [], loadout: {}, meleeChoice: 'sword', raids: 0, escapes: 0, kills: 0, collected: 0, claimed: [], volume: .25, ambientVolume: .55, reducedMotion: false });

const MATERIALS = Object.keys(ITEMS) as MaterialKind[];

/**
 * Rebuilds a gear record from a raw blob. The item is rolled again from the
 * four facts that define it, so a tampered save can never invent affixes that
 * the rolling rules would not produce.
 */
function parseGear(raw: unknown): Gear | null {
  if (!raw || typeof raw !== 'object') return null;
  const gear = raw as Partial<Gear> & { id?: unknown };
  if (typeof gear.base !== 'string') return null;
  const rebuilt = sanitizeGear({ base: gear.base, rarity: gear.rarity, ilvl: gear.ilvl, seed: gear.seed });
  if (!rebuilt) return null;
  return { ...rebuilt, id: typeof gear.id === 'string' ? gear.id.slice(0, 64) : rebuilt.id };
}

function parseEntry(raw: unknown): BagEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const entry = raw as { kind?: unknown; amount?: unknown; base?: unknown; slot?: unknown; affixes?: unknown; id?: unknown; rarity?: unknown; ilvl?: unknown; seed?: unknown; name?: unknown; uniqueId?: unknown; traits?: unknown };
  if (isGear(entry as unknown as BagEntry)) return parseGear(entry);
  const kind = entry.kind as MaterialKind;
  if (!MATERIALS.includes(kind)) return null;
  if (!Number.isInteger(entry.amount) || (entry.amount as number) <= 0 || (entry.amount as number) > 100) return null;
  return { kind, amount: entry.amount as number };
}

export function loadSave(): Save {
  try {
    const raw = JSON.parse(localStorage.getItem('ashenfell-save-v1') || 'null');
    if (!raw || ![1, 2].includes(raw.version)) return initial();
    const safe = initial();
    safe.name = typeof raw.name === 'string' ? raw.name.slice(0, 16) : safe.name;
    for (const key of ['coins', 'raids', 'escapes', 'kills', 'collected'] as const) if (Number.isFinite(raw[key]) && raw[key] >= 0) safe[key] = Math.min(1e9, Math.floor(raw[key]));
    if (Array.isArray(raw.stash)) safe.stash = (raw.stash as unknown[]).map(entry => parseEntry(entry)).filter((e): e is BagEntry => e !== null).slice(0, 400);
    if (raw.loadout && typeof raw.loadout === 'object') {
      for (const slot of SLOTS) {
        const gear = parseGear((raw.loadout as Record<string, unknown>)[slot]);
        if (gear && gear.slot === slot) safe.loadout[slot] = gear;
      }
    }
    safe.meleeChoice = raw.meleeChoice === 'katana' ? 'katana' : 'sword';
    safe.claimed = Array.isArray(raw.claimed) ? raw.claimed.filter((x: unknown) => typeof x === 'string').slice(0, 20) : [];
    safe.volume = typeof raw.volume === 'number' && Number.isFinite(raw.volume) ? Math.max(0, Math.min(1, raw.volume)) : .25;
    safe.ambientVolume = typeof raw.ambientVolume === 'number' && Number.isFinite(raw.ambientVolume) ? Math.max(0, Math.min(1, raw.ambientVolume)) : .55;
    safe.reducedMotion = raw.reducedMotion === true;
    return safe;
  } catch { return initial(); }
}

export function storeSave(save: Save): boolean { try { localStorage.setItem('ashenfell-save-v1', JSON.stringify(save)); return true; } catch { return false; } }
