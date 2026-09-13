/** What the API returns. Deliberately not the Drizzle row type. */
export interface Member {
  id: string;
  tripId: string;
  userId: string;
  role: 'owner' | 'member';
  createdAt: string;
}
