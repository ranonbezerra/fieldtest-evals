import type { Invite } from './invite.entity.js';
import type { TripMember } from './member.entity.js';

/**
 * What the API returns. Deliberately not the Drizzle row types: ORM types
 * never cross out of the repository.
 */
export interface Trip {
  id: string;
  name: string;
  destination: string;
  startsAt: string;
  endsAt: string;
  createdAt: string;
}

export interface TripDetail {
  trip: Trip;
  members: TripMember[];
  invites: Invite[];
}
