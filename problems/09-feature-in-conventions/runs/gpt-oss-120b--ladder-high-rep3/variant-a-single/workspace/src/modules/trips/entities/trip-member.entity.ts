export interface TripMember {
  tripId: string;
  userId: string;
  role: 'owner' | 'member';
  createdAt: string;
  updatedAt: string;
}
