export interface Invite {
  id: string;
  tripId: string;
  email: string;
  token: string;
  status: 'pending' | 'accepted' | 'declined';
  createdAt: string;
}
