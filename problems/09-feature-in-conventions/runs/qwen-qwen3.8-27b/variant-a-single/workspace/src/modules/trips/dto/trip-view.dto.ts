export interface TripView {
  id: string;
  name: string;
  destination: string;
  startDate: string;
  endDate: string;
  createdAt: string;
  updatedAt: string;
}

export interface TripMemberView {
  id: string;
  userId: string;
  email: string | null;
  role: 'owner' | 'member';
  createdAt: string;
}

export interface TripInviteView {
  id: string;
  email: string;
  token: string;
  status: 'pending' | 'accepted' | 'declined';
  invitedById: string;
  createdAt: string;
}

export interface TripMembershipView {
  id: string;
  tripId: string;
  userId: string;
  role: 'owner' | 'member';
  createdAt: string;
}

export interface TripDetailView extends TripView {
  members: TripMemberView[];
  invites: TripInviteView[];
}
