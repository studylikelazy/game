import { describe, expect, it } from 'vitest';
import { GRAPHICS_PRESETS, GRAPHICS_QUALITIES, graphicsDpr, sanitizeGraphicsQuality } from '../src/graphics';

describe('graphics quality', () => {
  it('validates untrusted preferences without accepting prototype keys', () => {
    for (const q of GRAPHICS_QUALITIES) expect(sanitizeGraphicsQuality(q)).toBe(q);
    for (const q of [null, {}, 'constructor', '__proto__', undefined]) expect(sanitizeGraphicsQuality(q)).toBe('high');
  });
  it('bounds backbuffer size on phones, desktops and large displays', () => {
    for (const quality of GRAPHICS_QUALITIES) {
      for (const [w, h, dpr] of [[390, 844, 3], [1920, 1080, 2], [3840, 2160, 2]]) {
        const scale = graphicsDpr(quality, w, h, dpr);
        expect(scale).toBeGreaterThan(0);
        expect(scale).toBeLessThanOrEqual(GRAPHICS_PRESETS[quality].maxDpr);
        expect(w * h * scale * scale).toBeLessThanOrEqual(GRAPHICS_PRESETS[quality].pixels + .01);
      }
      expect(Number.isFinite(graphicsDpr(quality, 0, 0, 1))).toBe(true);
    }
  });
  it('reduces resolution and optional passes while leaving standard combat at 60fps', () => {
    const scales = GRAPHICS_QUALITIES.map(q => graphicsDpr(q, 1200, 800, 2));
    expect(scales[0]).toBeLessThan(scales[1]);
    expect(scales[1]).toBeLessThan(scales[2]);
    expect(GRAPHICS_PRESETS.low.fps).toBe(30);
    expect(GRAPHICS_PRESETS.medium.fps).toBe(60);
    expect(GRAPHICS_PRESETS.low.atmosphere).toBe(false);
    expect(GRAPHICS_PRESETS.medium.bloom).toBe(false);
    expect(GRAPHICS_PRESETS.high.bloom).toBe(true);
  });
});
