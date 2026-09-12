export type TripInviteStatus = 'pending' | 'accepted' | 'declined';

export interface TripInvite {
  id: string;
  tripId: string;
  email: string;
  token: string;
  status: TripInviteStatus;
  /** ISO 8601 */
  createdAt: string;
}
