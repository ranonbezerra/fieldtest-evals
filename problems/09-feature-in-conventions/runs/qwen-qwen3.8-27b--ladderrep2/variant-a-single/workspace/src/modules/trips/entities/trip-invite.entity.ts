export type TripInviteStatus = 'pending' | 'accepted' | 'declined';

export interface TripInvite {
  id: string;
  email: string;
  status: TripInviteStatus;
  createdAt: string;
}

/**
 * The invite as returned to the owner who created or re-fetched it. The token
 * is the accept credential; it is never listed on `GET /trips/:id`.
 */
export interface TripInviteWithToken extends TripInvite {
  token: string;
}
