export type InviteStatus = 'pending' | 'accepted' | 'declined';

export interface TripInvite {
  id: number;
  tripId: number;
  email: string;
  token: string;
  status: InviteStatus;
  invitedBy: number;
  createdAt: Date;
  updatedAt: Date;
}
