import type { Trip } from './trip.entity.js';
import type { TripInvite } from './trip-invite.entity.js';
import type { TripMember } from './trip-member.entity.js';

export interface TripDetail extends Trip {
  members: TripMember[];
  pendingInvites: TripInvite[];
}
