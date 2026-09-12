import type { Member } from './member.entity.js';
import type { Invite } from './invite.entity.js';

export interface Trip {
  id: string;
  name: string;
  destination: string;
  startDate: string;
  endDate: string;
  createdAt: string;
  members: Member[];
  pendingInvites: Invite[];
}
