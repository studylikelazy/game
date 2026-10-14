import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadSave, storeSave } from '../src/save';

describe('local persistence', () => {
  let data: string | null;
  beforeEach(() => { data = null; vi.stubGlobal('localStorage', { getItem: () => data, setItem: (_key: string, value: string) => { data = value; } }); });
  afterEach(() => vi.unstubAllGlobals());
  it('gives a new traveler a valid starter save', () => { expect(loadSave().coins).toBe(1250); expect(loadSave().stash).toEqual([]); });
  it('round trips progress and supplies', () => { const save = loadSave(); save.escapes = 3; save.stash.push({ kind: 'relic', amount: 2 }); expect(storeSave(save)).toBe(true); expect(loadSave()).toEqual(save); });
  it('recovers from corrupt JSON and unsupported versions', () => { data = '{broken'; expect(loadSave().coins).toBe(1250); data = '{"version":2}'; expect(loadSave().coins).toBe(1250); });
  it('validates items and counters rather than trusting stored JSON', () => {
    data = JSON.stringify({ version: 1, coins: -12, kills: 'bad', volume: 99, name: '<b>test</b>', stash: [{ kind: 'ruby', amount: 1 }, { kind: 'ruby', amount: -1 }, { kind: 'fake', amount: 1 }, { kind: 'toString', amount: 1 }], claimed: [true, 'first'] });
    const save = loadSave(); expect(save.coins).toBe(1250); expect(save.kills).toBe(0); expect(save.volume).toBe(1); expect(save.stash).toEqual([{ kind: 'ruby', amount: 1 }]); expect(save.claimed).toEqual(['first']);
  });
  it('reports unavailable storage without crashing', () => { vi.stubGlobal('localStorage', { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } }); expect(loadSave().coins).toBe(1250); expect(storeSave(loadSave())).toBe(false); });
});
