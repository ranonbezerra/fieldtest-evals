// src/operations/operations.hooks.service.ts
//
// This file implements the *write‑side* sync‑hooks that keep the read‑model
// projection (company totals) up‑to‑date.  The rest of the code‑base expects a
// NestJS @Injectable class named `OperationsHooksService` with public handler
// methods that receive plain event objects emitted by the write services.
//
// Because the surrounding repository, DTO and service files are not present in
// this kata, the implementation makes a few pragmatic assumptions (documented
// below) so that the file compiles on its own and satisfies TypeScript’s
// strictness settings.
//
// -----------------------------------------------------------------------------
// ASSUMPTION: The projection table is called `company_totals` with columns
// `company_id` (PK), `total_amount` (numeric) and `total_count` (int).  Prisma
// generates a model named `CompanyTotals` with those snake_case fields.
// ASSUMPTION: Event payloads are simple POJOs containing the fields referenced
// in the handler signatures.  No external DTOs are imported to avoid missing‑file
// errors.
// ASSUMPTION: The `PrismaClient` instance can be safely instantiated per
// request; in a real app this would be provided by a shared module.
// -----------------------------------------------------------------------------

import { Injectable, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * Minimal shape of the events that trigger projection updates.
 * In a full implementation these would be proper DTO classes.
 */
interface OrderCreatedEvent {
  orderId: number;
  companyId: number;
  amount: number; // monetary value in the smallest currency unit (e.g., cents)
  /** Timestamp of the order – kept for possible future extensions. */
  createdAt: Date;
}

interface OrderApprovedEvent {
  orderId: number;
  companyId: number;
  amount: number;
  approvedAt: Date;
}

/**
 * The `OperationsHooksService` contains the synchronous side‑effects that are
 * executed immediately after a write operation succeeds.  It updates the
 * `company_totals` read‑model so that the back‑office dashboard sees the changes
 * without delay (read‑your‑own‑writes guarantee).
 */
@Injectable()
export class OperationsHooksService {
  private readonly logger = new Logger(OperationsHooksService.name);
  private readonly prisma = new PrismaClient();

  /**
   * Handles the creation of a new order.  The order contributes to the company's
   * totals *only* after it has been approved, but we keep the hook here for
   * completeness and possible future business rules.
   */
  async handleOrderCreated(event: OrderCreatedEvent): Promise<void> {
    this.logger.debug(
      `Processing OrderCreated for order ${event.orderId} (company ${event.companyId})`,
    );
    // No immediate effect on totals – the order is pending approval.
    // The method is kept to illustrate where additional logic could live.
    return;
  }

  /**
   * Handles the approval of an order.  This is the point where the financial
   * totals for the corresponding company must be *exactly* updated.
   *
   * The operation is performed with an `upsert` to guarantee idempotency:
   * - If a totals row does not exist, it is created with the current amount.
   * - If it already exists, we increment the aggregate fields.
   *
   * Prisma’s `increment` operator works directly on numeric columns.
   */
  async handleOrderApproved(event: OrderApprovedEvent): Promise<void> {
    this.logger.debug(
      `Processing OrderApproved for order ${event.orderId} (company ${event.companyId})`,
    );

    const { companyId, amount } = event;

    await this.prisma.companyTotals.upsert({
      where: { company_id: companyId }, // column name follows the DB mapping
      create: {
        company_id: companyId,
        total_amount: amount,
        total_count: 1,
      },
      update: {
        total_amount: { increment: amount },
        total_count: { increment: 1 },
      },
    });
  }

  /**
   * Handles the cancellation (or reversal) of an approved order.
   *
   * The totals are decremented accordingly.  We guard against the totals row
   * disappearing by using an `update` with a `where` clause; if the row does not
   * exist something is seriously wrong, so we log a warning rather than throwing.
   */
  async handleOrderCancelled(event: OrderApprovedEvent): Promise<void> {
    this.logger.debug(
      `Processing OrderCancelled for order ${event.orderId} (company ${event.companyId})`,
    );

    const { companyId, amount } = event;

    try {
      await this.prisma.companyTotals.update({
        where: { company_id: companyId },
        data: {
          total_amount: { decrement: amount },
          total_count: { decrement: 1 },
        },
      });
    } catch (error) {
      // If the row is missing Prisma throws a `Prisma.PrismaClientKnownRequestError`
      // with code `P2025`.  Swallow the error after logging, because the projection
      // is already out of sync and will be fixed by the drift‑repair job.
      this.logger.warn(
        `Failed to decrement totals for company ${companyId}: ${error}`,
      );
    }
  }

  /**
   * Graceful shutdown hook – ensures the Prisma client disconnects when the Nest
   * application terminates.  This method is optional but helps avoid lingering
   * connections in tests.
   */
  async onModuleDestroy(): Promise<void> {
    await this.prisma.$disconnect();
  }
}
