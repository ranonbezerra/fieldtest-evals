export type MemberRole = 'owner' | 'member';

/**
 * What the API returns. Deliberately not the Drizzle row type: ORM types never
 * cross out of the repository.
 */
export interface Member {
  userId: string;
  role: MemberRole;
  createdAt: string;
}
