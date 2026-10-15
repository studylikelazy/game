import { bowGear, meleeGear, type Player } from './game';
import { baseOf, RARITIES, weaponProfile, type Gear } from './items';

export type Element = 'fire' | 'cold' | 'lightning';
export const ELEMENT_COLORS: Record<Element, string> = {
  fire: '#ff873c', cold: '#80dfff', lightning: '#b4a0ff',
};

/** Only the actual damage profile controls elemental VFX; rarity is a fallback, not fake damage. */
export function dominantElement(damage: { fire: number; cold: number; lightning: number }): Element | null {
  const entries: Element[] = ['fire', 'cold', 'lightning'];
  let best: Element | null = null;
  for (const key of entries) if (damage[key] > 0 && (!best || damage[key] > damage[best])) best = key;
  return best;
}

export function weaponAppearance(player: Player) {
  const gear = player.weapon === 'bow' ? bowGear(player) : meleeGear(player);
  const profile = weaponProfile(gear, player.globals);
  const element = dominantElement(profile);
  return {
    kind: profile.kind,
    twoHanded: profile.base.handed === 2,
    element,
    color: element ? ELEMENT_COLORS[element] : gear && gear.rarity !== 'normal' ? RARITIES[gear.rarity].color : null,
  };
}

export type ChestMaterial = 'leather' | 'chain' | 'cloth';
export function chestMaterial(gear: Gear | undefined): ChestMaterial {
  if (!gear) return 'leather';
  const base = baseOf(gear);
  if (!base || !('armour' in base)) return 'leather';
  if (base.energyShield > base.armour) return 'cloth';
  return base.armour >= 30 ? 'chain' : 'leather';
}

/** A smooth eased, single sweep instead of a weapon snapping back and forth every frame. */
export function swingPose(remaining: number, duration = .22) {
  if (remaining <= 0) return .2;
  const t = Math.max(0, Math.min(1, 1 - remaining / duration));
  const eased = t * t * (3 - 2 * t);
  return -1.35 + eased * 2.8;
}

/** Screen-space body stays upright; only the held weapon follows the world-space aim. */
export function facingPose(angle: number) {
  const x = Math.cos(angle), y = Math.sin(angle);
  return {
    back: y < -.28,
    side: x < -.15 ? -1 : 1,
    headX: x * 2.1,
    width: .78 + Math.abs(y) * .14,
    weaponAngle: angle + Math.PI / 2,
  };
}
