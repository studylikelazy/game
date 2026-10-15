import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadSave, storeSave } from '../src/save';
import { rollGear } from '../src/items';

describe('local persistence', () => {
  let data: string | null;
  beforeEach(() => { data = null; vi.stubGlobal('localStorage', { getItem: () => data, setItem: (_key: string, value: string) => { data = value; } }); });
  afterEach(() => vi.unstubAllGlobals());
  it('gives a new traveler a valid starter save', () => { expect(loadSave().coins).toBe(1250); expect(loadSave().stash).toEqual([]); expect(loadSave().loadout).toEqual({}); expect(loadSave().meleeChoice).toBe('sword'); });
  it('round trips progress and supplies', () => { const save = loadSave(); save.escapes = 3; save.stash.push({ kind: 'relic', amount: 2 }); expect(storeSave(save)).toBe(true); expect(loadSave()).toEqual(save); });
  it('round trips equipped gear and the issued weapon choice', () => {
    const save = loadSave();
    save.loadout.chest = rollGear('chain_cuirass', 'rare', 9, 4242);
    save.loadout.melee = rollGear('axe', 'magic', 6, 1717);
    save.meleeChoice = 'katana';
    expect(storeSave(save)).toBe(true);
    const loaded = loadSave();
    expect(loaded.loadout.chest?.id).toBe(save.loadout.chest!.id);
    expect(loaded.loadout.chest?.affixes).toEqual(save.loadout.chest!.affixes);
    expect(loaded.loadout.melee?.name).toBe(save.loadout.melee!.name);
    expect(loaded.meleeChoice).toBe('katana');
  });
  it('recovers from corrupt JSON and unsupported versions', () => { data = '{broken'; expect(loadSave().coins).toBe(1250); data = '{"version":2}'; expect(loadSave().coins).toBe(1250); });
  it('validates items and counters rather than trusting stored JSON', () => {
    data = JSON.stringify({ version: 1, coins: -12, kills: 'bad', volume: 99, name: '<b>test</b>', stash: [{ kind: 'ruby', amount: 1 }, { kind: 'ruby', amount: -1 }, { kind: 'fake', amount: 1 }, { kind: 'toString', amount: 1 }], claimed: [true, 'first'] });
    const save = loadSave(); expect(save.coins).toBe(1250); expect(save.kills).toBe(0); expect(save.volume).toBe(1); expect(save.stash).toEqual([{ kind: 'ruby', amount: 1 }]); expect(save.claimed).toEqual(['first']);
  });
  it('rejects a stored loadout with an unknown slot or a mismatched base type', () => {
    data = JSON.stringify({ version: 2, loadout: { weapon: { id: 'x', base: 'sword', slot: 'melee', rarity: 'normal', ilvl: 1, seed: 1, affixes: [] }, chest: { id: 'y', base: 'sword', slot: 'chest', rarity: 'normal', ilvl: 1, seed: 1, affixes: [] } } });
    const save = loadSave();
    expect((save.loadout as Record<string, unknown>).weapon).toBeUndefined();
    expect(save.loadout.chest).toBeUndefined();
  });
  it('reports unavailable storage without crashing', () => { vi.stubGlobal('localStorage', { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } }); expect(loadSave().coins).toBe(1250); expect(storeSave(loadSave())).toBe(false); });
});
