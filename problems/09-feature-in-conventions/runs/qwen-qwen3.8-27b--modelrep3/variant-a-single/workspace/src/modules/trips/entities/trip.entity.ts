import type { InviteStatus } from './invite.entity.js';

/**
 * What the API returns. Deliberately not the Drizzle row type: ORM types never
 * cross out of the repository.
 */
export type TripRole = 'owner' | 'member';

export interface TripMember {
  userId: string;
  role: TripRole;
  joinedAt: string;
}

/** An invite as listed on a trip. The token never appears here. */
export interface PendingInvite {
  id: string;
  email: string;
  status: InviteStatus;
  createdAt: string;
}

export interface Trip {
  id: string;
  name: string;
  destination: string;
  startDate: string;
  endDate: string;
  createdAt: string;
  members: TripMember[];
  pendingInvites: PendingInvite[];
}

/** A membership as returned by the invite-accept endpoint. */
export interface Membership {
  id: string;
  tripId: string;
  userId: string;
  role: TripRole;
  joinedAt: string;
}
