import { describe, expect, it } from 'vitest';
import { chestMaterial, dominantElement, ELEMENT_COLORS, facingPose, swingPose, weaponAppearance } from '../src/appearance';
import { addPlayer, makeGame } from '../src/game';
import { rollGear } from '../src/items';

describe('presentation follows equipped gear without changing combat', () => {
  it('keeps bodies upright while mapping aim into front/back/side poses', () => {
    expect(facingPose(-Math.PI / 2).back).toBe(true);
    expect(facingPose(Math.PI / 2).back).toBe(false);
    expect(facingPose(0).side).toBe(1);
    expect(facingPose(Math.PI).side).toBe(-1);
    expect(facingPose(0).headX).toBeCloseTo(2.1);
    expect(facingPose(Math.PI).headX).toBeCloseTo(-2.1);
    for (let angle = -Math.PI; angle < Math.PI; angle += .1) {
      const pose = facingPose(angle);
      expect(pose.width).toBeGreaterThanOrEqual(.78);
      expect(pose.width).toBeLessThanOrEqual(.92);
      expect(pose.weaponAngle).toBeCloseTo(angle + Math.PI / 2);
    }
  });
  it('draws the issued katana, rather than silently substituting a sword', () => {
    const p = addPlayer(makeGame(), 'local', 'traveller', 'katana');
    expect(weaponAppearance(p).kind).toBe('katana');
    expect(weaponAppearance(p).element).toBeNull();
  });
  it('uses the strongest positive elemental damage with stable ties', () => {
    expect(dominantElement({ fire: 0, cold: 0, lightning: 0 })).toBeNull();
    expect(dominantElement({ fire: 12, cold: 4, lightning: 3 })).toBe('fire');
    expect(dominantElement({ fire: 3, cold: 12, lightning: 4 })).toBe('cold');
    expect(dominantElement({ fire: 3, cold: 4, lightning: 12 })).toBe('lightning');
    expect(dominantElement({ fire: 4, cold: 4, lightning: 0 })).toBe('fire');
  });
  it('reflects actual elemental affixes, not just rarity', () => {
    const p = addPlayer(makeGame(), 'local');
    const gear = rollGear('sword', 'magic', 8, 100);
    gear.affixes = [{ id: 'cold_damage', tier: 0, value: 8 }];
    p.loadout.melee = gear;
    expect(weaponAppearance(p).element).toBe('cold');
    expect(weaponAppearance(p).color).toBe(ELEMENT_COLORS.cold);
    expect(p.loadout.melee).toEqual(gear);
  });
  it('distinguishes leather, woven robes and chainmail', () => {
    expect(chestMaterial(undefined)).toBe('leather');
    expect(chestMaterial(rollGear('traveller_cloak', 'normal', 1, 1))).toBe('leather');
    expect(chestMaterial(rollGear('chain_cuirass', 'normal', 1, 1))).toBe('chain');
    expect(chestMaterial(rollGear('monk_robe', 'normal', 1, 1))).toBe('cloth');
  });
  it('eases a single bounded weapon sweep and returns to rest', () => {
    expect(swingPose(0)).toBe(.2);
    expect(swingPose(-1)).toBe(.2);
    expect(swingPose(.22)).toBeCloseTo(-1.35);
    const poses = [.22, .18, .14, .1, .06, .01].map(t => swingPose(t));
    expect(poses).toEqual([...poses].sort((a, b) => a - b));
    expect(swingPose(100)).toBeCloseTo(-1.35);
  });
});
