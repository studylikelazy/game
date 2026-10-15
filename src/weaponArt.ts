import { icon } from './icons';

/** Original AI-generated steel/brass/leather sword art, keyed to transparent RGBA. */
export const LONGSWORD_URL = `${import.meta.env.BASE_URL}assets/weapons/longsword.png`;
export const LONGSWORD_UI_URL = `${import.meta.env.BASE_URL}assets/weapons/longsword-ui.webp`;

export function hasSwordArt(kind: string) { return kind === 'sword' || kind === 'greatsword'; }

/** The crossguard is the pivot; increasing detail must not move the hand off the grip. */
export function swordSpriteRect(kind: string) {
  const heavy = kind === 'greatsword';
  const height = heavy ? 82 : 66;
  const width = heavy ? 30 : 26;
  return { x: -width / 2, y: -height * .739, width, height };
}

export function weaponArt(kind: string, fallback = 'sword') {
  return hasSwordArt(kind)
    ? `<img class="sword-art ${kind === 'greatsword' ? 'sword-art-heavy' : ''}" src="${LONGSWORD_UI_URL}" alt="" decoding="async" />`
    : icon(fallback);
}
