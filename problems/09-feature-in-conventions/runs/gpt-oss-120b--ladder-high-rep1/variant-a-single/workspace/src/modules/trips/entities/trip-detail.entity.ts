import type { Trip } from './trip.entity.js';
import type { Member } from './member.entity.js';
import type { Invite } from './invite.entity.js';

export interface TripDetail extends Trip {
  members: Member[];
  pendingInvites: Invite[];
}
