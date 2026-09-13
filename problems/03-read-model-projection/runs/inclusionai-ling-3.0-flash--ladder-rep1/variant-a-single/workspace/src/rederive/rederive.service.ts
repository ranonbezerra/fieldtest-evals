import { Injectable } from '@nestjs/common';
import { ProjectionService } from '../projection/projection.service';

@Injectable()
export class RederiveService {
  constructor(private readonly projection: ProjectionService) {}

  /**
   * Rebuilds the projection for an arbitrary date window from the source.
   * Idempotent: running it twice on the same window yields identical state.
   */
  async rederive(startDate: Date, endDate: Date) {
    return this.projection.rederiveWindow(startDate, endDate);
  }
}
