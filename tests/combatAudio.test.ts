import { describe, expect, it } from 'vitest';
import { attackStarted } from '../src/combatAudio';
import { addPlayer, makeGame, stepGame } from '../src/game';

const idle = { attackSerial: 0, cooldown: 0, swing: 0 };

describe('accepted attack audio triggers', () => {
  it('detects an attack even if its animation finished between frames', () => {
    expect(attackStarted(idle, { attackSerial: 1, cooldown: .1, swing: 0 })).toBe(true);
  });
  it('does not replay the same snapshot or play on cooldown decay', () => {
    const current = { attackSerial: 1, cooldown: .3, swing: .1 };
    expect(attackStarted(current, current)).toBe(false);
    expect(attackStarted(current, { ...current, cooldown: .2, swing: 0 })).toBe(false);
  });
  it('can follow an older online server using cooldown resets', () => {
    expect(attackStarted({ cooldown: .1, swing: .1 }, { cooldown: .5, swing: .08 })).toBe(true);
  });
  it('increments only for accepted melee swings and bow shots', () => {
    const state = makeGame(); state.enemies = [];
    const p = addPlayer(state, 'p');
    p.input.attack = true;
    stepGame(state, 1 / 60);
    expect(p.attackSerial).toBe(1);
    expect(attackStarted(idle, p)).toBe(true);
    stepGame(state, 1 / 60);
    expect(p.attackSerial).toBe(1);
    p.cooldown = 0; p.input.weapon = 'bow';
    stepGame(state, 1 / 60);
    expect(p.attackSerial).toBe(2);
    p.cooldown = 0; p.arrows = 0;
    stepGame(state, 1 / 60);
    expect(p.attackSerial).toBe(2);
    p.input.weapon = 'melee'; p.stamina = 0;
    stepGame(state, 1 / 60);
    expect(p.attackSerial).toBe(2);
  });
});
