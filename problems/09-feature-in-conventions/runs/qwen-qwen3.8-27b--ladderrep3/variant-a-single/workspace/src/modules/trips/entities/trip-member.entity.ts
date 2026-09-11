export type TripRole = 'owner' | 'member';

/** What the API returns for a trip member. */
export interface TripMember {
  id: string;
  tripId: string;
  userId: string;
  email: string;
  displayName: string;
  role: TripRole;
  createdAt: string;
}
