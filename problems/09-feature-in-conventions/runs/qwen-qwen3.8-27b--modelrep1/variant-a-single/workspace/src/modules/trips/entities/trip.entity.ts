import type { TripInvite } from './invite.entity.js';
import type { TripMember } from './member.entity.js';

/**
 * What the API returns. Deliberately not the Drizzle row type: ORM types
 * never cross out of the repository.
 */
export interface Trip {
  id: string;
  name: string;
  destination: string;
  /** YYYY-MM-DD */
  startDate: string;
  /** YYYY-MM-DD */
  endDate: string;
  /** ISO 8601 */
  createdAt: string;
}

/** GET /trips/:id — the trip plus its members and still-pending invites. */
export interface TripDetail extends Trip {
  members: TripMember[];
  pendingInvites: TripInvite[];
}
