import type { MemberRole } from '../entities/trip-member.entity.js';

export interface MemberView {
  userId: number;
  role: MemberRole;
}

export interface PendingInviteView {
  email: string;
  token: string;
}

export class GetTripResponseDto {
  id: number;
  name: string;
  destination: string;
  startDate: string;
  endDate: string;
  members: MemberView[];
  pendingInvites: PendingInviteView[];
}
