/**
 * What the API returns. Deliberately not the Drizzle row type: ORM types never
 * cross out of the repository.
 */
export interface User {
  id: string;
  email: string;
  displayName: string;
  createdAt: string;
}
