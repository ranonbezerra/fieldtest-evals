import type { TripInvite } from './trip-invite.entity.js';
import type { TripMember } from './trip-member.entity.js';

/**
 * What the API returns for a trip. Deliberately not the Drizzle row type:
 * ORM types never cross out of the repository.
 */
export interface Trip {
  id: string;
  name: string;
  destination: string;
  startsAt: string;
  endsAt: string;
  createdAt: string;
}

/** Trip with its members and pending invites (GET /trips/:id). */
export interface TripDetail extends Trip {
  members: TripMember[];
  pendingInvites: TripInvite[];
}
