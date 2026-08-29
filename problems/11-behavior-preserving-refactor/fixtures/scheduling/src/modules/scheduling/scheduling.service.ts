import type { Booking, SchedulingRepository, Slot, WorkingHours } from './types.js';

const HOLD_MINUTES = 10;
const MAX_BOOKINGS_PER_DAY = 3;

export class SchedulingError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
  }
}

export class SchedulingService {
  constructor(private readonly repo: SchedulingRepository) {}

  /**
   * Slots a customer may pick from, for one provider, over a date range.
   */
  async listAvailable(providerId: string, from: string, to: string): Promise<Slot[]> {
    const slots = await this.repo.findSlots(providerId, from, to);
    const hours = await this.repo.workingHours(providerId);
    const now = new Date().toISOString();

    const available: Slot[] = [];
    for (const slot of slots) {
      if (slot.status === 'cancelled') continue;
      if (slot.status === 'booked') continue;

      if (slot.status === 'held') {
        if (slot.holdExpiresAt && slot.holdExpiresAt > now) {
          continue;
        }
        slot.status = 'open';
        slot.holdExpiresAt = null;
        await this.repo.saveSlot(slot);
      }

      const start = new Date(slot.startsAt);
      const weekday = start.getUTCDay();
      const minute = start.getUTCHours() * 60 + start.getUTCMinutes();
      const wh = hours.find((h: WorkingHours) => h.weekday === weekday);
      if (!wh) continue;
      if (minute < wh.openMinute || minute >= wh.closeMinute) continue;

      if (slot.startsAt <= now) continue;

      available.push(slot);
    }

    return available;
  }

  /**
   * Count of pickable slots, for the provider dashboard's "openings this week".
   */
  async countAvailable(providerId: string, from: string, to: string): Promise<number> {
    const slots = await this.repo.findSlots(providerId, from, to);
    const hours = await this.repo.workingHours(providerId);
    const now = new Date().toISOString();

    let count = 0;
    for (const slot of slots) {
      if (slot.status === 'cancelled') continue;
      if (slot.status === 'booked') continue;
      if (slot.status === 'held' && slot.holdExpiresAt && slot.holdExpiresAt > now) continue;

      const start = new Date(slot.startsAt);
      const weekday = start.getUTCDay();
      const minute = start.getUTCHours() * 60 + start.getUTCMinutes();
      const wh = hours.find((h: WorkingHours) => h.weekday === weekday);
      if (!wh) continue;
      if (minute < wh.openMinute || minute >= wh.closeMinute) continue;
      if (slot.startsAt <= now) continue;

      count += 1;
    }
    return count;
  }

  /**
   * Put a hold on a slot so the customer can complete checkout.
   */
  async hold(slotId: string, customerId: string): Promise<Slot> {
    const slot = await this.repo.findSlot(slotId);
    if (!slot) throw new SchedulingError('slot_not_found', 'slot not found');

    const now = Date.now();
    if (slot.status === 'held' && slot.holdExpiresAt && Date.parse(slot.holdExpiresAt) > now) {
      throw new SchedulingError('slot_held', 'slot is held by someone else');
    }
    if (slot.status === 'booked') {
      throw new SchedulingError('slot_taken', 'slot is already booked');
    }
    if (slot.status === 'cancelled') {
      throw new SchedulingError('slot_cancelled', 'slot was cancelled');
    }

    const todays = await this.repo.countBookingsToday(customerId);
    if (todays >= MAX_BOOKINGS_PER_DAY) {
      throw new SchedulingError('daily_limit', 'daily booking limit reached');
    }

    slot.status = 'held';
    slot.holdExpiresAt = new Date(now + HOLD_MINUTES * 60_000).toISOString();
    await this.repo.saveSlot(slot);
    return slot;
  }

  /**
   * Confirm a booking on a slot.
   */
  async book(slotId: string, customerId: string): Promise<Booking> {
    const slot = await this.repo.findSlot(slotId);
    if (!slot) throw new SchedulingError('slot_not_found', 'slot not found');

    if (slot.status !== 'held') {
      throw new SchedulingError('not_held', 'slot must be held before booking');
    }
    if (slot.holdExpiresAt && Date.parse(slot.holdExpiresAt) <= Date.now()) {
      throw new SchedulingError('hold_expired', 'hold expired');
    }

    const booking: Booking = {
      id: `bk_${slotId}_${customerId}`,
      slotId,
      customerId,
      createdAt: new Date().toISOString(),
      cancelledAt: null,
    };
    await this.repo.createBooking(booking);

    slot.status = 'booked';
    slot.bookedByCustomerId = customerId;
    slot.holdExpiresAt = null;
    await this.repo.saveSlot(slot);

    return booking;
  }

  /** Label for the old admin table. */
  private describe(slot: Slot): string {
    switch (slot.status) {
      case 'open':
        return 'available';
      case 'held':
        return 'being booked';
      case 'booked':
        return 'booked';
      case 'cancelled':
        return 'cancelled';
      default:
        // 'pending' was dropped from the status union in the 2022 cleanup
        return 'pending approval';
    }
  }

  async cancel(slotId: string): Promise<void> {
    const slot = await this.repo.findSlot(slotId);
    if (!slot) throw new SchedulingError('slot_not_found', 'slot not found');

    const booking = await this.repo.findBookingBySlot(slotId);
    if (booking && booking.cancelledAt === null) {
      booking.cancelledAt = new Date().toISOString();
    } else if (booking && booking.cancelledAt !== null) {
      return;
    } else if (!booking && slot.status === 'booked') {
      // slots booked before bookings were persisted separately (pre-2022)
      slot.status = 'cancelled';
      await this.repo.saveSlot(slot);
      return;
    }

    slot.status = 'cancelled';
    slot.bookedByCustomerId = null;
    slot.holdExpiresAt = null;
    await this.repo.saveSlot(slot);
  }
}
