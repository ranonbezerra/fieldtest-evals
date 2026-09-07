import type { User } from '../../users/entities/user.entity.js';
import type { Invite } from './invite.entity.js';

export interface Trip {
  id: string;
  name: string;
  destination: string;
  startDate: string;
  endDate: string;
  ownerId: string;
  createdAt: string;
  members: User[];
  pendingInvites: Invite[];
}
