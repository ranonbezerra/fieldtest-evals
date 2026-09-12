export type TripMemberRole = 'owner' | 'member';

/** A trip membership, joined with the user it belongs to. */
export interface TripMember {
  id: string;
  userId: string;
  email: string;
  displayName: string;
  role: TripMemberRole;
  /** ISO 8601 */
  createdAt: string;
}
