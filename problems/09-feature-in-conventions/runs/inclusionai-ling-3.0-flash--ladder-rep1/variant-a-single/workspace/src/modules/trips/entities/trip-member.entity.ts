export interface TripMember {
  id: string;
  tripId: string;
  userId: string;
  role: 'owner' | 'member';
  createdAt: string;
}
