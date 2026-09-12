export interface Invite {
  token: string;
  email: string;
  status: 'pending' | 'accepted' | 'declined';
}
