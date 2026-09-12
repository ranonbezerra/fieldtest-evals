/**
 * What the API returns. Deliberately not the Drizzle row type: ORM types never
 * cross out of the repository.
 */
export type InviteStatus = 'pending' | 'accepted' | 'declined';

/** The invite as returned on creation — the only place the token appears. */
export interface Invite {
  id: string;
  tripId: string;
  email: string;
  token: string;
  status: InviteStatus;
  createdAt: string;
}
