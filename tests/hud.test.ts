import { describe, expect, it } from 'vitest';
import { healingFlask, resourceOrbs, resourcePercent } from '../src/hud';

describe('fantasy resource HUD', () => {
  it('scales resource levels against the actual gear-modified maximum', () => {
    expect(resourcePercent(60, 120)).toBe(50);
    expect(resourcePercent(75, 150)).toBe(50);
    expect(resourcePercent(150, 150)).toBe(100);
  });
  it('never draws a negative, overflowing or invalid fill', () => {
    expect(resourcePercent(-10, 100)).toBe(0);
    expect(resourcePercent(150, 100)).toBe(100);
    expect(resourcePercent(0, 0)).toBe(0);
    expect(resourcePercent(NaN, 100)).toBe(0);
    expect(resourcePercent(100, Infinity)).toBe(0);
  });
  it('preserves resource hooks and provides accessible life/stamina values', () => {
    const html = resourceOrbs();
    for (const id of ['hp-bar','hp-label','hp-max','st-bar','st-label','st-max','es-bar','es-label']) {
      expect(html.match(new RegExp(`id="${id}"`, 'g'))).toHaveLength(1);
    }
    expect(html.match(/role="progressbar"/g)).toHaveLength(2);
    expect(html).toContain('aria-label="生命"');
    expect(html).toContain('aria-label="気力"');
    expect(html).not.toContain('マナ');
  });
  it('uses an original filled healing flask with no interactive nested element', () => {
    expect(healingFlask()).toContain('class="flask-art"');
    expect(healingFlask()).toContain('aria-hidden="true"');
    expect(healingFlask()).not.toContain('<button');
  });
});
