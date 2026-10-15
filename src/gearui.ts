import { weaponArt } from './weaponArt';
/**
 * Rendering helpers for the PoE style equipment screens: the paper doll of
 * the character sheet, the compact slot grid of the lobby and the statistic
 * block. Everything here is pure markup so the wiring stays inside main.ts.
 */
import {
  RARITIES, SLOT_LABELS, baseOf, gearDefences, weaponProfile,
  type Gear, type GlobalStats, type Slot,
} from './items';
import { icon } from './icons';

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const fmt = (n: number) => Math.round(n).toLocaleString('ja-JP');

/** The icon that represents a slot in the paper doll. */
export const SLOT_ICONS: Record<Slot, string> = {
  melee: 'sword', bow: 'bow', offhand: 'shield', helmet: 'helmet', chest: 'chest',
  gloves: 'gloves', boots: 'boots', amulet: 'amulet', ring: 'ring',
};

function gearArt(gear: Gear | undefined, slot: Slot) {
  const base = gear ? baseOf(gear) : null;
  return base && 'kind' in base ? weaponArt(base.kind, base.icon) : icon(SLOT_ICONS[slot]);
}

/** The order the paper doll uses: weapons on the left, body in the middle. */
export const SLOT_ORDER: readonly Slot[] = ['melee', 'bow', 'offhand', 'helmet', 'chest', 'gloves', 'boots', 'amulet', 'ring'];

/** Short line under a gear name: damage for weapons, defences for armour. */
export function gearSummary(gear: Gear): string {
  const base = baseOf(gear);
  if (base && 'damage' in base) {
    const profile = weaponProfile(gear);
    return `物理 ${profile.min}-${profile.max} · ${profile.attackSpeed.toFixed(2)}/秒 · クリ ${profile.crit.toFixed(0)}%`;
  }
  const defences = gearDefences(gear);
  const parts = [
    defences.armour ? `装甲 ${defences.armour}` : '',
    defences.evasion ? `回避 ${defences.evasion}` : '',
    defences.energyShield ? `ES ${defences.energyShield}` : '',
  ].filter(Boolean);
  return parts.join(' · ') || '防御特化';
}

/** A single line of the character sheet statistic block. */
function stat(label: string, value: string, hint = '') {
  return `<div class="stat-line"><span>${label}</span><b>${value}</b>${hint ? `<small>${hint}</small>` : ''}</div>`;
}

/**
 * The full character sheet: a paper doll of the nine slots on the left and
 * the aggregated statistics of the build on the right.
 */
export function characterSheetHtml(loadout: Partial<Record<Slot, Gear>>, globals: GlobalStats, extra: { meleeDps: number; bowDps: number; life: number; stamina: number }) {
  const slots = SLOT_ORDER.map(slot => {
    const gear = loadout[slot];
    const info = gear ? RARITIES[gear.rarity] : null;
    return `<div class="doll-slot${gear ? ` filled rarity-${gear.rarity}` : ' empty'}" data-slot="${slot}">
      <span class="doll-icon">${gearArt(gear, slot)}</span>
      <span class="doll-text">
        <small>${SLOT_LABELS[slot]}</small>
        <b${gear ? ` style="color:${info!.color}"` : ''}>${gear ? esc(gear.name) : '装備なし'}</b>
        ${gear ? `<em>${esc(gearSummary(gear))}</em>` : ''}
      </span>
      ${gear ? `<span class="doll-tier">${RARITIES[gear.rarity].label}</span>` : ''}
    </div>`;
  }).join('');

  const stats = [
    stat('生命', `${fmt(extra.life)}`, '最大HP'),
    stat('エネルギーシールド', `${fmt(globals.energyShield)}`, '4秒未被弾で回復'),
    stat('スタミナ', `${fmt(extra.stamina)}`, '走る・回避・攻撃に使う'),
    stat('装甲', `${fmt(globals.armour)}`, '物理ダメージを軽減'),
    stat('回避', `${fmt(globals.evasion)}`, '攻撃を完全に避ける'),
    stat('火炎耐性', `${fmt(globals.res.fire)}%`, '上限75%'),
    stat('冷気耐性', `${fmt(globals.res.cold)}%`, '上限75%'),
    stat('雷耐性', `${fmt(globals.res.lightning)}%`, '上限75%'),
    stat('クリティカル率', `${globals.crit.toFixed(1)}%`, 'Chance to Crit'),
    stat('クリティカル倍率', `${globals.critMulti.toFixed(2)}倍`, 'Damage multiplier'),
    stat('移動速度', `${globals.moveSpeedPct >= 0 ? '+' : ''}${globals.moveSpeedPct}%`, 'Movement Speed'),
    stat('攻撃速度', `${globals.attackSpeedPct >= 0 ? '+' : ''}${globals.attackSpeedPct}%`, 'Attack Speed'),
    stat('近接DPS', `${fmt(extra.meleeDps)}`, '平均ダメージ/秒'),
    stat('弓DPS', `${fmt(extra.bowDps)}`, '平均ダメージ/秒'),
  ].join('');

  return `<div class="sheet">
    <div class="sheet-doll">${slots}</div>
    <div class="sheet-stats"><h3>キャラクター情報<span>CHARACTER</span></h3>${stats}</div>
  </div>`;
}

/** The compact slot grid shown in the lobby panel. */
export function slotGrid(loadout: Partial<Record<Slot, Gear>>, fallback: Partial<Record<Slot, Gear>>) {
  return SLOT_ORDER.map(slot => {
    const gear = loadout[slot] ?? fallback[slot];
    const info = gear ? RARITIES[gear.rarity] : null;
    return `<button class="equipment-item${gear ? ` filled rarity-${gear.rarity}` : ' empty'}" data-slot="${slot}" title="${gear ? esc(gear.name) : `${SLOT_LABELS[slot]}：装備なし`}">
      <span class="equipment-icon">${gearArt(gear, slot)}</span>
      <span class="equipment-text"><b${gear ? ` style="color:${info!.color}"` : ''}>${gear ? esc(gear.name) : SLOT_LABELS[slot]}</b><small>${gear ? esc(gearSummary(gear)) : '装備なし'}</small></span>
    </button>`;
  }).join('');
}
