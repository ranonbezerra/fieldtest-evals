import { Injectable } from '@nestjs/common';
import type { Worker } from '@prisma/client';
import { AppError } from '../common/errors.js';
import { TransactionService } from '../common/transaction.service.js';
import { ProjectionService } from '../projection/projection.service.js';
import { WorkersRepository } from './workers.repository.js';

@Injectable()
export class WorkersService {
  constructor(
    private readonly repository: WorkersRepository,
    private readonly transactions: TransactionService,
    private readonly projection: ProjectionService,
  ) {}

  create(input: { companyId: string; name: string }): Promise<Worker> {
    // A brand-new worker has no operations yet, so no projection update is needed.
    return this.repository.create(undefined, input);
  }

  rename(id: string, name: string): Promise<Worker> {
    return this.transactions.run(async (tx) => {
      const worker = await this.repository.findById(tx, id);
      if (!worker) throw AppError.notFound('worker', id);
      const updated = await this.repository.rename(tx, id, name);
      // The denormalised worker_name on the projection must follow the rename.
      await this.projection.onWorkerRenamed(tx, id, name);
      return updated;
    });
  }
}
