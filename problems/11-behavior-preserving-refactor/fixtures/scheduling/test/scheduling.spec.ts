import { describe, expect, it } from 'vitest';
import { SchedulingService } from '../src/modules/scheduling/scheduling.service.js';
import type { Booking, SchedulingRepository, Slot, WorkingHours } from '../src/modules/scheduling/types.js';

function fakeRepo(slots: Slot[], hours: WorkingHours[]): SchedulingRepository {
  const bookings: Booking[] = [];
  return {
    async findSlots() {
      return slots;
    },
    async findSlot(id: string) {
      return slots.find((s) => s.id === id) ?? null;
    },
    async saveSlot() {},
    async workingHours() {
      return hours;
    },
    async createBooking(b: Booking) {
      bookings.push(b);
    },
    async findBookingBySlot(slotId: string) {
      return bookings.find((b) => b.slotId === slotId) ?? null;
    },
    async countBookingsToday() {
      return 0;
    },
  };
}

const future = new Date(Date.now() + 86_400_000).toISOString();

const slot = (over: Partial<Slot> = {}): Slot => ({
  id: 's1',
  providerId: 'p1',
  startsAt: future,
  endsAt: future,
  status: 'open',
  holdExpiresAt: null,
  bookedByCustomerId: null,
  ...over,
});

describe('SchedulingService', () => {
  it('holds an open slot', async () => {
    const s = slot();
    const svc = new SchedulingService(fakeRepo([s], []));
    const held = await svc.hold('s1', 'c1');
    expect(held.status).toBe('held');
  });

  it('refuses to book a slot that was never held', async () => {
    const svc = new SchedulingService(fakeRepo([slot()], []));
    await expect(svc.book('s1', 'c1')).rejects.toThrow();
  });

  it('books a held slot', async () => {
    const s = slot();
    const svc = new SchedulingService(fakeRepo([s], []));
    await svc.hold('s1', 'c1');
    const booking = await svc.book('s1', 'c1');
    expect(booking.slotId).toBe('s1');
  });
});
