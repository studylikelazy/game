import { describe, expect, it } from 'vitest';
import { CAMP_UPGRADES, applyCampBonuses, campLevel, canAfford, materialCount, nextCost, payFor, saleMultiplier } from '../src/camp';
import { addPlayer, EXITS, makeGame, stepGame } from '../src/game';
import type { BagEntry } from '../src/items';

const tick = (seconds: number, game: ReturnType<typeof makeGame>) => { for (let i = 0; i < Math.ceil(seconds * 60); i++) stepGame(game, 1 / 60); };

describe('camp meta progression', () => {
  it('offers costs only until the maximum level, then stops', () => {
    for (const upgrade of CAMP_UPGRADES) expect(upgrade.costs).toHaveLength(upgrade.maxLevel);
    const camp = {};
    const first = nextCost(camp, 'apothecary');
    expect(first).not.toBeNull();
    const maxed = { apothecary: 3 };
    expect(campLevel(maxed, 'apothecary')).toBe(3);
    expect(nextCost(maxed, 'apothecary')).toBeNull();
    // Levels are clamped: a corrupted save can never produce a level 9 shrine.
    expect(campLevel({ shrine: 99 }, 'shrine')).toBe(3);
    expect(campLevel({}, 'missing-upgrade')).toBe(0);
  });
  it('requires both coins and materials, and pays from the stash without touching unaffordable cases', () => {
    const stash: BagEntry[] = [{ kind: 'herb', amount: 5 }, { kind: 'cloth', amount: 1 }];
    const cost = { coins: 100, materials: { herb: 4 as const } };
    expect(materialCount(stash, 'herb')).toBe(5);
    expect(canAfford(50, stash, cost)).toBe(false);
    expect(canAfford(100, stash, cost)).toBe(true);
    expect(payFor(100, stash, cost)).toBe(0);
    expect(materialCount(stash, 'herb')).toBe(1);
    expect(materialCount(stash, 'cloth')).toBe(1);
    // A failed payment leaves the stash untouched.
    const coinsAfter = payFor(50, stash, { coins: 200, materials: {} });
    expect(coinsAfter).toBeNull();
    expect(stash).toHaveLength(2);
  });
  it('drops emptied stacks when paying', () => {
    const stash: BagEntry[] = [{ kind: 'iron', amount: 3 }];
    expect(payFor(10, stash, { coins: 10, materials: { iron: 3 } })).toBe(0);
    expect(stash).toHaveLength(0);
  });
  it('scales the trader sale bonus with the parlour level', () => {
    expect(saleMultiplier({})).toBe(1);
    expect(saleMultiplier({ parlour: 2 })).toBeCloseTo(1.12);
  });
  it('applies raid-start bonuses: more supplies and a faster extraction that the simulation honours', () => {
    const game = makeGame();
    game.enemies = [];
    const p = addPlayer(game, 'p1');
    applyCampBonuses(p, { apothecary: 2, fletcher: 1, shrine: 3 });
    expect(p.heals).toBe(5);
    expect(p.arrows).toBe(30);
    expect(p.extractTime).toBeCloseTo(4.1);
    Object.assign(p, EXITS[0]);
    p.input.interact = true;
    tick(4.05, game);
    expect(p.status).toBe('alive');
    tick(.2, game);
    expect(p.status).toBe('extracted');
  });
  it('leaves the five-second baseline untouched without camp levels', () => {
    const game = makeGame();
    game.enemies = [];
    const p = addPlayer(game, 'p1');
    applyCampBonuses(p, {});
    expect(p.heals).toBe(3);
    expect(p.arrows).toBe(24);
    expect(p.extractTime).toBe(5);
  });
});
