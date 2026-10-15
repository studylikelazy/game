import { describe, expect, it } from 'vitest';
import { addPlayer, armourReduction, bagValue, bagWeight, blocked, BUILDINGS, collectLoot, damagePlayer, equipInField, EXITS, idleInput, makeGame, refreshGlobals, sanitizeInput, stepGame, type GameState } from '../src/game';
import { RARITIES, WEAPON_BY_ID, isGear, rollDrop, rollGear, sanitizeGear, type Slot } from '../src/items';

function tick(game: GameState, seconds: number) { for (let i = 0; i < Math.ceil(seconds * 60); i++) stepGame(game, 1 / 60); }
function empty(pvp = false) { const g = makeGame(pvp); g.enemies = []; const p = addPlayer(g, 'p1'); return { g, p }; }

describe('world and movement', () => {
  it('creates the same world for client and server', () => { expect(makeGame()).toEqual(makeGame()); });
  it('moves at a bounded speed and normalizes diagonal input', () => {
    const { g, p } = empty(); p.x = 300; p.y = 300; p.input = { ...idleInput(), x: 1, y: 1 }; tick(g, 1);
    expect(Math.hypot(p.x - 300, p.y - 300)).toBeCloseTo(140, 4);
  });
  it('prevents walking through walls and map boundaries', () => {
    const { g, p } = empty(); const b = BUILDINGS[0]; p.x = b.x - 15; p.y = b.y + 40; p.input.x = 1; tick(g, .5); expect(p.x).toBeLessThan(b.x - 12);
    p.x = 15; p.y = 200; p.input.x = -1; tick(g, 1); expect(p.x).toBeGreaterThanOrEqual(13);
    expect(blocked(-1, 20)).toBe(true);
  });
  it('sprinting consumes stamina and idle regenerates it', () => {
    const { g, p } = empty(); p.x = 300; p.y = 200; p.input.x = 1; p.input.sprint = true; tick(g, 1); expect(p.stamina).toBeCloseTo(77, 3); expect(p.x).toBeCloseTo(517, 3); p.input.sprint = false; p.input.x = 0; tick(g, 1); expect(p.stamina).toBeCloseTo(95, 3);
  });
  it('caps large time steps', () => { const { g } = empty(); stepGame(g, 500); expect(g.time).toBe(.05); });
});

describe('combat and supplies', () => {
  it('melee hits a forward target, respects cooldown, and never hits a distant target', () => {
    const g = makeGame(); const p = addPlayer(g, 'p'); g.enemies = [g.enemies[1]]; const e = g.enemies[0]; e.x = p.x + 45; e.y = p.y; p.input.angle = 0; p.input.attack = true;
    stepGame(g, 1 / 60); const dealt = 65 - e.hp;
    // The starter sword rolls 22-30 physical and the bandit soaks a slice with armour.
    expect(dealt).toBeGreaterThan(15); expect(dealt).toBeLessThan(40);
    stepGame(g, 1 / 60); expect(e.hp).toBe(65 - dealt);
    e.x = p.x + 200; p.cooldown = 0; stepGame(g, 1 / 60); expect(e.hp).toBe(65 - dealt);
  });
  it('does not hit targets behind the player', () => {
    const g = makeGame(); const p = addPlayer(g, 'p'); const e = g.enemies[0]; g.enemies = [e]; e.x = p.x - 50; e.y = p.y; p.input.angle = 0; p.input.attack = true; stepGame(g, 1 / 60); expect(e.hp).toBe(100);
  });
  it('bow consumes arrows and projectiles deal damage', () => {
    const g = makeGame(); const p = addPlayer(g, 'p'); const e = g.enemies[1]; g.enemies = [e]; e.x = p.x + 130; e.y = p.y; p.input.weapon = 'bow'; p.input.angle = 0; p.input.attack = true; stepGame(g, 1 / 60); p.input.attack = false; tick(g, .2); expect(p.arrows).toBe(23); expect(65 - e.hp).toBeGreaterThan(20); expect(g.arrows.length).toBe(0);
  });
  it('empty bow cannot fire', () => { const { g, p } = empty(); p.arrows = 0; p.input.weapon = 'bow'; p.input.attack = true; tick(g, .1); expect(g.arrows).toHaveLength(0); expect(p.arrows).toBe(0); });
  it('players damage each other only in PvP mode', () => {
    for (const pvp of [false, true]) { const { g, p } = empty(pvp); const target = addPlayer(g, 'p2'); target.x = p.x + 40; target.y = p.y; p.input.angle = 0; p.input.attack = true; stepGame(g, .016); if (pvp) expect(target.hp).toBeLessThan(100); else expect(target.hp).toBe(100); }
  });
  it('dodge grants short invulnerability and costs stamina', () => {
    const { g, p } = empty(true); const target = addPlayer(g, 'p2'); target.x = p.x + 40; target.y = p.y; target.dodge = .1; p.input.angle = 0; p.input.attack = true; stepGame(g, .016); expect(target.hp).toBe(100);
    p.input.attack = false; p.input.dodge = true; const before = p.stamina; stepGame(g, .016); expect(p.dodge).toBeGreaterThan(0); expect(p.stamina).toBeLessThan(before - 20);
  });
  it('healing restores 45 HP without exceeding max or duplicating supplies', () => {
    const { g, p } = empty(); p.hp = 30; p.input.heal = true; stepGame(g, .016); expect(p.hp).toBe(75); expect(p.heals).toBe(2); stepGame(g, .016); expect(p.heals).toBe(2); tick(g, 1.5); expect(p.hp).toBe(100); expect(p.heals).toBe(1); tick(g, 2); expect(p.heals).toBe(1);
  });
  it('dead players stop acting and drop loot exactly once', () => {
    const { g, p } = empty(true); const target = addPlayer(g, 'p2'); target.x = p.x + 40; target.y = p.y; target.hp = 5; target.bag = [{ kind: 'ruby', amount: 1 }]; p.input.attack = true; p.input.angle = 0; stepGame(g, .016); expect(target.status).toBe('dead'); expect(p.kills).toBe(1); expect(g.loot.filter(l => l.id.startsWith('body-'))).toHaveLength(1); expect(target.bag).toHaveLength(0); tick(g, 1); expect(p.kills).toBe(1);
  });
});

describe('looting and extraction', () => {
  it('collects items and cannot recollect opened containers', () => {
    const { g, p } = empty(); const loot = g.loot[0]; loot.items = [{ kind: 'herb', amount: 1 }, { kind: 'coin', amount: 1 }]; p.x = loot.x; p.y = loot.y; p.input.interact = true; tick(g, .2); expect(p.bag).toHaveLength(2); expect(loot.opened).toBe(true); tick(g, .2); expect(p.bag).toHaveLength(2); expect(bagValue(p.bag)).toBeGreaterThan(0);
  });
  it('enforces inventory slot and weight capacities without deleting leftover loot', () => {
    const { g, p } = empty(); p.bag = Array.from({ length: 12 }, () => ({ kind: 'coin' as const, amount: 1 })); const loot = g.loot[0]; loot.items = [{ kind: 'herb', amount: 1 }, { kind: 'coin', amount: 1 }]; expect(collectLoot(p, loot)).toBe(0); expect(loot.items).toHaveLength(2); expect(loot.opened).toBe(false);
    p.bag = [{ kind: 'iron', amount: 15 }]; loot.items = [{ kind: 'relic', amount: 1 }, { kind: 'herb', amount: 1 }]; expect(collectLoot(p, loot)).toBe(1); expect(bagWeight(p.bag)).toBeCloseTo(21.3); expect(loot.items).toEqual([{ kind: 'relic', amount: 1 }]);
  });
  it('extracts only after holding interact in an exit for five continuous seconds', () => {
    const { g, p } = empty(); Object.assign(p, EXITS[0]); p.bag = [{ kind: 'ruby', amount: 1 }]; p.input.interact = true; tick(g, 3); expect(p.status).toBe('alive'); p.input.interact = false; tick(g, .1); expect(p.extraction).toBe(0); p.input.interact = true; tick(g, 5.1); expect(p.status).toBe('extracted'); expect(p.bag).toHaveLength(1); const x = p.x; p.input.x = 1; tick(g, 1); expect(p.x).toBe(x);
  });
  it('clears unextracted loot on timeout but preserves extracted loot', () => {
    const { g, p } = empty(); p.bag = [{ kind: 'ruby', amount: 1 }]; const other = addPlayer(g, 'p2'); other.bag = [{ kind: 'iron', amount: 1 }]; other.status = 'extracted'; g.time = g.duration - .01; stepGame(g, .02); expect(p.status).toBe('dead'); expect(p.bag).toHaveLength(0); expect(g.ended).toBe(true); expect(other.status).toBe('extracted'); expect(other.bag).toHaveLength(1);
  });
});

describe('item rarity model', () => {
  it('offers the four PoE rarities with the expected affix budget', () => {
    expect(Object.keys(RARITIES)).toEqual(['normal', 'magic', 'rare', 'unique']);
    expect(RARITIES.normal.maxAffixes).toBe(0);
    expect(RARITIES.magic.maxAffixes).toBe(2);
    expect(RARITIES.rare.maxAffixes).toBe(6);
  });
  it('rolls a normal item without affixes and a rare item with several', () => {
    const normal = rollGear('sword', 'normal', 5, 4242);
    expect(normal.rarity).toBe('normal'); expect(normal.affixes).toHaveLength(0);
    const rare = rollGear('sword', 'rare', 12, 4242);
    expect(rare.rarity).toBe('rare'); expect(rare.affixes.length).toBeGreaterThanOrEqual(3); expect(rare.affixes.length).toBeLessThanOrEqual(6);
  });
  it('keeps affix tiers within the item level range', () => {
    const low = rollGear('chain_cuirass', 'rare', 1, 99);
    for (const affix of low.affixes) expect(affix.tier).toBeLessThanOrEqual(3);
    const high = rollGear('chain_cuirass', 'rare', 30, 99);
    expect(high.affixes.length).toBeGreaterThan(0);
  });
  it('rebuilds the exact same item from base, rarity, item level and seed', () => {
    const drop = rollDrop('melee', 9, 777777);
    const rebuilt = sanitizeGear({ base: drop.base, rarity: drop.rarity, ilvl: drop.ilvl, seed: drop.seed });
    expect(rebuilt).not.toBeNull();
    expect(rebuilt!.id).toBe(drop.id);
    expect(rebuilt!.affixes).toEqual(drop.affixes);
    expect(rebuilt!.name).toBe(drop.name);
  });
  it('refuses to rebuild gear from an unknown base type', () => {
    expect(sanitizeGear({ base: 'laser_sword', rarity: 'rare', ilvl: 5, seed: 1 })).toBeNull();
    expect(sanitizeGear(null)).toBeNull();
  });
});

describe('equipment and defence', () => {
  it('a two handed weapon removes the bow from the loadout', () => {
    const g = makeGame(); const p = addPlayer(g, 'p');
    const greatsword = rollGear('greatsword', 'rare', 10, 31337);
    p.loadout.melee = greatsword;
    expect(p.loadout.bow).toBeUndefined();
    expect(WEAPON_BY_ID[greatsword.base].handed).toBe(2);
  });
  it('armour and resistances reduce incoming damage', () => {
    const g = makeGame(); const p = addPlayer(g, 'p');
    const bare = p.globals.armour;
    p.loadout.chest = rollGear('chain_cuirass', 'rare', 12, 5150);
    refreshGlobals(p);
    expect(p.globals.armour).toBeGreaterThan(bare);
    // A bigger hit is cut by a smaller share of the armour value, like in PoE.
    expect(armourReduction(p.globals.armour, 20)).toBeGreaterThan(armourReduction(p.globals.armour, 200));
    expect(armourReduction(p.globals.armour, 20)).toBeLessThan(.9);
  });
  it('energy shield absorbs damage before life and recovers when left alone', () => {
    const g = makeGame(); const p = addPlayer(g, 'p');
    p.loadout.chest = rollGear('monk_robe', 'rare', 12, 8123);
    refreshGlobals(p);
    expect(p.globals.energyShield).toBeGreaterThan(0);
    p.globals.evasion = 0;
    p.es = p.globals.energyShield; p.hp = p.maxHp;
    damagePlayer(g, p, { physical: 15, fire: 0, cold: 0, lightning: 0 });
    expect(p.hp).toBe(p.maxHp);
    expect(p.es).toBeLessThan(p.globals.energyShield);
    p.esDelay = 0;
    tick(g, 1);
    expect(p.es).toBeGreaterThan(0);
  });
  it('equipping in the field swaps the worn item into the bag without duplicating it', () => {
    const g = makeGame(); const p = addPlayer(g, 'p');
    const gear = rollGear('steel_helm', 'magic', 4, 24680);
    p.bag.push(gear);
    const before = p.bag.length;
    expect(equipInField(p, gear)).toBe(true);
    expect(p.loadout.helmet?.id).toBe(gear.id);
    expect(p.bag).toHaveLength(before - 1);
    expect(p.bag.some(entry => isGear(entry) && entry.id === gear.id)).toBe(false);
  });
  it('every armour slot accepts its own base type', () => {
    const slots: Slot[] = ['offhand', 'helmet', 'chest', 'gloves', 'boots', 'amulet', 'ring'];
    for (const slot of slots) {
      const base = slot === 'offhand' ? 'iron_buckler' : slot === 'helmet' ? 'steel_helm' : slot === 'chest' ? 'monk_robe' : slot === 'gloves' ? 'plated_gauntlet' : slot === 'boots' ? 'swift_boots' : slot === 'amulet' ? 'bone_amulet' : 'brass_ring';
      const gear = rollGear(base, 'magic', 6, 991);
      expect(gear.slot).toBe(slot);
    }
  });
});

describe('multiplayer input boundary', () => {
  it('rejects malformed values, cheats, invalid weapons and non-boolean actions', () => {
    const clean = sanitizeInput({ x: 99999, y: -Infinity, angle: NaN, attack: 'true', heal: true, weapon: 'rocket', hp: 9999 }, 'katana');
    expect(clean.x).toBe(1); expect(clean.y).toBe(0); expect(clean.angle).toBe(0); expect(clean.attack).toBe(false); expect(clean.heal).toBe(true); expect(clean.weapon).toBe('melee'); expect(clean).not.toHaveProperty('hp');
  });
  it('keeps a valid bow request', () => { expect(sanitizeInput({ weapon: 'bow' }, 'sword').weapon).toBe('bow'); });
  it('safely accepts null and primitives', () => { expect(sanitizeInput(null, 'sword').x).toBe(0); expect(sanitizeInput('bad', 'sword').attack).toBe(false); });
});
