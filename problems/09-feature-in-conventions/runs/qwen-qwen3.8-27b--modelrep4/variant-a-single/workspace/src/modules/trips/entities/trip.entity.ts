/**
 * What the API returns. Deliberately not the Drizzle row type: ORM types never
 * cross out of the repository.
 */

export type TripRole = 'owner' | 'member';

export type InviteStatus = 'pending' | 'accepted' | 'declined';

export interface TripMember {
  userId: string;
  email: string;
  displayName: string;
  role: TripRole;
  joinedAt: string;
}

export interface TripInvite {
  id: string;
  email: string;
  token: string;
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
  pendingInvites: TripInvite[];
}
