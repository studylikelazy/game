/** Detect accepted attacks, not input clicks: failed attacks must stay silent. */
export interface AttackSnapshot { attackSerial?: number; cooldown: number; swing: number }
export function attackStarted(previous: AttackSnapshot, current: AttackSnapshot): boolean {
  if (typeof previous.attackSerial === 'number' && typeof current.attackSerial === 'number') {
    return current.attackSerial > previous.attackSerial;
  }
  // Compatibility with older multiplayer servers without an attack counter.
  return current.swing > previous.swing || current.cooldown > previous.cooldown + .05;
}
