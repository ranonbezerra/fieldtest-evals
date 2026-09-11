import 'reflect-metadata';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PayoutProcessor,
  RECONCILE_INTERVAL_MS,
  RECONCILE_WINDOW_MS,
} from '../src/payout/payout.processor.js';
import type { ReconcileWindow } from '../src/payout/payout.service.js';

class FakePayoutService {
  windows: ReconcileWindow[] = [];

  async reconcile(window: ReconcileWindow): Promise<void> {
    this.windows.push({ from: new Date(window.from), to: new Date(window.to) });
  }
}

describe('PayoutProcessor', () => {
  beforeEach(() => {
    delete process.env.RECONCILE_INTERVAL_MS;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('consecutive ticks reconcile trailing windows that overlap', async () => {
    const service = new FakePayoutService();
    const processor = new PayoutProcessor(service);

    const first = new Date('2025-03-10T12:00:00.000Z');
    await processor.tick(first);
    await processor.tick(new Date(first.getTime() + RECONCILE_INTERVAL_MS));

    const [w1, w2] = service.windows;
    expect(w1.to).toEqual(first);
    expect(w1.from).toEqual(new Date(first.getTime() - RECONCILE_WINDOW_MS));
    expect(w2.from.getTime()).toBeLessThan(w1.to.getTime()); // the overlap
    expect(w2.to.getTime() - w2.from.getTime()).toBe(RECONCILE_WINDOW_MS);
  });

  it('schedules a reconcile on the interval and stops on destroy', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-03-10T12:00:00.000Z'));

    const service = new FakePayoutService();
    const processor = new PayoutProcessor(service);
    processor.onModuleInit();

    await vi.advanceTimersByTimeAsync(RECONCILE_INTERVAL_MS);
    expect(service.windows).toHaveLength(1);
    expect(service.windows[0].to).toEqual(new Date('2025-03-10T12:15:00.000Z'));

    processor.onModuleDestroy();
    await vi.advanceTimersByTimeAsync(RECONCILE_INTERVAL_MS * 2);
    expect(service.windows).toHaveLength(1);
  });
});
