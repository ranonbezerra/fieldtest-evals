import { Injectable } from '@nestjs/common';
import { DriftRepairRepository, DriftFindings } from './drift-repair.repository';
import { ProjectionService } from '../projection/projection.service';

// ASSUMPTION: ProjectionService exposes rederiveWindow(from: Date, to: Date): Promise<void>,
// as referenced by the DriftRepairRepository documentation comment.

@Injectable()
export class DriftRepairService {
  constructor(
    private readonly repository: DriftRepairRepository,
    private readonly projectionService: ProjectionService,
  ) {}

  async repairWindow(from: Date, to: Date): Promise<DriftFindings> {
    const findings = await this.repository.findDrift(from, to);
    if (findings.driftedCompanyIds.length > 0) {
      await this.projectionService.rederiveWindow(from, to);
    }
    return findings;
  }
}
