import { afterEach, describe, expect, it, vi } from 'vitest';
import { GameAudio } from '../src/audio';

afterEach(() => vi.unstubAllGlobals());

describe('optional browser audio', () => {
  it('does not request an audio context until a user gesture', () => {
    const context = vi.fn();
    vi.stubGlobal('window', { AudioContext: context });
    const audio = new GameAudio();
    audio.update(1 / 60);
    audio.setMuted(true);
    audio.setMuted(false);
    audio.ui();
    expect(context).not.toHaveBeenCalled();
  });
  it('keeps all public sound hooks safe when Web Audio is unavailable', () => {
    vi.stubGlobal('window', {});
    const audio = new GameAudio();
    expect(() => {
      audio.unlock();
      audio.setSfxVolume(0);
      audio.setAmbientVolume(0);
      audio.setFires([[10, 10]]);
      audio.setListener(0, 0);
      audio.setScene('raid');
      audio.update(.1);
      audio.attack('sword');
      audio.attack('bow');
      audio.attack('crossbow');
      audio.swing('heavy');
      audio.bowShot();
      audio.crossbowShot();
      audio.impact({ material: 'metal', crit: true });
      audio.enemyAttack('wolf');
      audio.hurt();
      audio.block();
      audio.death('knight');
      audio.alert('bandit');
      audio.heal();
      audio.pickupRare();
      audio.coin();
      audio.dodge();
      audio.footstep(true);
      audio.tick();
      audio.extract();
      audio.equip();
      audio.warHorn();
      audio.ui('open');
      audio.setMuted(true);
    }).not.toThrow();
  });
});
