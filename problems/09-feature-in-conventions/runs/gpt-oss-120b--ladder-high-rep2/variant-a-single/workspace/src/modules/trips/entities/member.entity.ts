import type { User } from '../../users/entities/user.entity.js';

export interface Member {
  user: User;
  role: 'owner' | 'member';
}
