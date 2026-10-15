import { describe, expect, it } from 'vitest';
import { dailyFor, recordDailyProgress, todayLocalIso, type DailySave } from '../src/daily';

describe('daily contract', () => {
  it('is deterministic for a date and changes across dates', () => {
    expect(dailyFor('2026-10-15')).toEqual(dailyFor('2026-10-15'));
    const ids = new Set<string>();
    for (let d = 1; d <= 14; d++) ids.add(dailyFor(`2026-10-${String(d).padStart(2, '0')}`).metric);
    expect(ids.size).toBeGreaterThan(1);
  });
  it('formats the local calendar day, never the UTC day', () => {
    const eveningTokyo = new Date(2026, 0, 1, 23, 30);
    expect(todayLocalIso(eveningTokyo)).toBe('2026-01-01');
  });
  it('capped progress at the goal and rolls over on a new day', () => {
    let slot: DailySave = { date: '', progress: 0, claimed: false };
    slot = recordDailyProgress(slot, '2026-10-15', 3, 4);
    expect(slot).toEqual({ date: '2026-10-15', progress: 3, claimed: false });
    slot = recordDailyProgress(slot, '2026-10-15', 5, 4);
    expect(slot.progress).toBe(4);
    slot = recordDailyProgress(slot, '2026-10-16', 1, 4);
    expect(slot).toEqual({ date: '2026-10-16', progress: 1, claimed: false });
  });
  it('stops accruing once claimed', () => {
    let slot: DailySave = { date: '2026-10-15', progress: 4, claimed: true };
    slot = recordDailyProgress(slot, '2026-10-15', 3, 4);
    expect(slot.progress).toBe(4);
  });
  it('rewards are positive coins and goals reachable', () => {
    for (let d = 1; d <= 31; d++) {
      const task = dailyFor(`2026-10-${String(d).padStart(2, '0')}`);
      expect(task.goal).toBeGreaterThan(0);
      expect(task.reward).toBeGreaterThan(0);
      expect(task.desc.length).toBeGreaterThan(4);
    }
  });
});
