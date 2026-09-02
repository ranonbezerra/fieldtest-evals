import { Injectable, Logger } from "@nestjs/common";
import { OperationsRepository } from "../operations/operations.repository";
import type { ReDeriveInput } from "../operations/operations.types";
import { InvalidDateRangeError } from "../operations/operations.types";

// ASSUMPTION: The repository exposes a `reDeriveBatch(orders: Record<string, unknown>[])` method
// that encapsulates the per-500-row interactive transaction described in the plan's control-flow
// section (worker lookup, last-event lookup, projection upsert, totals recompute). The service
// layer must not hold a Prisma client reference, so the transaction boundary lives in the repo.

@Injectable()
export class ReDerivationService {
  private readonly logger = new Logger(ReDerivationService.name);
  private static readonly BATCH_SIZE = 500;

  constructor(private readonly repo: OperationsRepository) {}

  async reDerive(input: ReDeriveInput): Promise<{ rows_rewritten: number }> {
    if (input.date_from >= input.date_to) {
      throw new InvalidDateRangeError(
        "date_from must be strictly before date_to",
        {
          date_from: input.date_from.toISOString(),
          date_to: input.date_to.toISOString(),
        },
      );
    }

    const orders = await this.repo.findOrdersByWindow(input.date_from, input.date_to);
    let rowsRewritten = 0;

    for (let i = 0; i < orders.length; i += ReDerivationService.BATCH_SIZE) {
      const batch = orders.slice(i, i + ReDerivationService.BATCH_SIZE);
      await this.repo.reDeriveBatch(batch);
      rowsRewritten += batch.length;
    }

    this.logger.log(`Re-derivation complete: ${rowsRewritten} rows rewritten`);

    return { rows_rewritten: rowsRewritten };
  }
}
