/**
 * PoE flavoured item model: base types, rarity tiers, affix pools and the
 * deterministic rolling that turns a base type into a finished item.
 *
 * The model follows four Path of Exile ideas that the prototype was missing:
 *  1. Base types carry an implicit modifier and their own defensive profile.
 *  2. Rarity decides how many explicit affixes an item may hold
 *     (normal 0, magic 1-2, rare 3-6, unique fixed).
 *  3. Affixes roll inside a tier band that is gated by the item level,
 *     so a low level drop can never roll a top tier roll.
 *  4. Modifiers are split into local (this item only) and global (character)
 *     modifiers, and local modifiers colour the base stat they change.
 */

/** Rarity ladder. Colours and beam strength follow the action RPG convention. */
export type Rarity = 'normal' | 'magic' | 'rare' | 'unique';
export const RARITY_ORDER: readonly Rarity[] = ['normal', 'magic', 'rare', 'unique'];
export interface RarityInfo { label: string; color: string; beam: number; glow: number; minAffixes: number; maxAffixes: number; }
export const RARITIES: Record<Rarity, RarityInfo> = {
  normal: { label: 'ノーマル', color: '#d9dcd0', beam: 0, glow: .16, minAffixes: 0, maxAffixes: 0 },
  magic: { label: 'マジック', color: '#6d8cf0', beam: 54, glow: .32, minAffixes: 1, maxAffixes: 2 },
  rare: { label: 'レア', color: '#f0dc63', beam: 92, glow: .48, minAffixes: 3, maxAffixes: 6 },
  unique: { label: 'ユニーク', color: '#ff9a3c', beam: 128, glow: .64, minAffixes: 0, maxAffixes: 0 },
};

/** Equipment slots. Two weapon slots keep the existing 1 / 2 hotbar behaviour. */
export type Slot = 'melee' | 'bow' | 'offhand' | 'helmet' | 'chest' | 'gloves' | 'boots' | 'amulet' | 'ring';
export const SLOTS: readonly Slot[] = ['melee', 'bow', 'offhand', 'helmet', 'chest', 'gloves', 'boots', 'amulet', 'ring'];
export const SLOT_LABELS: Record<Slot, string> = {
  melee: '近接武器', bow: '弓', offhand: '盾', helmet: '頭部', chest: '胸部',
  gloves: '手', boots: '足', amulet: '護符', ring: '指輪',
};
/** Slots that can hold a weapon, in hotbar order. */
export const WEAPON_SLOTS = ['melee', 'bow'] as const;

export type WeaponKind = 'sword' | 'katana' | 'axe' | 'mace' | 'dagger' | 'greatsword' | 'bow' | 'crossbow';
export type DamageType = 'physical' | 'fire' | 'cold' | 'lightning';
export const ELEMENTS: readonly DamageType[] = ['fire', 'cold', 'lightning'];

/** Every numeric modifier the character sheet understands. */
export type StatKey =
  | 'physFlat' | 'physPct' | 'fireFlat' | 'coldFlat' | 'lightningFlat'
  | 'attackSpeedPct' | 'critChance' | 'critMulti'
  | 'life' | 'stamina' | 'moveSpeedPct'
  | 'armourFlat' | 'armourPct' | 'evasionFlat' | 'evasionPct' | 'esFlat' | 'esPct'
  | 'resFire' | 'resCold' | 'resLightning' | 'allRes';

/** Local modifiers scale the item that carries them, global ones scale the character. */
export type Scope = 'local' | 'global';

/** A tier band of an affix. Index 0 is the weakest band and is always available. */
export interface Tier { ilvl: number; min: number; max: number }

export interface AffixDef {
  id: string;
  label: string;
  stat: StatKey;
  scope: Scope;
  kind: 'prefix' | 'suffix';
  format: 'flat' | 'percent';
  slots: readonly Slot[];
  weight: number;
  /** Ascending strength. `ilvl` is the minimum item level that can roll the band. */
  tiers: readonly Tier[];
  /** Word used when a magic or rare item is given a name. */
  flavour: string;
}

const ARMOUR_SLOTS: readonly Slot[] = ['offhand', 'helmet', 'chest', 'gloves', 'boots', 'amulet', 'ring'];
const ACCESSORY_SLOTS: readonly Slot[] = ['amulet', 'ring'];

/** Affix catalogue. Tier bands are gated by item level exactly like PoE tiers. */
export const AFFIXES: readonly AffixDef[] = [
  // ---- weapon prefixes (offensive, local) ----
  { id: 'inc_phys', label: '増加物理ダメージ', stat: 'physPct', scope: 'local', kind: 'prefix', format: 'percent', slots: WEAPON_SLOTS, weight: 10, flavour: '鋭利', tiers: [{ ilvl: 1, min: 12, max: 18 }, { ilvl: 6, min: 22, max: 30 }, { ilvl: 11, min: 34, max: 45 }] },
  { id: 'flat_phys', label: '物理ダメージ追加', stat: 'physFlat', scope: 'local', kind: 'prefix', format: 'flat', slots: WEAPON_SLOTS, weight: 10, flavour: '打ち砕き', tiers: [{ ilvl: 1, min: 3, max: 5 }, { ilvl: 6, min: 7, max: 10 }, { ilvl: 12, min: 12, max: 16 }] },
  { id: 'attack_speed_weapon', label: '攻撃速度増加', stat: 'attackSpeedPct', scope: 'local', kind: 'prefix', format: 'percent', slots: WEAPON_SLOTS, weight: 8, flavour: '迅速', tiers: [{ ilvl: 1, min: 6, max: 9 }, { ilvl: 6, min: 11, max: 15 }, { ilvl: 11, min: 17, max: 22 }] },
  { id: 'crit_weapon', label: 'クリティカル率増加', stat: 'critChance', scope: 'local', kind: 'prefix', format: 'percent', slots: WEAPON_SLOTS, weight: 7, flavour: '致命', tiers: [{ ilvl: 1, min: 4, max: 6 }, { ilvl: 6, min: 8, max: 11 }, { ilvl: 11, min: 13, max: 17 }] },
  { id: 'fire_damage', label: '火ダメージ追加', stat: 'fireFlat', scope: 'local', kind: 'prefix', format: 'flat', slots: WEAPON_SLOTS, weight: 5, flavour: '熾火', tiers: [{ ilvl: 1, min: 4, max: 6 }, { ilvl: 8, min: 9, max: 13 }, { ilvl: 14, min: 15, max: 20 }] },
  { id: 'cold_damage', label: '冷気ダメージ追加', stat: 'coldFlat', scope: 'local', kind: 'prefix', format: 'flat', slots: WEAPON_SLOTS, weight: 5, flavour: '霜', tiers: [{ ilvl: 1, min: 4, max: 6 }, { ilvl: 8, min: 9, max: 13 }, { ilvl: 14, min: 15, max: 20 }] },
  { id: 'lightning_damage', label: '雷ダメージ追加', stat: 'lightningFlat', scope: 'local', kind: 'prefix', format: 'flat', slots: WEAPON_SLOTS, weight: 5, flavour: '雷光', tiers: [{ ilvl: 1, min: 4, max: 6 }, { ilvl: 8, min: 9, max: 13 }, { ilvl: 14, min: 15, max: 20 }] },
  { id: 'crit_multi_weapon', label: 'クリティカル倍率増加', stat: 'critMulti', scope: 'local', kind: 'prefix', format: 'percent', slots: WEAPON_SLOTS, weight: 5, flavour: '苛烈', tiers: [{ ilvl: 1, min: 15, max: 22 }, { ilvl: 8, min: 26, max: 35 }, { ilvl: 14, min: 40, max: 55 }] },
  // ---- weapon suffixes (defensive, global) ----
  { id: 'life', label: '最大生命増加', stat: 'life', scope: 'global', kind: 'suffix', format: 'flat', slots: [...WEAPON_SLOTS, ...ARMOUR_SLOTS], weight: 10, flavour: '生命', tiers: [{ ilvl: 1, min: 8, max: 12 }, { ilvl: 6, min: 18, max: 26 }, { ilvl: 11, min: 32, max: 45 }] },
  { id: 'stamina', label: 'スタミナ増加', stat: 'stamina', scope: 'global', kind: 'suffix', format: 'flat', slots: [...WEAPON_SLOTS, ...ARMOUR_SLOTS], weight: 7, flavour: '気力', tiers: [{ ilvl: 1, min: 8, max: 12 }, { ilvl: 7, min: 16, max: 24 }] },
  { id: 'crit_multi_global', label: 'クリティカル倍率増加', stat: 'critMulti', scope: 'global', kind: 'suffix', format: 'percent', slots: [...WEAPON_SLOTS, ...ACCESSORY_SLOTS], weight: 6, flavour: '苛烈', tiers: [{ ilvl: 1, min: 12, max: 18 }, { ilvl: 8, min: 24, max: 34 }] },
  { id: 'all_res', label: '全耐性増加', stat: 'allRes', scope: 'global', kind: 'suffix', format: 'percent', slots: [...WEAPON_SLOTS, ...ARMOUR_SLOTS], weight: 6, flavour: '抗性', tiers: [{ ilvl: 1, min: 6, max: 9 }, { ilvl: 7, min: 11, max: 16 }] },
  { id: 'res_fire', label: '火耐性増加', stat: 'resFire', scope: 'global', kind: 'suffix', format: 'percent', slots: [...WEAPON_SLOTS, ...ARMOUR_SLOTS], weight: 5, flavour: '灰燼', tiers: [{ ilvl: 1, min: 8, max: 12 }, { ilvl: 7, min: 15, max: 22 }] },
  { id: 'res_cold', label: '冷耐性増加', stat: 'resCold', scope: 'global', kind: 'suffix', format: 'percent', slots: [...WEAPON_SLOTS, ...ARMOUR_SLOTS], weight: 5, flavour: '氷結', tiers: [{ ilvl: 1, min: 8, max: 12 }, { ilvl: 7, min: 15, max: 22 }] },
  { id: 'res_lightning', label: '雷耐性増加', stat: 'resLightning', scope: 'global', kind: 'suffix', format: 'percent', slots: [...WEAPON_SLOTS, ...ARMOUR_SLOTS], weight: 5, flavour: '雷鳴', tiers: [{ ilvl: 1, min: 8, max: 12 }, { ilvl: 7, min: 15, max: 22 }] },
  // ---- armour prefixes (defensive scaling) ----
  { id: 'armour_pct', label: '増加装甲', stat: 'armourPct', scope: 'local', kind: 'prefix', format: 'percent', slots: ['offhand', 'helmet', 'chest', 'gloves', 'boots'], weight: 10, flavour: '厚重', tiers: [{ ilvl: 1, min: 10, max: 16 }, { ilvl: 6, min: 20, max: 28 }, { ilvl: 11, min: 32, max: 42 }] },
  { id: 'evasion_pct', label: '増加回避', stat: 'evasionPct', scope: 'local', kind: 'prefix', format: 'percent', slots: ['offhand', 'helmet', 'chest', 'gloves', 'boots'], weight: 10, flavour: '軽捷', tiers: [{ ilvl: 1, min: 10, max: 16 }, { ilvl: 6, min: 20, max: 28 }, { ilvl: 11, min: 32, max: 42 }] },
  { id: 'es_pct', label: '増加エネルギーシールド', stat: 'esPct', scope: 'local', kind: 'prefix', format: 'percent', slots: ['offhand', 'helmet', 'chest', 'gloves', 'boots', 'amulet'], weight: 9, flavour: '結界', tiers: [{ ilvl: 1, min: 10, max: 16 }, { ilvl: 7, min: 20, max: 28 }, { ilvl: 12, min: 32, max: 42 }] },
  { id: 'move_speed', label: '移動速度増加', stat: 'moveSpeedPct', scope: 'global', kind: 'prefix', format: 'percent', slots: ['boots'], weight: 8, flavour: '疾駆', tiers: [{ ilvl: 1, min: 5, max: 8 }, { ilvl: 8, min: 11, max: 16 }] },
  { id: 'attack_speed_gloves', label: '攻撃速度増加', stat: 'attackSpeedPct', scope: 'global', kind: 'prefix', format: 'percent', slots: ['gloves'], weight: 6, flavour: '迅速', tiers: [{ ilvl: 1, min: 5, max: 8 }, { ilvl: 9, min: 11, max: 15 }] },
  { id: 'crit_gloves', label: 'クリティカル率増加', stat: 'critChance', scope: 'global', kind: 'prefix', format: 'percent', slots: ['gloves', ...ACCESSORY_SLOTS], weight: 6, flavour: '致命', tiers: [{ ilvl: 1, min: 4, max: 6 }, { ilvl: 9, min: 8, max: 12 }] },
  // ---- armour suffixes (flat defences) ----
  { id: 'armour_flat', label: '装甲追加', stat: 'armourFlat', scope: 'local', kind: 'suffix', format: 'flat', slots: ['offhand', 'helmet', 'chest', 'gloves', 'boots'], weight: 10, flavour: '堅固', tiers: [{ ilvl: 1, min: 6, max: 10 }, { ilvl: 6, min: 13, max: 20 }, { ilvl: 12, min: 22, max: 32 }] },
  { id: 'evasion_flat', label: '回避追加', stat: 'evasionFlat', scope: 'local', kind: 'suffix', format: 'flat', slots: ['offhand', 'helmet', 'chest', 'gloves', 'boots'], weight: 10, flavour: '影', tiers: [{ ilvl: 1, min: 6, max: 10 }, { ilvl: 6, min: 13, max: 20 }, { ilvl: 12, min: 22, max: 32 }] },
  { id: 'es_flat', label: 'エネルギーシールド追加', stat: 'esFlat', scope: 'local', kind: 'suffix', format: 'flat', slots: ['offhand', 'helmet', 'chest', 'gloves', 'boots', 'amulet'], weight: 9, flavour: '障壁', tiers: [{ ilvl: 1, min: 6, max: 10 }, { ilvl: 7, min: 12, max: 19 }, { ilvl: 13, min: 21, max: 30 }] },
  { id: 'armour_global', label: '装甲追加', stat: 'armourFlat', scope: 'global', kind: 'suffix', format: 'flat', slots: ACCESSORY_SLOTS, weight: 6, flavour: '堅固', tiers: [{ ilvl: 1, min: 4, max: 7 }, { ilvl: 9, min: 9, max: 14 }] },
  { id: 'evasion_global', label: '回避追加', stat: 'evasionFlat', scope: 'global', kind: 'suffix', format: 'flat', slots: ACCESSORY_SLOTS, weight: 6, flavour: '影', tiers: [{ ilvl: 1, min: 4, max: 7 }, { ilvl: 9, min: 9, max: 14 }] },
  { id: 'es_global', label: 'エネルギーシールド追加', stat: 'esFlat', scope: 'global', kind: 'suffix', format: 'flat', slots: ACCESSORY_SLOTS, weight: 6, flavour: '障壁', tiers: [{ ilvl: 1, min: 4, max: 7 }, { ilvl: 9, min: 9, max: 14 }] },
];

export const AFFIX_BY_ID: Record<string, AffixDef> = Object.fromEntries(AFFIXES.map(a => [a.id, a]));

export interface WeaponBase {
  id: string;
  name: string;
  kind: WeaponKind;
  slot: 'melee' | 'bow';
  damage: [number, number];
  /** Attacks per second. PoE expresses weapon speed this way and the cooldown follows from it. */
  attackSpeed: number;
  crit: number;
  critMulti: number;
  range: number;
  stamina: number;
  handed: 1 | 2;
  icon: string;
  description: string;
  /** Starter gear is always available to a fresh traveller. */
  starter?: boolean;
  implicit?: { id: string; value: number };
}

export interface ArmourBase {
  id: string;
  name: string;
  slot: Exclude<Slot, 'melee' | 'bow'>;
  armour: number;
  evasion: number;
  energyShield: number;
  icon: string;
  description: string;
  implicit?: { id: string; value: number };
}

export const WEAPON_BASES: readonly WeaponBase[] = [
  { id: 'sword', name: '鉄のロングソード', kind: 'sword', slot: 'melee', damage: [22, 30], attackSpeed: 1.9, crit: 5, critMulti: 1.5, range: 76, stamina: 12, handed: 1, icon: 'sword', starter: true, description: '片手剣。素直な数値で扱いやすい万能の一本。' },
  { id: 'katana', name: '東方の打刀', kind: 'katana', slot: 'melee', damage: [16, 24], attackSpeed: 2.6, crit: 8, critMulti: 1.5, range: 88, stamina: 10, handed: 1, icon: 'katana', starter: true, description: '速い連打で削る。振りが軽く、スタミナも安い。' },
  { id: 'axe', name: '荒れた戦斧', kind: 'axe', slot: 'melee', damage: [30, 44], attackSpeed: 1.35, crit: 5, critMulti: 1.5, range: 80, stamina: 16, handed: 1, icon: 'axe', description: '一撃が重い。遅い代わりに装甲を削る一撃が大きい。' },
  { id: 'mace', name: '騎士の石槌', kind: 'mace', slot: 'melee', damage: [28, 40], attackSpeed: 1.45, crit: 6, critMulti: 1.5, range: 74, stamina: 18, handed: 1, icon: 'mace', description: '打撃。敵の装甲を押し分けて削る。' },
  { id: 'dagger', name: '巡回人の短刀', kind: 'dagger', slot: 'melee', damage: [10, 16], attackSpeed: 3.4, crit: 15, critMulti: 2, range: 60, stamina: 8, handed: 1, icon: 'dagger', description: '速い連打と高いクリティカルで数を釣る。', implicit: { id: 'crit_weapon', value: 10 } },
  { id: 'greatsword', name: '大地の巨剣', kind: 'greatsword', slot: 'melee', damage: [46, 68], attackSpeed: 1, crit: 5, critMulti: 1.5, range: 96, stamina: 24, handed: 2, icon: 'greatsword', description: '両手持ち。片手武器との併用はできない。' },
  { id: 'bow', name: '狩人の長弓', kind: 'bow', slot: 'bow', damage: [30, 38], attackSpeed: 1.3, crit: 5, critMulti: 1.5, range: 540, stamina: 8, handed: 1, icon: 'bow', starter: true, description: '矢で戦う。距離を保てる唯一の武器。' },
  { id: 'crossbow', name: '城塞の弩', kind: 'crossbow', slot: 'bow', damage: [40, 56], attackSpeed: .95, crit: 4, critMulti: 1.5, range: 500, stamina: 14, handed: 1, icon: 'crossbow', description: '矢の威力が大きい。ただし引き分けに時間がかかる。' },
];

export const ARMOUR_BASES: readonly ArmourBase[] = [
  { id: 'pilgrim_hood', name: '巡礼者の兜', slot: 'helmet', armour: 16, evasion: 6, energyShield: 0, icon: 'helmet', description: '軽装備。頭部を守る薄い兜。' },
  { id: 'steel_helm', name: '鋼の兜', slot: 'helmet', armour: 28, evasion: 2, energyShield: 0, icon: 'helmet', description: '装甲重視の頭部装備。' },
  { id: 'shadow_cap', name: '影の帽', slot: 'helmet', armour: 4, evasion: 16, energyShield: 0, icon: 'helmet', description: '回避特化。足音が消える。' },
  { id: 'traveller_cloak', name: '旅人の外套', slot: 'chest', armour: 18, evasion: 10, energyShield: 0, icon: 'chest', description: '旅道具の合間に着た外套。' },
  { id: 'chain_cuirass', name: '鎖の胸当て', slot: 'chest', armour: 36, evasion: 4, energyShield: 10, icon: 'chest', description: '重いが確実な防御。' },
  { id: 'monk_robe', name: '修道士のローブ', slot: 'chest', armour: 8, evasion: 10, energyShield: 22, icon: 'chest', description: 'エネルギーシールドの厚手。' },
  { id: 'leather_gloves', name: '革の手袋', slot: 'gloves', armour: 8, evasion: 6, energyShield: 0, icon: 'gloves', description: '指が動く軽めの保護具。' },
  { id: 'plated_gauntlet', name: '鍍金の篭手', slot: 'gloves', armour: 16, evasion: 0, energyShield: 0, icon: 'gloves', description: '打撃で指を折る代償はない。' },
  { id: 'cloth_wraps', name: '布の拳甲', slot: 'gloves', armour: 2, evasion: 12, energyShield: 0, icon: 'gloves', description: '回避を取りやすいための軽い布。' },
  { id: 'wanderer_boots', name: '旅人の靴', slot: 'boots', armour: 4, evasion: 14, energyShield: 0, icon: 'boots', description: '長旅に慣れた革靴。' },
  { id: 'iron_greaves', name: '鉄の脛当', slot: 'boots', armour: 16, evasion: 6, energyShield: 0, icon: 'boots', description: '脚を厚く守らせる。' },
  { id: 'swift_boots', name: '疾駆の革靴', slot: 'boots', armour: 2, evasion: 18, energyShield: 0, icon: 'boots', description: '足取りが軽い。', implicit: { id: 'move_speed', value: 5 } },
  { id: 'wooden_shield', name: '木の盾', slot: 'offhand', armour: 14, evasion: 0, energyShield: 6, icon: 'shield', description: '傷だらけだが軽い盾。' },
  { id: 'iron_buckler', name: '鉄の小盾', slot: 'offhand', armour: 26, evasion: 0, energyShield: 14, icon: 'shield', description: '小盾。鉄板の厚みが並みの盾をしのぐ。' },
  { id: 'hide_buckler', name: '皮の円盾', slot: 'offhand', armour: 10, evasion: 12, energyShield: 0, icon: 'shield', description: '回避を保つための軽やかな小盾。' },
  { id: 'brass_amulet', name: '真鍮の護符', slot: 'amulet', armour: 0, evasion: 0, energyShield: 10, icon: 'amulet', description: '古い真鍮の護符。' },
  { id: 'bone_amulet', name: '骨の護符', slot: 'amulet', armour: 0, evasion: 0, energyShield: 6, icon: 'amulet', description: '触れると冷たく、くしゃみが出る。', implicit: { id: 'res_cold', value: 10 } },
  { id: 'brass_ring', name: '真鍮の指輪', slot: 'ring', armour: 0, evasion: 0, energyShield: 0, icon: 'ring', description: '使い込まれた指輪。', implicit: { id: 'life', value: 8 } },
  { id: 'silver_ring', name: '銀の指輪', slot: 'ring', armour: 0, evasion: 0, energyShield: 8, icon: 'ring', description: 'かすかな光の指輪。', implicit: { id: 'es_global', value: 8 } },
];

/**
 * Special behaviours only uniques can carry.
 *  leech - a fraction of the damage dealt is returned as life.
 *  pierce - physical damage ignores the target's armour.
 */
export type Trait = 'leech' | 'pierce';

/** Unique items: fixed affixes, fixed name, fixed identity. */
export interface UniqueDef {
  id: string;
  base: string;
  name: string;
  flavour: string;
  traits?: Trait[];
  affixes: { id: string; value: number }[];
}

export const UNIQUES: readonly UniqueDef[] = [
  { id: 'u_wolf_fang', base: 'dagger', name: '灰狼の牙', flavour: '野盗が落とした、狼の牙の短刀。', traits: ['leech'], affixes: [{ id: 'crit_weapon', value: 12 }, { id: 'attack_speed_weapon', value: 15 }, { id: 'life', value: 18 }] },
  { id: 'u_ash_edge', base: 'sword', name: '灰の刃', flavour: '刃の灰は、雪のように舞う。', affixes: [{ id: 'inc_phys', value: 45 }, { id: 'crit_multi_weapon', value: 40 }, { id: 'all_res', value: 10 }] },
  { id: 'u_earthcleaver', base: 'greatsword', name: '大地の裂き目', flavour: '王国が割れた日に落ちた剣。', traits: ['pierce'], affixes: [{ id: 'flat_phys', value: 16 }, { id: 'life', value: 30 }, { id: 'stamina', value: 20 }] },
  { id: 'u_whitequill', base: 'bow', name: '白羽の弓', flavour: '嵐の夜、渡った鴉の落とし羽。', affixes: [{ id: 'inc_phys', value: 32 }, { id: 'attack_speed_weapon', value: 14 }, { id: 'crit_weapon', value: 8 }] },
  { id: 'u_rose_guard', base: 'iron_buckler', name: '薔薇の盾', flavour: '騎士団の紋章が赤く残っている。', affixes: [{ id: 'armour_flat', value: 24 }, { id: 'es_flat', value: 18 }, { id: 'all_res', value: 14 }] },
  { id: 'u_pilgrim_token', base: 'brass_amulet', name: '巡礼者のトークン', flavour: 'すべての街道に知れる通行証。', affixes: [{ id: 'all_res', value: 16 }, { id: 'life', value: 26 }, { id: 'stamina', value: 20 }] },
  { id: 'u_frost_signet', base: 'silver_ring', name: '凍てつく印戒', flavour: '触れると指先が白くなる。', affixes: [{ id: 'res_cold', value: 22 }, { id: 'es_global', value: 14 }, { id: 'crit_gloves', value: 8 }] },
  { id: 'u_monk_hood', base: 'monk_robe', name: '沈黙のローブ', flavour: '布は吸音している。', affixes: [{ id: 'es_flat', value: 22 }, { id: 'evasion_pct', value: 24 }, { id: 'res_lightning', value: 16 }] },
];

/** A finished item. Everything the tooltip shows is derivable from this record. */
export interface Gear {
  id: string;
  base: string;
  slot: Slot;
  rarity: Rarity;
  ilvl: number;
  /** Seed of the roll, kept so the server can rebuild the exact same item. */
  seed: number;
  name: string;
  affixes: { id: string; tier: number; value: number }[];
  uniqueId?: string;
  traits?: Trait[];
}

/** Materials keep their own record so the economy stays readable. */
export interface Material { kind: MaterialKind; amount: number }
export type MaterialKind = 'coin' | 'iron' | 'herb' | 'cloth' | 'relic' | 'ruby';

export const ITEMS: Record<MaterialKind, { name: string; value: number; weight: number; rarity: Rarity }> = {
  coin: { name: '古王国の銀貨', value: 35, weight: .1, rarity: 'normal' },
  iron: { name: '鍛鉄の欠片', value: 65, weight: 1.4, rarity: 'normal' },
  herb: { name: '月露草', value: 90, weight: .3, rarity: 'magic' },
  cloth: { name: '亜麻の織物', value: 55, weight: .6, rarity: 'normal' },
  relic: { name: '修道院の聖遺物', value: 340, weight: 1.8, rarity: 'rare' },
  ruby: { name: '深紅の宝石', value: 580, weight: .2, rarity: 'unique' },
};

/** Everything that can sit in the field bag or the stash. */
export type BagEntry = Material | Gear;
/** Backwards compatible aliases used across the codebase. */
export type Item = BagEntry;
export type ItemKind = MaterialKind;

export const isGear = (entry: BagEntry): entry is Gear => (entry as Gear).base !== undefined;
export const isMaterial = (entry: BagEntry): entry is Material => !isGear(entry);

export const WEAPON_BY_ID: Record<string, WeaponBase> = Object.fromEntries(WEAPON_BASES.map(w => [w.id, w]));
export const ARMOUR_BY_ID: Record<string, ArmourBase> = Object.fromEntries(ARMOUR_BASES.map(a => [a.id, a]));
export const UNIQUE_BY_ID: Record<string, UniqueDef> = Object.fromEntries(UNIQUES.map(u => [u.id, u]));

/** Deterministic small PRNG so a seed always rebuilds the same item. */
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Rarity weights shift with item level: deeper areas roll more rares. */
export function rarityWeights(ilvl: number): Record<Rarity, number> {
  const tier = Math.max(0, Math.min(1, (ilvl - 1) / 18));
  return { normal: .56 - .28 * tier, magic: .30, rare: .12 + .22 * tier, unique: .02 + .06 * tier };
}

export function rollRarity(ilvl: number, random: () => number): Rarity {
  const weights = rarityWeights(ilvl);
  let roll = random(), acc = 0;
  for (const rarity of RARITY_ORDER) { acc += weights[rarity]; if (roll <= acc) return rarity; }
  return 'normal';
}

/** Picks a tier band the item level unlocks, then rolls inside the band. */
function rollTier(def: AffixDef, ilvl: number, random: () => number) {
  const eligible = def.tiers.map((tier, index) => ({ tier, index })).filter(entry => ilvl >= entry.tier.ilvl);
  if (!eligible.length) return null;
  // Stronger bands are more likely, but the weak band still shows up.
  const weights = eligible.map(entry => 1 + entry.index * 1.2);
  const total = weights.reduce((s, w) => s + w, 0);
  let roll = random() * total, index = 0;
  for (let i = 0; i < weights.length; i++) { roll -= weights[i]; if (roll <= 0) { index = i; break; } }
  const picked = eligible[index];
  const value = picked.tier.min + random() * (picked.tier.max - picked.tier.min);
  return { tier: index, value: Math.max(1, Math.round(value)) };
}

/** Chooses the explicit affixes of a magic or rare item. */
function rollAffixes(slot: Slot, rarity: Rarity, ilvl: number, random: () => number) {
  const info = RARITIES[rarity];
  if (info.maxAffixes <= 0) return [];
  const pool = AFFIXES.filter(def => def.slots.includes(slot));
  const prefixes = pool.filter(def => def.kind === 'prefix');
  const suffixes = pool.filter(def => def.kind === 'suffix');
  const total = info.minAffixes + Math.floor(random() * (info.maxAffixes - info.minAffixes + 1));
  const maxPrefix = rarity === 'rare' ? 3 : 1;
  const maxSuffix = rarity === 'rare' ? 3 : 1;
  const wanted = Math.min(total, maxPrefix + maxSuffix);
  const prefixCount = Math.max(wanted - maxSuffix, Math.min(maxPrefix, Math.floor(wanted / 2) + (random() < .5 ? 1 : 0)));
  const suffixCount = Math.min(maxSuffix, wanted - prefixCount);
  const chosen: { id: string; tier: number; value: number }[] = [];
  const used = new Set<string>();
  const pick = (defs: AffixDef[], count: number) => {
    const candidates = defs.filter(def => !used.has(def.id));
    for (let i = 0; i < count && candidates.length; i++) {
      const weights = candidates.map(def => def.weight);
      const totalWeight = weights.reduce((s, w) => s + w, 0);
      let roll = random() * totalWeight, index = 0;
      for (let j = 0; j < weights.length; j++) { roll -= weights[j]; if (roll <= 0) { index = j; break; } }
      const def = candidates.splice(index, 1)[0];
      used.add(def.id);
      const rolled = rollTier(def, ilvl, random);
      if (rolled) chosen.push({ id: def.id, tier: rolled.tier, value: rolled.value });
    }
  };
  pick(prefixes, prefixCount);
  pick(suffixes, suffixCount);
  return chosen;
}

/** Builds the display name of a magic or rare item from its strongest affix. */
function rollName(baseName: string, affixes: { id: string }[]) {
  if (!affixes.length) return baseName;
  const defs = affixes.map(a => AFFIX_BY_ID[a.id]).filter(Boolean);
  const best = defs.slice().sort((a, b) => a.tiers.length - b.tiers.length || 0)[0];
  return `${baseName}・${best?.flavour ?? '古'}`;
}

/** Rolls a finished item. The same seed always produces the same item. */
export function rollGear(baseId: string, rarity: Rarity, ilvl: number, seed: number): Gear {
  const random = mulberry32(seed);
  const weapon = WEAPON_BY_ID[baseId];
  const armour = ARMOUR_BY_ID[baseId];
  const baseName = weapon?.name ?? armour?.name ?? baseId;
  const slot: Slot = weapon ? weapon.slot : armour ? armour.slot : 'melee';
  const unique = UNIQUES.find(u => u.base === baseId);
  if (rarity === 'unique' && unique) {
    return {
      id: `${baseId}-${(seed >>> 0).toString(36)}`, base: baseId, slot, rarity: 'unique', ilvl, seed,
      name: unique.name, uniqueId: unique.id, traits: unique.traits,
      affixes: unique.affixes.map(a => ({ id: a.id, tier: 0, value: a.value })),
    };
  }
  const resolved = rarity === 'unique' ? 'rare' : rarity;
  const affixes = rollAffixes(slot, resolved, ilvl, random);
  return {
    id: `${baseId}-${(seed >>> 0).toString(36)}`, base: baseId, slot, rarity: resolved, ilvl, seed,
    name: resolved === 'normal' ? baseName : rollName(baseName, affixes),
    affixes,
  };
}

/** Rolls a random base type for a slot. */
export function randomBase(slot: Slot, random: () => number) {
  const pool = slot === 'melee' || slot === 'bow' ? WEAPON_BASES.filter(w => w.slot === slot) : ARMOUR_BASES.filter(a => a.slot === slot);
  return pool[Math.floor(random() * pool.length)];
}

/**
 * Rolls a complete drop for a slot. The base type and the rarity are picked
 * from one stream and the affixes from another, so a finished item is always
 * reproducible from (base, rarity, ilvl, seed) alone.
 */
export function rollDrop(slot: Slot, ilvl: number, seed: number, forceRarity?: Rarity): Gear {
  const picker = mulberry32((seed ^ 0x9E3779B9) >>> 0);
  const base = randomBase(slot, picker);
  const rarity = forceRarity ?? rollRarity(ilvl, picker);
  return rollGear(base.id, rarity, ilvl, seed);
}

/** Base type lookup that works for both weapons and armour. */
export function baseOf(gear: Gear): WeaponBase | ArmourBase | undefined {
  return WEAPON_BY_ID[gear.base] ?? ARMOUR_BY_ID[gear.base];
}

export type ModBag = Partial<Record<StatKey, number>>;

/** Splits an item's affixes into local and global modifier bags. */
export function gearMods(gear: Gear): { local: ModBag; global: ModBag } {
  const local: ModBag = {}, global: ModBag = {};
  const add = (bag: ModBag, stat: StatKey, value: number) => { bag[stat] = (bag[stat] ?? 0) + value; };
  for (const affix of gear.affixes) {
    const def = AFFIX_BY_ID[affix.id];
    if (!def) continue;
    add(def.scope === 'local' ? local : global, def.stat, affix.value);
  }
  const base = baseOf(gear);
  if (base?.implicit) {
    const def = AFFIX_BY_ID[base.implicit.id];
    if (def) add(def.scope === 'local' ? local : global, def.stat, base.implicit.value);
  }
  return { local, global };
}

/** Defence profile of a worn item after its local modifiers are applied. */
export function gearDefences(gear: Gear) {
  const base = ARMOUR_BY_ID[gear.base];
  const { local } = gearMods(gear);
  if (!base) return { armour: 0, evasion: 0, energyShield: 0 };
  const armour = Math.round((base.armour * (1 + (local.armourPct ?? 0) / 100)) + (local.armourFlat ?? 0));
  const evasion = Math.round((base.evasion * (1 + (local.evasionPct ?? 0) / 100)) + (local.evasionFlat ?? 0));
  const energyShield = Math.round((base.energyShield * (1 + (local.esPct ?? 0) / 100)) + (local.esFlat ?? 0));
  return { armour, evasion, energyShield };
}

export interface GlobalStats {
  life: number;
  stamina: number;
  armour: number;
  evasion: number;
  energyShield: number;
  res: { fire: number; cold: number; lightning: number };
  crit: number;
  critMulti: number;
  moveSpeedPct: number;
  attackSpeedPct: number;
}

/** Sums the global modifiers of a whole loadout. */
export function globalStats(equipment: Partial<Record<Slot, Gear>>): GlobalStats {
  const totals: GlobalStats = {
    life: 0, stamina: 0, armour: 0, evasion: 0, energyShield: 0,
    res: { fire: 0, cold: 0, lightning: 0 },
    crit: 0, critMulti: 0, moveSpeedPct: 0, attackSpeedPct: 0,
  };
  for (const gear of Object.values(equipment)) {
    if (!gear) continue;
    const { local, global } = gearMods(gear);
    const defences = gearDefences(gear);
    totals.life += global.life ?? 0;
    totals.stamina += global.stamina ?? 0;
    totals.armour += defences.armour + (global.armourFlat ?? 0);
    totals.evasion += defences.evasion + (global.evasionFlat ?? 0);
    totals.energyShield += defences.energyShield + (global.esFlat ?? 0);
    totals.crit += global.critChance ?? 0;
    totals.critMulti += global.critMulti ?? 0;
    totals.moveSpeedPct += global.moveSpeedPct ?? 0;
    totals.attackSpeedPct += global.attackSpeedPct ?? 0;
    const all = global.allRes ?? 0;
    totals.res.fire += (global.resFire ?? 0) + all;
    totals.res.cold += (global.resCold ?? 0) + all;
    totals.res.lightning += (global.resLightning ?? 0) + all;
  }
  return totals;
}

/** Effective weapon numbers after local modifiers, used by the combat model. */
export function weaponProfile(gear: Gear | null, global?: GlobalStats) {
  const source = (gear ? WEAPON_BY_ID[gear.base] : undefined) ?? WEAPON_BASES[0];
  const { local } = gear ? gearMods(gear) : { local: {} as ModBag };
  const physPct = 1 + (local.physPct ?? 0) / 100;
  const min = Math.round((source.damage[0] + (local.physFlat ?? 0)) * physPct);
  const max = Math.round((source.damage[1] + (local.physFlat ?? 0)) * physPct);
  const globalSpeed = global?.attackSpeedPct ?? 0;
  return {
    base: source,
    kind: source.kind,
    name: gear?.name ?? source.name,
    min: Math.max(1, min),
    max: Math.max(min, max),
    attackSpeed: source.attackSpeed * (1 + (local.attackSpeedPct ?? 0) / 100) * (1 + globalSpeed / 100),
    crit: source.crit + (local.critChance ?? 0) + (global?.crit ?? 0),
    critMulti: source.critMulti + (local.critMulti ?? 0) / 100 + (global?.critMulti ?? 0) / 100,
    range: source.range,
    stamina: source.stamina,
    fire: local.fireFlat ?? 0,
    cold: local.coldFlat ?? 0,
    lightning: local.lightningFlat ?? 0,
    traits: gear?.traits ?? [],
  };
}

/** Format helper shared by the tooltip and the result screen. */
export function formatAffix(def: AffixDef, value: number) {
  return `${def.label} ${value >= 0 ? '+' : ''}${value}${def.format === 'percent' ? '%' : ''}`;
}

export interface AffixLine { text: string; tier: number; local: boolean; id: string; }

/** PoE tier numbering: tier I is the strongest band. */
export const tierLabel = (tier: number) => ['I', 'II', 'III', 'IV'][tier] ?? 'IV';

export function affixLines(gear: Gear): AffixLine[] {
  const lines: AffixLine[] = [];
  for (const affix of gear.affixes) {
    const def = AFFIX_BY_ID[affix.id];
    if (!def) continue;
    lines.push({ text: formatAffix(def, affix.value), tier: gear.rarity === 'unique' ? 0 : def.tiers.length - 1 - affix.tier, local: def.scope === 'local', id: affix.id });
  }
  return lines;
}

export function gearValue(gear: Gear) {
  const base = gear.rarity === 'unique' ? 520 : gear.rarity === 'rare' ? 190 : gear.rarity === 'magic' ? 80 : 25;
  return Math.round(base * (.55 + gear.ilvl / 14));
}

export function gearWeight(gear: Gear) {
  const slot = gear.slot;
  if (slot === 'melee' || slot === 'bow') return 3.2;
  if (slot === 'chest') return 4;
  if (slot === 'offhand') return 3;
  if (slot === 'helmet') return 1.8;
  if (slot === 'boots') return 1.6;
  if (slot === 'gloves') return .8;
  if (slot === 'amulet') return .4;
  return .15;
}

export function entryValue(entry: BagEntry) {
  return isGear(entry) ? gearValue(entry) : ITEMS[entry.kind].value * entry.amount;
}
export function entryWeight(entry: BagEntry) {
  return isGear(entry) ? gearWeight(entry) : ITEMS[entry.kind].weight * entry.amount;
}
export function entryName(entry: BagEntry) {
  return isGear(entry) ? entry.name : ITEMS[entry.kind].name;
}
export function entryRarity(entry: BagEntry): Rarity {
  return isGear(entry) ? entry.rarity : ITEMS[entry.kind].rarity;
}
export function entryIcon(entry: BagEntry) {
  if (isGear(entry)) return baseOf(entry)?.icon ?? 'shield';
  return entry.kind;
}

/**
 * Rebuilds an item from the four facts that define it. Used by the server to
 * validate a client supplied loadout, so a tampered client can never invent
 * affix values that the rolling rules would not produce.
 */
/**
 * Encodes a loadout for the wire. Only the four facts that define an item
 * travel, so the server can rebuild the exact same gear instead of trusting
 * the affix values a client claims.
 */
export function encodeLoadout(loadout: Partial<Record<Slot, Gear>>): string {
  const payload: Record<string, [string, string, number, number]> = {};
  for (const slot of SLOTS) {
    const gear = loadout[slot];
    if (!gear) continue;
    payload[slot] = [gear.base, gear.rarity, gear.ilvl, gear.seed];
  }
  return JSON.stringify(payload);
}

/** Rebuilds a loadout that arrived from a client, rolling every item again. */
export function decodeLoadout(raw: unknown): Partial<Record<Slot, Gear>> {
  const out: Partial<Record<Slot, Gear>> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [slot, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!SLOTS.includes(slot as Slot) || !Array.isArray(value) || value.length < 4) continue;
    const [base, rarity, ilvl, seed] = value as [unknown, unknown, unknown, unknown];
    const gear = sanitizeGear({ base, rarity, ilvl, seed });
    if (gear && gear.slot === slot) out[slot as Slot] = gear;
  }
  return out;
}

export function sanitizeGear(raw: unknown): Gear | null {
  if (!raw || typeof raw !== 'object') return null;
  const item = raw as Partial<Gear>;
  const base = typeof item.base === 'string' ? (WEAPON_BY_ID[item.base] ?? ARMOUR_BY_ID[item.base]) : undefined;
  if (!base) return null;
  const rarity = RARITY_ORDER.includes(item.rarity as Rarity) ? item.rarity as Rarity : 'normal';
  const ilvl = Number.isFinite(item.ilvl) ? Math.max(1, Math.min(30, Math.floor(item.ilvl as number))) : 1;
  const seed = Number.isFinite(item.seed) ? Math.abs(Math.floor(item.seed as number)) % 0x7fffffff : 0;
  return rollGear(base.id, rarity, ilvl, seed);
}
