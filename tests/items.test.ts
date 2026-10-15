import { describe, expect, it } from 'vitest';
import { AFFIX_BY_ID, ARMOUR_BASES, SLOTS, UNIQUES, WEAPON_BASES, mulberry32, randomBase, rollDrop, rollGear, sanitizeGear } from '../src/items';

const bases = [...WEAPON_BASES, ...ARMOUR_BASES];
describe('expanded equipment catalogue', () => {
  it('has 42 distinct bases and 12 distinct uniques', () => {
    expect(bases).toHaveLength(42);
    expect(new Set(bases.map(b => b.id)).size).toBe(bases.length);
    expect(UNIQUES).toHaveLength(12);
    expect(new Set(UNIQUES.map(u => u.id)).size).toBe(UNIQUES.length);
    expect(new Set(UNIQUES.map(u => u.base)).size).toBe(UNIQUES.length);
  });
  it('keeps every base reachable in its slot without mutating cached pools', () => {
    for (const slot of SLOTS) {
      const expected = bases.filter(b => b.slot === slot);
      for (let i = 0; i < expected.length; i++) {
        expect(randomBase(slot, () => (i + .5) / expected.length)).toEqual(expected[i]);
      }
      const random = mulberry32(123);
      const seen = new Set(Array.from({ length: 1000 }, () => rollDrop(slot, 10, Math.floor(random() * 100000)).base));
      expect(seen).toEqual(new Set(expected.map(b => b.id)));
    }
  });
  it('round-trips every base through save validation at each rarity', () => {
    for (const base of bases) {
      for (const rarity of ['normal', 'magic', 'rare', 'unique'] as const) {
        const gear = rollGear(base.id, rarity, 12, 12345);
        expect(sanitizeGear(JSON.parse(JSON.stringify(gear)))).toEqual(gear);
        expect(rollGear(base.id, rarity, 12, 12345)).toEqual(gear);
        for (const affix of gear.affixes) expect(AFFIX_BY_ID[affix.id].slots).toContain(base.slot);
      }
    }
  });
  it('rolls all unique identities and validates their fixed modifiers', () => {
    for (const unique of UNIQUES) {
      const gear = rollGear(unique.base, 'unique', 15, 99);
      expect(gear.uniqueId).toBe(unique.id);
      expect(gear.name).toBe(unique.name);
      expect(gear.affixes.map(({ id, value }) => ({ id, value }))).toEqual(unique.affixes);
    }
  });
});
