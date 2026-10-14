export type Weapon = 'sword' | 'katana' | 'bow';
export type ItemKind = 'coin' | 'iron' | 'herb' | 'cloth' | 'relic' | 'ruby';
export interface Item { kind: ItemKind; amount: number }
export const ITEMS: Record<ItemKind, { name: string; value: number; weight: number; rarity: string }> = {
  coin: { name: '古王国の銀貨', value: 35, weight: .1, rarity: 'common' },
  iron: { name: '鍛鉄の欠片', value: 65, weight: 1.4, rarity: 'common' },
  herb: { name: '月露草', value: 90, weight: .3, rarity: 'uncommon' },
  cloth: { name: '亜麻の織物', value: 55, weight: .6, rarity: 'common' },
  relic: { name: '修道院の聖遺物', value: 340, weight: 1.8, rarity: 'rare' },
  ruby: { name: '深紅の宝石', value: 580, weight: .2, rarity: 'epic' },
};
export const WEAPONS = {
  sword: { name: '鉄のロングソード', damage: 28, range: 76, cooldown: .48, stamina: 12 },
  katana: { name: '東方の打刀', damage: 22, range: 88, cooldown: .32, stamina: 10 },
  bow: { name: '狩人の長弓', damage: 32, range: 540, cooldown: .7, stamina: 8 },
};
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
export const idleInput = (): Input => ({ x: 0, y: 0, angle: -Math.PI / 2, attack: false, sprint: false, interact: false, heal: false, dodge: false, weapon: 'sword' });
export interface Actor { id: string; x: number; y: number; angle: number; hp: number; maxHp: number; cooldown: number; swing: number; hurt: number }
export interface Player extends Actor { name: string; stamina: number; arrows: number; heals: number; weapon: Weapon; primary: 'sword' | 'katana'; bag: Item[]; status: 'alive' | 'dead' | 'extracted'; extraction: number; kills: number; dodge: number; dodgeCooldown: number; healCooldown: number; input: Input; message: string; messageTime: number }
export interface Enemy extends Actor { kind: 'bandit' | 'wolf' | 'knight'; homeX: number; homeY: number; phase: number }
export interface Loot { id: string; x: number; y: number; items: Item[]; opened: boolean; kind: 'chest' | 'body' | 'herb' }
export interface Arrow { id: string; owner: string; x: number; y: number; vx: number; vy: number; life: number }
export interface GameState { time: number; duration: number; players: Player[]; enemies: Enemy[]; loot: Loot[]; arrows: Arrow[]; pvp: boolean; ended: boolean; sequence: number }
export function seeded(seed: number) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
export const distance = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
export const bagWeight = (bag: Item[]) => bag.reduce((s, i) => s + ITEMS[i.kind].weight * i.amount, 0);
export const bagValue = (bag: Item[]) => bag.reduce((s, i) => s + ITEMS[i.kind].value * i.amount, 0);
export function makeGame(pvp = false): GameState {
  const random = seeded(83);
  const spots = [[510, 1330], [810, 650], [1130, 520], [790, 920], [1180, 850], [1580, 505], [1410, 1130], [1060, 1360], [440, 710], [1750, 860], [1240, 300], [2000, 1290], [640, 1450], [1370, 650]];
  const kinds: ItemKind[] = ['coin', 'iron', 'cloth', 'herb', 'relic', 'ruby'];
  return {
    time: 0, duration: 720, pvp, ended: false, sequence: 0, players: [], arrows: [],
    loot: spots.map(([x, y], i) => ({ id: `loot-${i}`, x, y, opened: false, kind: i % 4 === 0 ? 'herb' : 'chest', items: [{ kind: i === 0 ? 'herb' : kinds[Math.floor(random() * 6)], amount: 1 }, { kind: 'coin', amount: 1 + Math.floor(random() * 3) }] })),
    enemies: [[730, 1110], [900, 650], [1210, 800], [1400, 510], [1630, 850], [1050, 1150], [530, 740], [1560, 1330], [1830, 1210], [1160, 360], [1760, 510], [620, 1060]].map(([x, y], i) => ({ id: `enemy-${i}`, x, y, homeX: x, homeY: y, hp: i % 4 === 0 ? 100 : i % 3 === 0 ? 48 : 65, maxHp: i % 4 === 0 ? 100 : i % 3 === 0 ? 48 : 65, angle: random() * Math.PI * 2, cooldown: 1, swing: 0, hurt: 0, kind: i % 4 === 0 ? 'knight' : i % 3 === 0 ? 'wolf' : 'bandit', phase: random() * 6 })),
  };
}
export function addPlayer(state: GameState, id: string, name = '名もなき旅人', primary: 'sword' | 'katana' = 'sword'): Player {
  const spawns = [{ x: 420, y: 1380 }, { x: 1860, y: 350 }, { x: 2130, y: 1330 }, { x: 340, y: 650 }, { x: 1250, y: 1550 }, { x: 1270, y: 240 }, { x: 1700, y: 1530 }, { x: 340, y: 1000 }];
  const spawn = spawns[state.players.length % spawns.length];
  const player: Player = { id, name, ...spawn, angle: -Math.PI / 2, hp: 100, maxHp: 100, cooldown: 0, swing: 0, hurt: 0, stamina: 100, arrows: 24, heals: 3, weapon: primary, primary, bag: [], status: 'alive', extraction: 0, kills: 0, dodge: 0, dodgeCooldown: 0, healCooldown: 0, input: idleInput(), message: '', messageTime: 0 };
  player.input.weapon = primary;
  state.players.push(player);
  return player;
}
export function blocked(x: number, y: number, radius = 13): boolean {
  return x < radius || y < radius || x > WORLD.width - radius || y > WORLD.height - radius || BUILDINGS.some(b => x > b.x - radius && x < b.x + b.w + radius && y > b.y - radius && y < b.y + b.h + radius);
}
function move(a: Actor, dx: number, dy: number) { if (!blocked(a.x + dx, a.y)) a.x += dx; if (!blocked(a.x, a.y + dy)) a.y += dy; }
function notify(p: Player, text: string) { p.message = text; p.messageTime = 2.5; }
function hit(state: GameState, target: Actor, amount: number, source: Player) {
  if ('status' in target && ((target as Player).status !== 'alive' || (target as Player).dodge > 0)) return;
  target.hp = Math.max(0, target.hp - amount); target.hurt = .22;
  if (target.hp <= 0) {
    source.kills++;
    if ('status' in target) {
      const p = target as Player; p.status = 'dead';
      if (p.bag.length) state.loot.push({ id: `body-${p.id}-${state.sequence++}`, x: p.x, y: p.y, items: [...p.bag], opened: false, kind: 'body' });
      p.bag = [];
    } else {
      state.loot.push({ id: `body-${target.id}`, x: target.x, y: target.y, items: [{ kind: 'coin', amount: 2 }, { kind: (target as Enemy).kind === 'knight' ? 'relic' : 'iron', amount: 1 }], opened: false, kind: 'body' });
    }
  }
}
export function collectLoot(p: Player, loot: Loot): number {
  let count = 0;
  const rest: Item[] = [];
  for (const item of loot.items) {
    if (p.bag.length < 12 && bagWeight(p.bag) + ITEMS[item.kind].weight * item.amount <= 22) { p.bag.push(item); count++; }
    else rest.push(item);
  }
  loot.items = rest; loot.opened = rest.length === 0;
  notify(p, count ? `${count}点の物資を回収` : 'バックパックがいっぱいです');
  return count;
}
export function sanitizeInput(raw: unknown, primary: 'sword' | 'katana'): Input {
  const i = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const num = (n: unknown, max: number) => typeof n === 'number' && Number.isFinite(n) ? Math.max(-max, Math.min(max, n)) : 0;
  return { x: num(i.x, 1), y: num(i.y, 1), angle: num(i.angle, Math.PI * 2), attack: i.attack === true, sprint: i.sprint === true, interact: i.interact === true, heal: i.heal === true, dodge: i.dodge === true, weapon: i.weapon === 'bow' ? 'bow' : primary };
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
    p.angle = i.angle; p.weapon = i.weapon === 'bow' ? 'bow' : p.primary;
    const len = Math.hypot(i.x, i.y); let speed = 140;
    if (i.sprint && len > 0 && p.stamina > 2) { speed = 218; p.stamina = Math.max(0, p.stamina - 23 * dt); }
    else p.stamina = Math.min(100, p.stamina + 18 * dt);
    if (i.dodge && p.dodgeCooldown <= 0 && p.stamina >= 25) { p.dodge = .2; p.dodgeCooldown = .9; p.stamina -= 25; }
    if (p.dodge > 0) speed = 480;
    if (len > 0) move(p, i.x / Math.max(1, len) * speed * dt, i.y / Math.max(1, len) * speed * dt);
    if (i.heal && p.heals > 0 && p.hp < 100 && p.healCooldown <= 0) { p.hp = Math.min(100, p.hp + 45); p.heals--; p.healCooldown = 1.4; notify(p, '治療薬を使用 · 体力 +45'); }
    if (i.attack && p.cooldown <= 0 && p.stamina >= WEAPONS[p.weapon].stamina) {
      const w = WEAPONS[p.weapon];
      if (p.weapon !== 'bow' || p.arrows > 0) {
        p.cooldown = w.cooldown; p.swing = .22; p.stamina -= w.stamina;
        if (p.weapon === 'bow') { p.arrows--; state.arrows.push({ id: `arrow-${state.sequence++}`, owner: p.id, x: p.x + Math.cos(p.angle) * 20, y: p.y + Math.sin(p.angle) * 20, vx: Math.cos(p.angle) * 640, vy: Math.sin(p.angle) * 640, life: .95 }); }
        else {
          const targets: Actor[] = [...state.enemies.filter(e => e.hp > 0), ...(state.pvp ? state.players.filter(o => o.id !== p.id && o.status === 'alive') : [])];
          for (const e of targets) { const angle = Math.atan2(e.y - p.y, e.x - p.x) - p.angle; if (distance(e, p) < w.range && Math.cos(angle) > .1) hit(state, e, w.damage, p); }
        }
      } else notify(p, '矢がありません · 1キーで近接武器');
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
        if (target.dodge <= 0) { target.hp = Math.max(0, target.hp - (e.kind === 'knight' ? 19 : 12)); target.hurt = .25; if (!target.hp) { target.status = 'dead'; if (target.bag.length) state.loot.push({ id: `body-${target.id}-${state.sequence++}`, x: target.x, y: target.y, items: [...target.bag], opened: false, kind: 'body' }); target.bag = []; } }
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
    if (target) { hit(state, target, WEAPONS.bow.damage, owner); a.life = 0; }
  }
  state.arrows = state.arrows.filter(a => a.life > 0);
}
