export type MemberRole = 'owner' | 'member';

/**
 * What the API returns. Deliberately not the Drizzle row types: ORM types
 * never cross out of the repository.
 */
export interface TripMember {
  id: string;
  userId: string;
  email: string;
  displayName: string;
  role: MemberRole;
  createdAt: string;
}
