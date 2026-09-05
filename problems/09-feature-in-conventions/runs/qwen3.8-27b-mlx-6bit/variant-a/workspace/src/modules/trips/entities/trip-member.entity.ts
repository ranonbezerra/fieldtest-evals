export type MemberRole = 'owner' | 'member';

export interface TripMember {
  id: number;
  tripId: number;
  userId: number;
  role: MemberRole;
  createdAt: Date;
  updatedAt: Date;
}
