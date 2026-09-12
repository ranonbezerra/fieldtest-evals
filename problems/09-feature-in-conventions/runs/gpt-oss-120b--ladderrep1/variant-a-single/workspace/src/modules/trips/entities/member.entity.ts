export interface Member {
  id: string;
  userId: string;
  role: 'owner' | 'member';
  createdAt: string;
}
