import type { TripMember } from './trip-member.entity.js';
import type { Invite } from './invite.entity.js';

/**
 * What the API returns. Deliberately not the Drizzle row type: ORM types never
 * cross out of the repository.
 */
export interface Trip {
  id: string;
  name: string;
  destination: string;
  startsAt: string;
  endsAt: string;
  createdAt: string;
}

export interface TripDetail extends Trip {
  members: TripMember[];
  pendingInvites: Invite[];
}
