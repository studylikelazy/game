import { isGear, type BagEntry, type MaterialKind } from './items';
import type { Player } from './game';

/**
 * Camp upgrades: the hideout-style meta progression from modern extraction
 * games. Levels are permanent, bought with coins plus the materials that
 * would otherwise only be sold, and give every raid a small head start.
 */
export interface CampCost { coins: number; materials: Partial<Record<MaterialKind, number>> }

export interface CampUpgrade {
  id: string;
  name: string;
  english: string;
  icon: string;
  flavor: string;
  /** One-line summary of what the current level does. */
  effectText: (level: number) => string;
  maxLevel: number;
  /** cost[0] buys level 1, cost[1] level 2, and so on. */
  costs: CampCost[];
}

export const CAMP_UPGRADES: CampUpgrade[] = [
  {
    id: 'apothecary', name: '薬師の棚', english: 'APOTHECARY SHELF', icon: 'potion',
    flavor: '干し薬草と蒸留酒。傷は、帰るまで我慢できる範囲で。',
    effectText: lv => lv ? `治療薬の携行 +${lv}` : '治療薬の携行を増やす',
    maxLevel: 3,
    costs: [
      { coins: 250, materials: { herb: 2 } },
      { coins: 520, materials: { herb: 4, cloth: 2 } },
      { coins: 900, materials: { herb: 6, relic: 1 } },
    ],
  },
  {
    id: 'fletcher', name: '矢作りの作業台', english: 'FLETCHING BENCH', icon: 'bow',
    flavor: '矢羽は鷲の羽。狩人は落とし物から作り直す。',
    effectText: lv => lv ? `矢の携行 +${lv * 6}` : '矢の携行を増やす',
    maxLevel: 3,
    costs: [
      { coins: 200, materials: { cloth: 2 } },
      { coins: 420, materials: { cloth: 4, iron: 2 } },
      { coins: 760, materials: { cloth: 6, iron: 4 } },
    ],
  },
  {
    id: 'shrine', name: '祈りの祠', english: 'WAYFARER SHRINE', icon: 'relic',
    flavor: '旅人が縋るのは、鎧か、それとも神か。',
    effectText: lv => lv ? `脱出に要する秒数 -${(lv * .3).toFixed(1)}秒` : '脱出を少し早める',
    maxLevel: 3,
    costs: [
      { coins: 320, materials: { relic: 1 } },
      { coins: 640, materials: { relic: 2, herb: 2 } },
      { coins: 1100, materials: { relic: 3, ruby: 1 } },
    ],
  },
  {
    id: 'parlour', name: '商人の居間', english: 'TRADER PARLOUR', icon: 'trader',
    flavor: '暖炉の話は、貸し帳簿の話。良い客には良い値を。',
    effectText: lv => lv ? `売却額 +${lv * 6}%` : '売却額を引き上げる',
    maxLevel: 3,
    costs: [
      { coins: 420, materials: { iron: 3 } },
      { coins: 860, materials: { iron: 5, cloth: 2 } },
      { coins: 1400, materials: { iron: 8, ruby: 1 } },
    ],
  },
];

/** Saved upgrade levels, keyed by upgrade id. */
export type CampLevels = Record<string, number>;

const upgradeOf = (id: string) => CAMP_UPGRADES.find(u => u.id === id);

/** Clamped level for an upgrade id. Unknown ids count as zero. */
export function campLevel(camp: CampLevels | null | undefined, id: string): number {
  const max = upgradeOf(id)?.maxLevel ?? 0;
  const raw = camp && typeof camp[id] === 'number' ? camp[id] : 0;
  return Math.max(0, Math.min(max, Math.floor(raw) || 0));
}

/** The cost of the next level, or null once the upgrade is complete. */
export function nextCost(camp: CampLevels, id: string): CampCost | null {
  const upgrade = upgradeOf(id);
  if (!upgrade) return null;
  const level = campLevel(camp, id);
  return level >= upgrade.maxLevel ? null : upgrade.costs[level];
}

/** How many units of a material the stash currently holds. */
export function materialCount(stash: BagEntry[], kind: MaterialKind): number {
  let total = 0;
  for (const entry of stash) if (entry && typeof entry === 'object' && !isGear(entry) && entry.kind === kind) total += (entry as { amount?: number }).amount ?? 0;
  return total;
}

export function canAfford(coins: number, stash: BagEntry[], cost: CampCost): boolean {
  if (coins < cost.coins) return false;
  return Object.entries(cost.materials).every(([kind, amount]) => materialCount(stash, kind as MaterialKind) >= (amount ?? 0));
}

/**
 * Deducts the price from the coin purse and the material stacks in the stash
 * (empty stacks are dropped). Returns the new coin total, or null when
 * unaffordable, in which case nothing is touched.
 */
export function payFor(coins: number, stash: BagEntry[], cost: CampCost): number | null {
  if (!canAfford(coins, stash, cost)) return null;
  for (const [kind, amount] of Object.entries(cost.materials)) {
    let owed = amount ?? 0;
    for (let i = stash.length - 1; i >= 0 && owed > 0; i--) {
      const entry = stash[i];
      if (!entry || typeof entry !== 'object' || isGear(entry) || entry.kind !== kind) continue;
      const stack = entry as { amount: number };
      const take = Math.min(stack.amount, owed);
      stack.amount -= take;
      owed -= take;
      if (stack.amount <= 0) stash.splice(i, 1);
    }
  }
  return coins - cost.coins;
}

/** The trader pays a little extra once the parlour is built. */
export const saleMultiplier = (camp: CampLevels) => 1 + campLevel(camp, 'parlour') * .06;

/**
 * Applies the raid-start bonuses to a fresh player. Everything here stays
 * inside the player's own fields, so it desyncs nothing the server owns.
 */
export function applyCampBonuses(player: Player, camp: CampLevels): void {
  player.heals = 3 + campLevel(camp, 'apothecary');
  player.arrows = 24 + campLevel(camp, 'fletcher') * 6;
  player.extractTime = 5 - campLevel(camp, 'shrine') * .3;
}
