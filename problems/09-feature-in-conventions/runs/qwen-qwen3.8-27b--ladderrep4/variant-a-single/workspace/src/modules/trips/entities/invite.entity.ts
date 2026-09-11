export type InviteStatus = 'pending' | 'accepted' | 'declined';

/**
 * What the API returns. Deliberately not the Drizzle row types: ORM types
 * never cross out of the repository.
 */
export interface Invite {
  id: string;
  email: string;
  token: string;
  status: InviteStatus;
  createdAt: string;
}
