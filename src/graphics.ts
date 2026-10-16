/** Presentation-only preferences: never used by simulation or the server. */
export type GraphicsQuality = 'low' | 'medium' | 'high';
export const GRAPHICS_QUALITIES: readonly GraphicsQuality[] = ['low', 'medium', 'high'];
export const GRAPHICS_PRESETS = {
  low: { label: '低（軽量）', description: '最大30fps・低解像度。光のにじみ、霧・灰・粒状感を省略。', fps: 30, maxDpr: 1, pixels: 800_000, bloom: false, atmosphere: false, grain: false },
  medium: { label: '標準', description: '最大60fps・中解像度。霧・灰を維持し、光のにじみと粒状感を省略。', fps: 60, maxDpr: 1.5, pixels: 1_400_000, bloom: false, atmosphere: true, grain: false },
  high: { label: '高（従来の画質）', description: '最大60fps・高解像度。光のにじみ、霧・灰・粒状感を表示。', fps: 60, maxDpr: 2, pixels: 2_000_000, bloom: true, atmosphere: true, grain: true },
} as const;
export function sanitizeGraphicsQuality(value: unknown): GraphicsQuality {
  return GRAPHICS_QUALITIES.includes(value as GraphicsQuality) ? value as GraphicsQuality : 'high';
}
export function graphicsDpr(quality: GraphicsQuality, width: number, height: number, deviceDpr: number): number {
  const preset = GRAPHICS_PRESETS[quality];
  return Math.min(Math.max(1, deviceDpr), preset.maxDpr, Math.sqrt(preset.pixels / Math.max(1, width * height)));
}
