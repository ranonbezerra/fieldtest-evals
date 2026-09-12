export interface Invite {
  id: string;
  token: string;
  email: string;
  status: 'pending' | 'accepted' | 'declined';
  createdAt: string;
}
