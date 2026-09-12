/**
 * What the API returns. Deliberately not the Drizzle row types: ORM types
 * never cross out of the repository.
 */
export type TripRole = 'owner' | 'member';
export type InviteStatus = 'pending' | 'accepted' | 'declined';

export interface TripMember {
  id: string;
  userId: string;
  email: string;
  displayName: string;
  role: TripRole;
  createdAt: string;
}

export interface TripInvite {
  id: string;
  email: string;
  // ASSUMPTION: there is no email delivery in the scaffold, so the invite
  // response returns the token to the owner; the trip view below omits it.
  token: string;
  status: InviteStatus;
  createdAt: string;
}

/** What a member sees in the trip view: the token is never listed. */
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
  startsAt: string;
  endsAt: string;
  createdAt: string;
  members: TripMember[];
  pendingInvites: PendingInvite[];
}
