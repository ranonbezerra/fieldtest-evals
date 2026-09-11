export type InviteStatus = 'pending' | 'accepted' | 'declined';

/** What the API returns for a trip invite. */
export interface TripInvite {
  id: string;
  tripId: string;
  email: string;
  token: string;
  status: InviteStatus;
  createdAt: string;
}
