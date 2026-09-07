export interface Invite {
  id: string;
  email: string;
  token: string;
  status: 'pending' | 'accepted' | 'declined';
}
