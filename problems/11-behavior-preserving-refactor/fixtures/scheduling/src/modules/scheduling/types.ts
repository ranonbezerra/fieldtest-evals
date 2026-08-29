export interface Slot {
  id: string;
  providerId: string;
  startsAt: string; // ISO datetime, UTC
  endsAt: string;
  status: 'open' | 'held' | 'booked' | 'cancelled';
  holdExpiresAt: string | null;
  bookedByCustomerId: string | null;
}

export interface WorkingHours {
  providerId: string;
  weekday: number; // 0 = Sunday
  openMinute: number; // minutes from midnight, provider local time
  closeMinute: number;
}

export interface Booking {
  id: string;
  slotId: string;
  customerId: string;
  createdAt: string;
  cancelledAt: string | null;
}

export interface SchedulingRepository {
  findSlots(providerId: string, from: string, to: string): Promise<Slot[]>;
  findSlot(slotId: string): Promise<Slot | null>;
  saveSlot(slot: Slot): Promise<void>;
  workingHours(providerId: string): Promise<WorkingHours[]>;
  createBooking(booking: Booking): Promise<void>;
  findBookingBySlot(slotId: string): Promise<Booking | null>;
  countBookingsToday(customerId: string): Promise<number>;
}
