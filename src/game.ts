import {
  ARMOUR_BY_ID, ITEMS, SLOTS, WEAPON_BY_ID, baseOf, entryValue, entryWeight, globalStats, isGear,
  rollDrop, rollGear, weaponProfile, type BagEntry, type Gear, type GlobalStats, type Material,
  type MaterialKind, type Slot, type WeaponKind,
} from './items';

export { ITEMS };
export type { BagEntry, Gear, Item, ItemKind, Material, MaterialKind, Slot, WeaponKind } from './items';
import type { Item, ItemKind } from './items';

/** Which weapon slot the player is currently swinging. */
export type Weapon = 'melee' | 'bow';

/** Base character values before any gear is worn. */
export const BASE_LIFE = 100;
export const BASE_STAMINA = 100;
/** PoE caps total elemental resistance per element at 75%. */
export const RES_CAP = 75;
export const BAG_SLOTS = 12;
export const BAG_WEIGHT = 22;

/** The gear every traveller is issued. It is virtual, so it is never lost. */
export const STARTER_GEAR: Record<string, Gear> = {
  sword: rollGear('sword', 'normal', 1, 101),
  katana: rollGear('katana', 'normal', 1, 102),
  bow: rollGear('bow', 'normal', 1, 103),
};
export const starterMelee = (choice: 'sword' | 'katana') => STARTER_GEAR[choice];

/** Damage split by type. Armour only touches physical, resistances only elements. */
export interface DamagePacket { physical: number; fire: number; cold: number; lightning: number }

/** The damage profile of every hostile. */
export interface EnemyKind {
  hp: number;
  armour: number;
  speed: number;
  cooldown: number;
  damage: DamagePacket;
  res: { fire: number; cold: number; lightning: number };
  loot: { kind: MaterialKind; amount: number }[];
  gearChance: number;
}
export const ENEMY_KINDS: Record<'bandit' | 'wolf' | 'knight', EnemyKind> = {
  bandit: { hp: 65, armour: 8, speed: 103, cooldown: 1.25, damage: { physical: 12, fire: 0, cold: 0, lightning: 0 }, res: { fire: 0, cold: 0, lightning: 0 }, loot: [{ kind: 'coin', amount: 2 }, { kind: 'iron', amount: 1 }], gearChance: .09 },
  wolf: { hp: 48, armour: 4, speed: 133, cooldown: .95, damage: { physical: 9, fire: 0, cold: 5, lightning: 0 }, res: { fire: 0, cold: 0, lightning: 0 }, loot: [{ kind: 'coin', amount: 1 }, { kind: 'cloth', amount: 1 }], gearChance: .07 },
  knight: { hp: 100, armour: 30, speed: 77, cooldown: 1.25, damage: { physical: 14, fire: 7, cold: 0, lightning: 0 }, res: { fire: 25, cold: 0, lightning: 0 }, loot: [{ kind: 'coin', amount: 3 }, { kind: 'relic', amount: 1 }], gearChance: .28 },
};

/** An elite is a rare champion with a guaranteed rare or better drop. */
export const ELITE_HP = 2.4;
export const ELITE_DAMAGE = 1.5;

export const WORLD = { width: 2400, height: 1800 };
export const BUILDINGS = [
  { x: 690, y: 500, w: 156, h: 118, roof: 'red' },
  { x: 956, y: 460, w: 130, h: 108, roof: 'gray' },
  { x: 640, y: 780, w: 130, h: 148, roof: 'gray' },
  { x: 990, y: 790, w: 166, h: 106, roof: 'red' },
  { x: 1460, y: 320, w: 190, h: 138, roof: 'gray' },
  { x: 1470, y: 1040, w: 150, h: 114, roof: 'red' },
  { x: 890, y: 1270, w: 140, h: 104, roof: 'gray' },
];
export const EXITS = [
  { x: 280, y: 1450, name: '巡礼者の小道', tag: '01' },
  { x: 1820, y: 250, name: '北の見張り門', tag: '02' },
  { x: 2130, y: 1430, name: '渡し守の桟橋', tag: '03' },
];

export interface Input { x: number; y: number; angle: number; attack: boolean; sprint: boolean; interact: boolean; heal: boolean; dodge: boolean; weapon: Weapon }
export const idleInput = (): Input => ({ x: 0, y: 0, angle: -Math.PI / 2, attack: false, sprint: false, interact: false, heal: false, dodge: false, weapon: 'melee' });
export interface Actor { id: string; x: number; y: number; angle: number; hp: number; maxHp: number; cooldown: number; swing: number; hurt: number }
export interface Player extends Actor {
  /** Monotonic accepted-attack counter for presentation, including skipped animation frames. */
  attackSerial?: number;
  name: string;
  stamina: number;
  arrows: number;
  heals: number;
  /** Active weapon slot. */
  weapon: Weapon;
  /** Which starter melee weapon is issued when no found weapon is equipped. */
  meleeChoice: 'sword' | 'katana';
  /** Found gear that is worn for this raid. */
  loadout: Partial<Record<Slot, Gear>>;
  /** Cached global modifiers of the worn gear. */
  globals: GlobalStats;
  /** Current energy shield pool. */
  es: number;
  /** Seconds left before the energy shield starts to recover. */
  esDelay: number;
  /** Unfinished leech from the unique items. */
  leech: number;
  bag: BagEntry[];
  status: 'alive' | 'dead' | 'extracted';
  extraction: number;
  kills: number;
  dodge: number;
  dodgeCooldown: number;
  healCooldown: number;
  input: Input;
  message: string;
  messageTime: number;
}
export interface Enemy extends Actor {
  kind: 'bandit' | 'wolf' | 'knight';
  homeX: number;
  homeY: number;
  phase: number;
  armour: number;
  res: { fire: number; cold: number; lightning: number };
  elite: boolean;
}
export interface Loot { id: string; x: number; y: number; items: BagEntry[]; opened: boolean; kind: 'chest' | 'body' | 'herb' }
export interface Arrow { id: string; owner: string; x: number; y: number; vx: number; vy: number; life: number; damage: DamagePacket; crit: boolean }
export interface GameState { time: number; duration: number; players: Player[]; enemies: Enemy[]; loot: Loot[]; arrows: Arrow[]; pvp: boolean; ended: boolean; sequence: number; rng: number }

/** Deterministic RNG kept inside the state so a raid replays identically. */
export function nextRandom(state: GameState) {
  state.rng = (state.rng + 0x6D2B79F5) >>> 0;
  let t = Math.imul(state.rng ^ (state.rng >>> 15), 1 | state.rng);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function seeded(seed: number) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
export const distance = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
export const bagWeight = (bag: BagEntry[]) => bag.reduce((s, i) => s + entryWeight(i), 0);
export const bagValue = (bag: BagEntry[]) => bag.reduce((s, i) => s + entryValue(i), 0);

/** Armour cuts physical damage, and the bigger the hit the less it helps. */
export const armourReduction = (armour: number, damage: number) => damage <= 0 || armour <= 0 ? 0 : Math.min(.9, armour / (armour + 6 * damage));
/** Evasion rating turns into a chance to avoid a hit entirely. */
export const evadeChance = (evasion: number) => evasion <= 0 ? 0 : Math.min(.55, evasion / (evasion + 120));
/** Energy shield recovers once the traveller has been left alone for a while. */
export const ES_REGEN_DELAY = 4;
export const ES_REGEN_RATE = .25;

/** Recomputes the cached global modifiers after a gear change. */
export function refreshGlobals(player: Player) {
  const active = { ...player.loadout };
  if (WEAPON_BY_ID[meleeGear(player).base]?.handed === 2) { delete active.offhand; delete active.bow; }
  player.globals = globalStats(active);
}

/** The melee weapon in use, including the issued starter. */
export const meleeGear = (player: Player) => player.loadout.melee ?? starterMelee(player.meleeChoice);
/** The bow in use, or null when a two handed weapon blocks the off hand. */
export const bowGear = (player: Player) => {
  const melee = meleeGear(player);
  if (melee && WEAPON_BY_ID[melee.base]?.handed === 2) return null;
  return player.loadout.bow ?? STARTER_GEAR.bow;
};
/** The kind of weapon drawn in the player's hands. */
export const weaponKind = (player: Player): WeaponKind => {
  const gear = player.weapon === 'bow' ? bowGear(player) : meleeGear(player);
  return gear ? WEAPON_BY_ID[gear.base]?.kind ?? 'sword' : 'sword';
};

export function makeGame(pvp = false): GameState {
  const random = seeded(83);
  const spots = [[510, 1330], [810, 650], [1130, 520], [790, 920], [1180, 850], [1580, 505], [1410, 1130], [1060, 1360], [440, 710], [1750, 860], [1240, 300], [2000, 1290], [640, 1450], [1370, 650]];
  const kinds: MaterialKind[] = ['coin', 'iron', 'cloth', 'herb', 'relic', 'ruby'];
  /** Deeper parts of the map carry higher item levels, exactly like a deeper area in PoE. */
  const ilvlAt = (x: number, y: number) => Math.max(1, Math.min(12, 1 + Math.floor(Math.hypot(x - 1200, y - 900) / 220)));
  const gearSlot = (): Slot => {
    const roll = random();
    if (roll < .22) return 'melee';
    if (roll < .34) return 'bow';
    const slots: Slot[] = ['offhand', 'helmet', 'chest', 'gloves', 'boots', 'amulet', 'ring'];
    return slots[Math.floor(random() * slots.length)];
  };
  const loot = spots.map(([x, y], i) => {
    const ilvl = ilvlAt(x, y);
    const items: BagEntry[] = [{ kind: i === 0 ? 'herb' : kinds[Math.floor(random() * 6)], amount: 1 }, { kind: 'coin', amount: 1 + Math.floor(random() * 3) }];
    if (random() < .45) items.push(rollDrop(gearSlot(), ilvl, Math.floor(random() * 1e9)));
    if (random() < .16) items.push(rollDrop(gearSlot(), ilvl, Math.floor(random() * 1e9)));
    return { id: `loot-${i}`, x, y, opened: false, kind: (i % 4 === 0 ? 'herb' : 'chest') as Loot['kind'], items };
  });
  const enemySpots = [[730, 1110], [900, 650], [1210, 800], [1400, 510], [1630, 850], [1050, 1150], [530, 740], [1560, 1330], [1830, 1210], [1160, 360], [1760, 510], [620, 1060]];
  const enemies = enemySpots.map(([x, y], i) => {
    const kind = (i % 4 === 0 ? 'knight' : i % 3 === 0 ? 'wolf' : 'bandit') as Enemy['kind'];
    const spec = ENEMY_KINDS[kind];
    const elite = i === 2 || i === 7 || i === 10;
    const hp = Math.round(spec.hp * (elite ? ELITE_HP : 1));
    return {
      id: `enemy-${i}`, x, y, homeX: x, homeY: y, hp, maxHp: hp, angle: random() * Math.PI * 2, cooldown: 1, swing: 0, hurt: 0,
      kind, phase: random() * 6, armour: Math.round(spec.armour * (elite ? 1.6 : 1)), res: { ...spec.res }, elite,
    };
  });
  return { time: 0, duration: 720, pvp, ended: false, sequence: 0, players: [], arrows: [], loot, enemies, rng: 0x9E3779B9 };
}

export function addPlayer(state: GameState, id: string, name = '名もなき旅人', meleeChoice: 'sword' | 'katana' = 'sword', loadout: Partial<Record<Slot, Gear>> = {}): Player {
  const spawns = [{ x: 420, y: 1380 }, { x: 1860, y: 350 }, { x: 2130, y: 1330 }, { x: 340, y: 650 }, { x: 1250, y: 1550 }, { x: 1270, y: 240 }, { x: 1700, y: 1530 }, { x: 340, y: 1000 }];
  const spawn = spawns[state.players.length % spawns.length];
  const player: Player = {
    id, name, ...spawn, angle: -Math.PI / 2, hp: BASE_LIFE, maxHp: BASE_LIFE, cooldown: 0, swing: 0, hurt: 0,
    attackSerial: 0, stamina: BASE_STAMINA, arrows: 24, heals: 3, weapon: 'melee', meleeChoice, loadout: { ...loadout },
    globals: globalStats(loadout), es: 0, esDelay: 0, leech: 0, bag: [], status: 'alive', extraction: 0, kills: 0,
    dodge: 0, dodgeCooldown: 0, healCooldown: 0, input: idleInput(), message: '', messageTime: 0,
  };
  refreshGlobals(player);
  player.maxHp = BASE_LIFE + player.globals.life;
  player.hp = player.maxHp;
  player.es = player.globals.energyShield;
  player.stamina = BASE_STAMINA + player.globals.stamina;
  player.input.weapon = 'melee';
  state.players.push(player);
  return player;
}

/** Removes a gear item from a container and returns it, or null when absent. */
export function takeGear(container: BagEntry[], id: string): Gear | null {
  const index = container.findIndex(entry => isGear(entry) && entry.id === id);
  if (index < 0) return null;
  const [gear] = container.splice(index, 1);
  return gear as Gear;
}

/**
 * Equips a found item during a raid. The gear that was worn goes back into
 * the bag, so nothing is ever duplicated or lost by swapping.
 */
export function equipInField(player: Player, gear: Gear): boolean {
  if (!SLOTS.includes(gear.slot)) return false;
  if (player.status !== 'alive') return false;
  const stored = player.bag.find((entry): entry is Gear => isGear(entry) && entry.id === gear.id);
  if (!stored) return false;
  const previousGear = player.loadout[stored.slot];
  if (previousGear && bagWeight(player.bag) - entryWeight(stored) + entryWeight(previousGear) > BAG_WEIGHT) return false;
  gear = takeGear(player.bag, gear.id)!;
  const previous = player.loadout[gear.slot];
  player.loadout[gear.slot] = gear;
  if (previous) player.bag.push(previous);
  refreshGlobals(player);
  const previousMax = player.maxHp;
  player.maxHp = BASE_LIFE + player.globals.life;
  player.hp = Math.min(player.hp, player.maxHp);
  player.es = Math.min(player.globals.energyShield, player.es);
  player.stamina = Math.min(BASE_STAMINA + player.globals.stamina, player.stamina);
  notify(player, `${gear.name}を装備した`);
  return true;
}

export function blocked(x: number, y: number, radius = 13): boolean {
  return x < radius || y < radius || x > WORLD.width - radius || y > WORLD.height - radius || BUILDINGS.some(b => x > b.x - radius && x < b.x + b.w + radius && y > b.y - radius && y < b.y + b.h + radius);
}
function move(a: Actor, dx: number, dy: number) { if (!blocked(a.x + dx, a.y)) a.x += dx; if (!blocked(a.x, a.y + dy)) a.y += dy; }
function notify(p: Player, text: string) { p.message = text; p.messageTime = 2.5; }

/** Applies a damage packet to a player, honouring evasion, armour, resistances and energy shield. */
export function damagePlayer(state: GameState, target: Player, packet: DamagePacket, pierce = false) {
  if (target.status !== 'alive') return 0;
  const evade = evadeChance(target.globals.evasion);
  if (evade > 0 && nextRandom(state) < evade) {
    notify(target, '回避した');
    return 0;
  }
  const physical = packet.physical * (pierce ? 1 : 1 - armourReduction(target.globals.armour, packet.physical));
  const fire = packet.fire * (1 - Math.max(-100, Math.min(RES_CAP, target.globals.res.fire)) / 100);
  const cold = packet.cold * (1 - Math.max(-100, Math.min(RES_CAP, target.globals.res.cold)) / 100);
  const lightning = packet.lightning * (1 - Math.max(-100, Math.min(RES_CAP, target.globals.res.lightning)) / 100);
  let total = Math.max(0, physical + fire + cold + lightning);
  if (total <= 0) return 0;
  target.esDelay = ES_REGEN_DELAY;
  if (target.es > 0) {
    const absorbed = Math.min(target.es, total);
    target.es -= absorbed;
    total -= absorbed;
    target.esDelay = ES_REGEN_DELAY;
  }
  target.hp = Math.max(0, target.hp - total);
  target.hurt = .22;
  if (target.hp <= 0) killPlayer(state, target);
  return total;
}

/** Applies a damage packet to a monster, which only has armour and resistances. */
export function damageEnemy(state: GameState, target: Enemy, packet: DamagePacket, pierce = false) {
  if (target.hp <= 0) return 0;
  const physical = packet.physical * (pierce ? 1 : 1 - armourReduction(target.armour, packet.physical));
  const fire = packet.fire * (1 - Math.max(-100, Math.min(RES_CAP, target.res.fire)) / 100);
  const cold = packet.cold * (1 - Math.max(-100, Math.min(RES_CAP, target.res.cold)) / 100);
  const lightning = packet.lightning * (1 - Math.max(-100, Math.min(RES_CAP, target.res.lightning)) / 100);
  const total = Math.max(0, physical + fire + cold + lightning);
  target.hp = Math.max(0, target.hp - total);
  target.hurt = .22;
  if (target.hp <= 0) dropEnemyLoot(state, target);
  return total;
}

function killPlayer(state: GameState, target: Player) {
  target.status = 'dead';
  target.hp = 0;
  // The corpse keeps the bag and the gear that was worn, so a fallen traveller is worth hunting.
  const dropped: BagEntry[] = [...target.bag, ...Object.values(target.loadout).filter((gear): gear is Gear => !!gear)];
  if (dropped.length) state.loot.push({ id: `body-${target.id}-${state.sequence++}`, x: target.x, y: target.y, items: dropped, opened: false, kind: 'body' });
  target.bag = [];
  target.loadout = {};
}

/** The unique items can drink the life they deal. */
function applyLeech(player: Player, physical: number) {
  const traits = [...(meleeGear(player)?.traits ?? []), ...(bowGear(player)?.traits ?? [])];
  if (!traits.includes('leech') || physical <= 0) return;
  player.leech += physical * .01;
  const whole = Math.floor(player.leech);
  if (whole > 0) {
    player.leech -= whole;
    player.hp = Math.min(player.maxHp, player.hp + whole);
  }
}

function hit(state: GameState, target: Actor, packet: DamagePacket, source: Player, pierce = false) {
  if ('status' in target) {
    const player = target as Player;
    if (player.status !== 'alive' || player.dodge > 0) return;
    const dealt = damagePlayer(state, player, packet, pierce);
    if (dealt > 0) { if (player.hp <= 0) source.kills++; applyLeech(source, packet.physical); }
  } else {
    const enemy = target as Enemy;
    if (enemy.hp <= 0) return;
    if (damageEnemy(state, enemy, packet, pierce) > 0) { if (enemy.hp <= 0) source.kills++; applyLeech(source, packet.physical); }
  }
}

/** Rolls the damage of a weapon hit, including the critical strike. */
export function rollWeaponDamage(state: GameState, gear: Gear | null, global?: GlobalStats) {
  const profile = weaponProfile(gear, global);
  const roll = profile.min + nextRandom(state) * (profile.max - profile.min);
  const crit = nextRandom(state) < profile.crit / 100;
  const multiplier = crit ? profile.critMulti : 1;
  return {
    packet: {
      physical: roll * multiplier,
      fire: profile.fire * multiplier,
      cold: profile.cold * multiplier,
      lightning: profile.lightning * multiplier,
    },
    crit,
    profile,
  };
}

/** Collects the loot of a container, respecting the bag slots and the weight limit. */
export function collectLoot(p: Player, loot: Loot): number {
  let count = 0;
  const rest: BagEntry[] = [];
  for (const item of loot.items) {
    if (p.bag.length < BAG_SLOTS && bagWeight(p.bag) + entryWeight(item) <= BAG_WEIGHT) { p.bag.push(item); count++; }
    else rest.push(item);
  }
  loot.items = rest; loot.opened = rest.length === 0;
  notify(p, count ? `${count}点の物資を回収` : 'バックパックがいっぱいです');
  return count;
}

export function sanitizeInput(raw: unknown, primary: 'sword' | 'katana'): Input {
  const i = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const num = (n: unknown, max: number) => typeof n === 'number' && Number.isFinite(n) ? Math.max(-max, Math.min(max, n)) : 0;
  return { x: num(i.x, 1), y: num(i.y, 1), angle: num(i.angle, Math.PI * 2), attack: i.attack === true, sprint: i.sprint === true, interact: i.interact === true, heal: i.heal === true, dodge: i.dodge === true, weapon: i.weapon === 'bow' ? 'bow' : 'melee' };
}

export function stepGame(state: GameState, delta: number) {
  if (state.ended) return;
  const dt = Math.max(0, Math.min(.05, delta)); state.time += dt;
  if (state.time >= state.duration) {
    state.ended = true;
    for (const p of state.players) if (p.status === 'alive') { p.status = 'dead'; p.hp = 0; p.bag = []; }
    return;
  }
  for (const p of state.players) {
    if (p.status !== 'alive') continue;
    const i = p.input;
    p.cooldown -= dt; p.swing = Math.max(0, p.swing - dt); p.hurt = Math.max(0, p.hurt - dt); p.dodge = Math.max(0, p.dodge - dt); p.dodgeCooldown -= dt; p.healCooldown -= dt; p.messageTime -= dt;
    p.esDelay = Math.max(0, p.esDelay - dt);
    if (p.esDelay <= 0 && p.es < p.globals.energyShield) p.es = Math.min(p.globals.energyShield, p.es + p.globals.energyShield * ES_REGEN_RATE * dt);
    p.angle = i.angle;
    p.weapon = i.weapon === 'bow' ? 'bow' : 'melee';
    const len = Math.hypot(i.x, i.y);
    const baseSpeed = 140 * (1 + p.globals.moveSpeedPct / 100);
    let speed = baseSpeed;
    if (i.sprint && len > 0 && p.stamina > 2) { speed = baseSpeed * 1.55; p.stamina = Math.max(0, p.stamina - 23 * dt); }
    else p.stamina = Math.min(BASE_STAMINA + p.globals.stamina, p.stamina + 18 * dt);
    if (i.dodge && p.dodgeCooldown <= 0 && p.stamina >= 25) { p.dodge = .2; p.dodgeCooldown = .9; p.stamina -= 25; }
    if (p.dodge > 0) speed = 480;
    if (len > 0) move(p, i.x / Math.max(1, len) * speed * dt, i.y / Math.max(1, len) * speed * dt);
    if (i.heal && p.heals > 0 && p.hp < p.maxHp && p.healCooldown <= 0) { p.hp = Math.min(p.maxHp, p.hp + 45); p.heals--; p.healCooldown = 1.4; notify(p, '治療薬を使用 · 体力 +45'); }
    if (i.attack && p.cooldown <= 0) {
      const usingBow = p.weapon === 'bow' && !!bowGear(p);
      const gear = usingBow ? bowGear(p) : meleeGear(p);
      const profile = weaponProfile(gear, p.globals);
      if (p.stamina >= profile.stamina && (usingBow ? p.arrows > 0 : true)) {
        p.attackSerial = (p.attackSerial ?? 0) + 1;
        p.cooldown = 1 / profile.attackSpeed; p.swing = .22; p.stamina -= profile.stamina;
        const { packet, profile: used } = rollWeaponDamage(state, gear, p.globals);
        const pierce = (used.traits ?? []).includes('pierce');
        if (usingBow) {
          p.arrows--;
          state.arrows.push({ id: `arrow-${state.sequence++}`, owner: p.id, x: p.x + Math.cos(p.angle) * 20, y: p.y + Math.sin(p.angle) * 20, vx: Math.cos(p.angle) * 640, vy: Math.sin(p.angle) * 640, life: .95, damage: packet, crit: false });
        } else {
          const targets: Actor[] = [...state.enemies.filter(e => e.hp > 0), ...(state.pvp ? state.players.filter(o => o.id !== p.id && o.status === 'alive') : [])];
          for (const e of targets) { const angle = Math.atan2(e.y - p.y, e.x - p.x) - p.angle; if (distance(e, p) < used.range && Math.cos(angle) > .1) hit(state, e, packet, p, pierce); }
        }
      } else if (usingBow) notify(p, '矢がありません · 1キーで近接武器');
    }
    const exit = EXITS.find(e => distance(p, e) < 65);
    if (exit && i.interact) { p.extraction += dt; if (p.extraction >= 5) { p.status = 'extracted'; notify(p, '脱出成功'); } }
    else { p.extraction = 0; if (i.interact) { const loot = state.loot.find(l => !l.opened && distance(l, p) < 74); if (loot) collectLoot(p, loot); } }
  }
  for (const e of state.enemies) {
    if (e.hp <= 0) continue;
    e.cooldown -= dt; e.swing = Math.max(0, e.swing - dt); e.hurt = Math.max(0, e.hurt - dt);
    const target = state.players.filter(p => p.status === 'alive').sort((a, b) => distance(a, e) - distance(b, e))[0];
    const d = target ? distance(target, e) : Infinity;
    if (target && d < 310) {
      e.angle = Math.atan2(target.y - e.y, target.x - e.x);
      if (d > 39) { const speed = e.kind === 'wolf' ? 133 : e.kind === 'knight' ? 77 : 103; move(e, Math.cos(e.angle) * speed * dt, Math.sin(e.angle) * speed * dt); }
      if (d < 52 && e.cooldown <= 0) {
        e.swing = .3; e.cooldown = e.kind === 'wolf' ? .95 : 1.25;
        if (target.dodge <= 0) {
          const spec = ENEMY_KINDS[e.kind];
          const scale = e.elite ? ELITE_DAMAGE : 1;
          damagePlayer(state, target, { physical: spec.damage.physical * scale, fire: spec.damage.fire * scale, cold: spec.damage.cold * scale, lightning: spec.damage.lightning * scale });
        }
      }
    } else {
      const tx = e.homeX + Math.cos(state.time * .13 + e.phase) * 55, ty = e.homeY + Math.sin(state.time * .17 + e.phase) * 45;
      e.angle = Math.atan2(ty - e.y, tx - e.x); if (Math.hypot(tx - e.x, ty - e.y) > 5) move(e, Math.cos(e.angle) * 24 * dt, Math.sin(e.angle) * 24 * dt);
    }
  }
  for (const a of state.arrows) {
    a.x += a.vx * dt; a.y += a.vy * dt; a.life -= dt;
    if (blocked(a.x, a.y, 2)) { a.life = 0; continue; }
    const owner = state.players.find(p => p.id === a.owner);
    if (!owner) continue;
    const targets: Actor[] = [...state.enemies.filter(e => e.hp > 0), ...(state.pvp ? state.players.filter(p => p.id !== a.owner && p.status === 'alive') : [])];
    const target = targets.find(e => distance(e, a) < 27);
    if (target) {
      const pierce = (meleeGear(owner)?.traits ?? []).includes('pierce');
      hit(state, target, a.damage, owner, pierce);
      a.life = 0;
    }
  }
  state.arrows = state.arrows.filter(a => a.life > 0);
}

/** Loot dropped by a defeated monster. */
export function dropEnemyLoot(state: GameState, enemy: Enemy) {
  const spec = ENEMY_KINDS[enemy.kind];
  const items: BagEntry[] = spec.loot.map(l => ({ kind: l.kind, amount: l.amount }));
  if (enemy.elite) {
    items.push(rollDrop(enemy.kind === 'knight' ? 'melee' : 'offhand', 8 + Math.floor(nextRandom(state) * 4), Math.floor(nextRandom(state) * 1e9), 'rare'));
  } else if (nextRandom(state) < spec.gearChance) {
    const slot: Slot = nextRandom(state) < .4 ? 'melee' : (['offhand', 'helmet', 'chest', 'gloves', 'boots', 'amulet', 'ring'] as Slot[])[Math.floor(nextRandom(state) * 7)];
    items.push(rollDrop(slot, 2 + Math.floor(nextRandom(state) * 9), Math.floor(nextRandom(state) * 1e9)));
  }
  state.loot.push({ id: `body-${enemy.id}`, x: enemy.x, y: enemy.y, items, opened: false, kind: 'body' });
}

/** Average damage per second of a weapon, the number players compare builds with. */
export function weaponDps(gear: Gear | null, global?: GlobalStats) {
  const profile = weaponProfile(gear, global);
  const average = (profile.min + profile.max) / 2;
  return average * profile.attackSpeed * (1 + (profile.crit / 100) * (profile.critMulti - 1));
}

/** Tooltip helper: the base type of a gear entry. */
export function gearBase(gear: Gear) { return baseOf(gear); }
export const materialValue = (item: Material) => ITEMS[item.kind].value * item.amount;
export const isArmourSlot = (slot: Slot) => slot in ARMOUR_BY_ID || ['offhand', 'helmet', 'chest', 'gloves', 'boots', 'amulet', 'ring'].includes(slot);
export type { Item as BagItem };
