export type TripRole = 'owner' | 'member';

export interface TripMember {
  id: string;
  tripId: string;
  userId: string;
  email: string;
  role: TripRole;
  createdAt: string;
}
