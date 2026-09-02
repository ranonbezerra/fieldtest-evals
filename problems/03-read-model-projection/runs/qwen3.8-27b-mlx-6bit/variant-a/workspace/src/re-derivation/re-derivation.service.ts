import { Injectable } from "@nestjs/common";
import { OperationsRepository } from "../operations/operations.repository.js";
import type { ReDeriveInput } from "../operations/operations.types.js";
import { InvalidDateRangeError } from "../operations/operations.types.js";

@Injectable()
export class ReDerivationService {
  constructor(private readonly repo: OperationsRepository) {}

  async reDerive(input: ReDeriveInput): Promise<{ rows_rewritten: number }> {
    if (input.date_from >= input.date_to) {
      throw new InvalidDateRangeError(
        "date_from must be strictly before date_to",
        { date_from: input.date_from.toISOString(), date_to: input.date_to.toISOString() },
      );
    }

    // ASSUMPTION: OperationsRepository exposes reDeriveWindow(from: Date, to: Date): Promise<number>
    // which performs batched (500-row) transactional re-derivation — upserting projection rows and
    // recomputing company_financial_totals via SUM/COUNT from source — and returns the number of
    // rows rewritten. This keeps all Prisma $transaction calls in the repository layer per the
    // "service has zero Prisma client calls" rule.
    const rowsRewritten = await this.repo.reDeriveWindow(input.date_from, input.date_to);

    return { rows_rewritten: rowsRewritten };
  }
}
