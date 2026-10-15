import { describe, expect, it } from 'vitest';
import { hasSwordArt, swordSpriteRect, weaponArt, LONGSWORD_URL } from '../src/weaponArt';
import { characterSheetHtml, slotGrid } from '../src/gearui';
import { gearCard } from '../src/itemcard';
import { globalStats, rollGear } from '../src/items';

describe('textured sword art', () => {
  it('uses actual images for swords, but retains distinct other weapon types', () => {
    expect(hasSwordArt('sword')).toBe(true);
    expect(hasSwordArt('greatsword')).toBe(true);
    expect(hasSwordArt('katana')).toBe(false);
    expect(weaponArt('sword')).toContain('<img');
    expect(weaponArt('katana', 'katana')).toContain('<svg');
    expect(LONGSWORD_URL).toContain('assets/weapons/longsword.png');
  });
  it('anchors the guard at the hand and makes the heavy sword visibly larger', () => {
    const sword = swordSpriteRect('sword'), heavy = swordSpriteRect('greatsword');
    expect(sword.y + sword.height * .739).toBeCloseTo(0);
    expect(sword.x + sword.width / 2).toBeCloseTo(0);
    expect(sword.height).toBeGreaterThan(52);
    expect(heavy.height).toBeGreaterThan(sword.height);
    expect(heavy.width).toBeGreaterThan(sword.width);
  });
  it('shares the new illustration across inventory, slots, and the character sheet', () => {
    const gear = rollGear('sword', 'normal', 1, 20);
    expect(gearCard(gear)).toContain('longsword-ui.webp');
    expect(slotGrid({}, { melee: gear })).toContain('longsword-ui.webp');
    expect(characterSheetHtml({ melee: gear }, globalStats({ melee: gear }), { meleeDps: 40, bowDps: 20, life: 100, stamina: 100 })).toContain('longsword-ui.webp');
  });
});
