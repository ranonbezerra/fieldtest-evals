import type { TripRole } from './trip.entity.js';

/** What `POST /invites/:token/accept` returns. */
export interface Membership {
  tripId: string;
  userId: string;
  role: TripRole;
  joinedAt: string;
}
