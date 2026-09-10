import { Injectable } from '@nestjs/common';
import { ApiError } from '../common/api-error.js';
import { RederivationRepository, type RederivationResult } from './rederivation.repository.js';

@Injectable()
export class RederivationService {
  constructor(private readonly repo: RederivationRepository) {}

  // Re-derives the read model for an arbitrary [from, to) date window.
  async rederive(from: Date, to: Date): Promise<RederivationResult> {
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      throw new ApiError('invalid_date_range', 'from and to must be valid dates', {
        from: from.toISOString(),
        to: to.toISOString(),
      });
    }
    if (from >= to) {
      throw new ApiError('invalid_date_range', 'from must be earlier than to', {
        from: from.toISOString(),
        to: to.toISOString(),
      });
    }
    return this.repo.rederiveWindow(from, to);
  }
}
