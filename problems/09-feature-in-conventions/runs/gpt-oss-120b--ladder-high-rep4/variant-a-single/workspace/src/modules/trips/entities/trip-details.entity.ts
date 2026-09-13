import type { Trip } from './trip.entity.js';
import type { TripMember } from './trip-member.entity.js';
import type { Invite } from './invite.entity.js';

export interface TripDetails extends Trip {
  members: TripMember[];
  pendingInvites: Invite[];
}
