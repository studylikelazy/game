import {
  AFFIX_BY_ID, RARITIES, SLOT_LABELS, WEAPON_BY_ID, affixLines, baseOf, entryIcon, entryName,
  entryRarity, entryValue, formatAffix, gearDefences, gearMods, isGear, tierLabel, weaponProfile,
  type BagEntry, type Gear, type Material, type StatKey,
} from './items';
import { ITEMS } from './items';
import { icon } from './icons';

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const fmt = (n: number) => Math.round(n).toLocaleString('ja-JP');

/** The rarity class used by the stylesheet, matching the PoE colour convention. */
export const rarityClass = (entry: BagEntry) => entryRarity(entry);
export const rarityColor = (entry: BagEntry) => RARITIES[entryRarity(entry)].color;

/** The base stat lines of a weapon, as the tooltip shows them. */
function weaponBaseLines(gear: Gear) {
  const base = WEAPON_BY_ID[gear.base];
  if (!base) return [];
  const profile = weaponProfile(gear);
  const dps = ((profile.min + profile.max) / 2) * profile.attackSpeed;
  const lines: { label: string; value: string; local: boolean }[] = [
    { label: '物理ダメージ', value: `${profile.min} - ${profile.max}`, local: profile.min !== base.damage[0] || profile.max !== base.damage[1] },
    { label: '攻撃速度', value: `${profile.attackSpeed.toFixed(2)} 回/秒`, local: Math.abs(profile.attackSpeed - base.attackSpeed) > .01 },
    { label: 'クリティカル率', value: `${profile.crit.toFixed(1)}%`, local: Math.abs(profile.crit - base.crit) > .01 },
    { label: 'クリティカル倍率', value: `${profile.critMulti.toFixed(2)}倍`, local: Math.abs(profile.critMulti - base.critMulti) > .01 },
  ];
  if (profile.fire || profile.cold || profile.lightning) {
    const parts: string[] = [];
    if (profile.fire) parts.push(`火 ${profile.fire}`);
    if (profile.cold) parts.push(`冷 ${profile.cold}`);
    if (profile.lightning) parts.push(`雷 ${profile.lightning}`);
    lines.push({ label: '追加ダメージ', value: parts.join(' / '), local: true });
  }
  lines.push({ label: '平均DPS', value: `${fmt(dps)}`, local: false });
  return lines;
}

/** The defensive base stat lines of an armour piece. */
function armourBaseLines(gear: Gear) {
  const defences = gearDefences(gear);
  const base = baseOf(gear);
  const lines: { label: string; value: string; local: boolean }[] = [];
  if (defences.armour) lines.push({ label: '装甲', value: `${defences.armour}`, local: base ? defences.armour !== (base as { armour: number }).armour : false });
  if (defences.evasion) lines.push({ label: '回避', value: `${defences.evasion}`, local: base ? defences.evasion !== (base as { evasion: number }).evasion : false });
  if (defences.energyShield) lines.push({ label: 'エネルギーシールド', value: `${defences.energyShield}`, local: base ? defences.energyShield !== (base as { energyShield: number }).energyShield : false });
  return lines;
}

/** The implicit modifier every base type carries. */
function implicitLine(gear: Gear) {
  const base = baseOf(gear);
  if (!base?.implicit) return null;
  const def = AFFIX_BY_ID[base.implicit.id];
  if (!def) return null;
  return formatAffix(def, base.implicit.value);
}

/**
 * The full PoE style tooltip: rarity coloured name, base type, base stats,
 * the implicit modifier, and the explicit affixes with their tier.
 */
export function gearTooltip(gear: Gear) {
  const info = RARITIES[gear.rarity];
  const base = baseOf(gear);
  const lines = WEAPON_BY_ID[gear.base] ? weaponBaseLines(gear) : armourBaseLines(gear);
  const implicit = implicitLine(gear);
  const affixes = affixLines(gear);
  const unique = gear.uniqueId ? baseOf(gear) : null;
  return `<div class="tooltip rarity-${gear.rarity}">
    <div class="tooltip-name" style="color:${info.color}">${esc(gear.name)}</div>
    <div class="tooltip-type">${esc(base ? base.name : gear.base)}${unique ? '' : ` · ${gear.rarity === 'normal' ? 'ノーマル' : info.label}`}</div>
    <div class="tooltip-meta">アイテムレベル ${gear.ilvl} · ${SLOT_LABELS[gear.slot]}</div>
    ${lines.length ? `<div class="tooltip-base">${lines.map(l => `<div><span>${l.label}</span><b class="${l.local ? 'local' : ''}">${l.value}</b></div>`).join('')}</div>` : ''}
    ${implicit ? `<div class="tooltip-implicit"><span>暗黙</span><b>${esc(implicit)}</b></div>` : ''}
    ${affixes.length ? `<div class="tooltip-affixes">${affixes.map(a => `<div><span class="tier-mark">T${tierLabel(a.tier)}</span><b class="${a.local ? 'local' : 'global'}">${esc(a.text)}</b></div>`).join('')}</div>` : ''}
    ${gear.traits?.length ? `<div class="tooltip-traits">${gear.traits.map(t => t === 'leech' ? '吸血：ダメージの1%を生命として回復' : '貫通：物理ダメージが装甲を無視').map(t => `<div><b class="unique-trait">${t}</b></div>`).join('')}</div>` : ''}
    <div class="tooltip-value">売却価値 ${fmt(entryValue(gear))} 銀貨</div>
  </div>`;
}

/** A compact card used in the stash and the field bag. */
export function gearCard(gear: Gear, extra = '') {
  const info = RARITIES[gear.rarity];
  const defences = gearDefences(gear);
  const profile = WEAPON_BY_ID[gear.base] ? weaponProfile(gear) : null;
  const summary = profile
    ? `物理 ${profile.min}-${profile.max} · ${profile.attackSpeed.toFixed(2)}/秒`
    : [defences.armour && `装甲 ${defences.armour}`, defences.evasion && `回避 ${defences.evasion}`, defences.energyShield && `ES ${defences.energyShield}`].filter(Boolean).join(' · ') || '防御特化';
  const affixes = affixLines(gear).slice(0, 3).map(a => `<small class="affix-line ${a.local ? 'local' : 'global'}">${esc(a.text)}</small>`).join('');
  return `<div class="item-card rarity-${gear.rarity}" data-gear="${esc(gear.id)}" title="${esc(gear.name)}">
    <span class="item-icon">${icon(entryIcon(gear))}</span>
    <b style="color:${info.color}">${esc(gear.name)}</b>
    <small>${esc(summary)}</small>
    ${affixes}
    <details class="gear-details"><summary>詳細</summary>${gearTooltip(gear)}</details>
    ${extra}
  </div>`;
}

/** A compact card used for the stackable materials. */
export function materialCard(item: Material, extra = '') {
  const info = ITEMS[item.kind];
  return `<div class="item-card rarity-${info.rarity}" data-material="${item.kind}">
    <span class="item-icon">${icon(item.kind)}</span>
    <b style="color:${RARITIES[info.rarity].color}">${esc(info.name)}</b>
    <small>×${item.amount} · ${fmt(info.value * item.amount)} 銀貨</small>
    ${extra}
  </div>`;
}

export function entryCard(entry: BagEntry, extra = '') {
  return isGear(entry) ? gearCard(entry, extra) : materialCard(entry, extra);
}

/** A one line summary used in the result screen. */
export function entryLabel(entry: BagEntry) {
  const info = RARITIES[entryRarity(entry)];
  return `<span class="rarity-${entryRarity(entry)}">${icon(entryIcon(entry))}${esc(entryName(entry))}${isGear(entry) ? '' : ` ×${(entry as Material).amount}`}</span>`;
}

/** Compares two items and returns the lines where the candidate is better. */
export function gearComparison(gear: Gear, equipped: Gear | undefined) {
  if (!equipped) return [];
  const a = gearMods(gear), b = gearMods(equipped);
  const keys = new Set<string>([...Object.keys(a.local), ...Object.keys(b.local), ...Object.keys(a.global), ...Object.keys(b.global)]);
  const out: { label: string; better: boolean }[] = [];
  for (const key of keys) {
    const mine = (a.local[key as StatKey] ?? 0) + (a.global[key as StatKey] ?? 0);
    const theirs = (b.local[key as StatKey] ?? 0) + (b.global[key as StatKey] ?? 0);
    if (mine === theirs) continue;
    const def = Object.values(AFFIX_BY_ID).find(d => d.stat === key);
    out.push({ label: def?.label ?? key, better: mine > theirs });
  }
  return out;
}
