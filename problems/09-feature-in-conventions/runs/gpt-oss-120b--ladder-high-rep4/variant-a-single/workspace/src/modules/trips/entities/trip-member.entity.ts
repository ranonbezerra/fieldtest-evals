export interface TripMember {
  id: string;
  userId: string;
  role: 'owner' | 'member';
  createdAt: string;
}
