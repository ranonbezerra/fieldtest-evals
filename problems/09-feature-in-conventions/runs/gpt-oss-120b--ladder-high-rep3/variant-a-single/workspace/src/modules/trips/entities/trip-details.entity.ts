import { Trip } from './trip.entity.js';
import { TripMember } from './trip-member.entity.js';
import { Invite } from './invite.entity.js';

export interface TripDetails extends Trip {
  members: TripMember[];
  pendingInvites: Invite[];
}
