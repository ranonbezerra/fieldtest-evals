import type { Member } from './member.entity.js';
import type { Invite } from './invite.entity.js';

/** What the API returns. Deliberately not the Drizzle row type. */
export interface Trip {
  id: string;
  name: string;
  destination: string;
  startsAt: string;
  endsAt: string;
  createdAt: string;
}

/** Trip with members and pending invites — the GET :id response shape. */
export interface TripDetail {
  trip: Trip;
  members: Member[];
  pendingInvites: Invite[];
}
