# repair1-projections.service.ts

## reasoning

```
The error is at line 22, column 5: "Declaration or statement expected." This typically means there's a syntax issue - perhaps a misplaced closing brace, a missing opening brace, or some other structural problem that causes the parser to expect a new declaration at that point.

Let me think about what the file should look like based on the PLAN.md:

The `ProjectionsService` class needs:
- Constructor taking `ProjectionsRepository`
- `applyOrderCreated(input: CreateOrderInput, order: { id: string; createdAt: Date }): Promise<void>`
- `applyOrderStatusChanged(orderId: string, newStatus: OrderStatus): Promise<void>`
- `rederive(from: Date, to: Date): Promise<DriftReport>`
- `repairDrift(from: Date, to: Date): Promise<DriftReport>`
- `getTotals(companyId: string): Promise<CompanyTotals>`

The error "Declaration or statement expected" at line 22, column 5 suggests that the class body is being closed too early, or there's a stray `}` that ends the class before line 22, and then the parser sees something it can't parse as a top-level declaration.

Let me think about what a typical broken version might look like. If the class closes with `}` around line 21, then line 22 would have a method definition that's now at the top level, causing "Declaration or statement expected."

I need to write the complete file that:
1. Compiles correctly
2. Implements all methods from the plan
3. Follows the layer rules (service has zero Prisma client calls, zero raw SQL)
4. Uses the repository for all DB access

Let me write it:

```typescript
import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { ProjectionsRepository } from './projections.repository';
import {
  CreateOrderInput,
  OrderStatus,
  OperationRow,
  CompanyTotals,
  DriftReport,
} from './projections.types';

@Injectable()
export class ProjectionsService {
  constructor(private readonly repo: ProjectionsRepository) {}

  async applyOrderCreated(
    input: CreateOrderInput,
    order: { id: string; createdAt: Date },
  ): Promise<void> {
    const row = await this.repo.fetchSourceRow(order.id);
    if (!row) {
      throw new NotFoundException({
        error: {
          code: 'order_not_found',
          message: `Order ${order.id} not found in source`,
          details: { orderId: order.id },
        },
      });
    }
    await this.repo.upsertOrder(row);
    await this.repo.adjustTotals(input.companyId, { pendingDelta: 1 });
  }

  async applyOrderStatusChanged(
    orderId: string,
    newStatus: OrderStatus,
  ): Promise<void> {
    const row = await this.repo.fetchSourceRow(orderId);
    if (!row) {
      throw new NotFoundException({
        error: {
          code: 'order_not_found',
          message: `Order ${orderId} not found in source`,
          details: { orderId },
        },
      });
    }
    await this.repo.updateOrderStatus(orderId, newStatus);
    
    const delta: { approvedCents?: bigint; rejectedCents?: bigint; pendingDelta?: number } = {};
    if (newStatus === 'approved') {
      delta.pendingDelta = -1;
      delta.approvedCents = BigInt(row.amountCents);
    } else if (newStatus === 'rejected') {
      delta.pendingDelta = -1;
      delta.rejectedCents = BigInt(row.amountCents);
    }
    await this.repo.adjustTotals(row.companyId, delta);
  }

  async rederive(from: Date, to: Date): Promise<DriftReport> {
    const rows = await this.repo.fetchSourceWindow(from, to);
    await this.repo.deleteProjectionWindow(from, to);
    await this.repo.bulkUpsert(rows);

    // Recompute totals for affected companies
    const companyMap = new Map<string, { approved: bigint; rejected: bigint; pending: number }>();
    for (const row of rows) {
      const entry = companyMap.get(row.companyId) ?? { approved: 0n, rejected: 0n, pending: 0 };
      if (row.status === 'approved') {
        entry.approved += BigInt(row.amountCents);
      } else if (row.status === 'rejected') {
        entry.rejected += BigInt(row.amountCents);
      } else if (row.status === 'pending') {
        entry.pending += 1;
      }
      companyMap.set(row.companyId, entry);
    }

    // We need to reset totals only for the window's contribution, but the plan says
    // "recompute totals for affected companies from the newly inserted rows" — however,
    // that would only give us window totals, not all-time totals. The plan says to use
    // resetTotals. But resetTotals would overwrite the all-time totals with just the window
    // totals, which is wrong unless we interpret "recompute" as reading all projection rows
    // for that company.
    
    // Actually, re-reading the plan: "For each affected company: recompute totals from the newly inserted rows; resetTotals."
    // This seems like it would only account for the window. But the plan explicitly says this, so I'll follow it.
    // Wait - actually for re-derivation of a window, we're replacing that window's data. The totals should reflect ALL data, not just the window.
    // 
    // Let me re-read: "recompute totals for affected companies from the newly inserted rows; resetTotals"
    // 
    // Hmm, I think the plan might intend that we read ALL projection rows for the affected companies and compute totals from those. Let me add a method or use what's available.
    // 
    // Actually, looking at the repository interface in the plan, there's no "fetchAllProjectionRowsForCompany" method. The available methods are:
    // - fetchSourceWindow(from, to)
    // - fetchProjectionWindow(from, to)
    // - getTotals(companyId)
    // 
    // I think the correct interpretation is: after re-deriving the window, we need to recompute totals for affected companies by reading ALL their projection rows. But the repo doesn't have that method.
    // 
    // Alternative: we could compute the delta from what was deleted vs what was inserted. But that's complex.
    // 
    // Actually, I think the simplest correct approach given the available repo methods is:
    // 1. Before deleting, read the old projection window to know what was there
    // 2. After inserting new rows, compute the net delta per company and apply adjustTotals
    // 
    // But wait, the plan says "resetTotals" not "adjustTotals". Let me look at what resetTotals does - it takes a CompanyTotals and sets the values. So we'd need to know the full totals.
    // 
    // I think the most reasonable interpretation that works with the available repository is:
    // - For each affected company, read all their projection rows (we need a way to do this)
    // - Compute totals
    // - Call resetTotals
    // 
    // But the repo doesn't expose "fetch all projection rows for a company". 
    // 
    // Let me re-read the plan more carefully... The plan says the repository has:
    // - fetchSourceWindow(from, to)
    // - fetchProjectionWindow(from, to)  
    // - deleteProjectionWindow(from, to)
    // - bulkUpsert(rows)
    // - getTotals(companyId)
    // 
    // I think for re-derivation, the pragmatic approach is:
    // 1. Fetch the old projection window (before deleting)
    // 2. Delete old rows
    // 3. Insert new rows
    // 4. For each affected company, compute the delta (new totals for window - old totals for window) and apply adjustTotals
    // 
    // This preserves the all-time totals correctly. Let me go with this approach.
    
    // Actually wait, I already called deleteProjectionWindow above. Let me restructure.
    
    // Let me redo this properly:
  }

  async repairDrift(from: Date, to: Date): Promise<DriftReport> {
    const sourceRows = await this.repo.fetchSourceWindow(from, to);
    const projectionRows = await this.repo.fetchProjectionWindow(from, to);

    const sourceMap = new Map(sourceRows.map(r => [r.id, r]));
    const projectionMap = new Map(projectionRows.map(r => [r.id, r]));

    // Find rows to upsert (in source but missing or stale in projection)
    const rowsToUpsert: OperationRow[] = [];
    for (const [id, srcRow] of sourceMap) {
      const projRow = projectionMap.get(id);
      if (!projRow || this.rowsDiffer(srcRow, projRow)) {
        rowsToUpsert.push(srcRow);
      }
    }

    // Find rows to delete (in projection but not in source)
    const rowsToDelete = projectionMap.keys()
      .filter(id => !sourceMap.has(id))
      .toArray ? [] : [...projectionMap.keys()].filter(id => !sourceMap.has(id));

    if (rowsToUpsert.length > 0) {
      await this.repo.bulkUpsert(rowsToUpsert);
    }

    // For deleted rows, we need a way to delete specific rows... The repo has deleteProjectionWindow(from, to)
    // but that deletes ALL in the window. We need to handle this differently.
    // 
    // Actually, if there are rows in projection but not in source, that means the source row was
    // deleted. We should delete those projection rows. But the repo doesn't have a "deleteByOrderIds" method.
    // 
    // Hmm, let me think about this differently. The plan says:
    // "rows in projection but not in source → delete"
    // 
    // The available repo methods don't include a targeted delete by ID. I'll need to work with what's available.
    // One approach: re-derive the entire window (delete all, insert all from source). This handles both cases.
    // 
    // Actually, that's exactly what rederive does! So repairDrift could just call rederive internally?
    // No, the plan distinguishes them. repairDrift is more targeted.
    // 
    // Let me just use deleteProjectionWindow + bulkUpsert for the whole window when there are discrepancies.
    // This is simpler and correct, even if less efficient than a targeted repair.
    
    // Actually, I'll take the simplest correct approach: if there's any drift, re-derive the window.
    const hasDrift = rowsToUpsert.length > 0 || [...projectionMap.keys()].some(id => !sourceMap.has(id));
    
    if (hasDrift) {
      await this.repo.deleteProjectionWindow(from, to);
      await this.repo.bulkUpsert(sourceRows);
    }

    // Recompute totals for affected companies
    const affectedCompanies = new Set<string>();
    sourceRows.forEach(r => affectedCompanies.add(r.companyId));
    projectionRows.forEach(r => affectedCompanies.add(r.companyId));

    let totalsCorrected = false;
    for (const companyId of affectedCompanies) {
      // We need to recompute totals from all projection rows for this company
      // But we only have window data... 
      // 
      // Same problem as before. Let me use a different strategy:
      // Compute what the totals SHOULD be by reading the current projection (post-fix) for this company.
      // But we don't have "fetch all projection rows for company" either.
      // 
      // OK, I think the pragmatic approach given the repo interface is:
      // 1. Get current totals from getTotals
      // 2. Compute the delta from the window changes
      // 3. Apply adjustTotals with the delta
      // 
      // For repairDrift specifically:
      // - Old projection rows in window → their contribution to totals
      // - New source rows in window → their correct contribution
      // - Delta = new contribution - old contribution
      // 
      // Let me compute this.
      
      const oldContribution = this.computeContribution(projectionRows.filter(r => r.companyId === companyId));
      const newContribution = this.computeContribution(sourceRows.filter(r => r.companyId === companyId));
      
      const deltaApproved = newContribution.approved - oldContribution.approved;
      const deltaRejected = newContribution.rejected - oldContribution.rejected;
      const deltaPending = newContribution.pending - oldContribution.pending;

      if (deltaApproved !== 0n || deltaRejected !== 0n || deltaPending !== 0) {
        await this.repo.adjustTotals(companyId, {
          approvedCents: deltaApproved !== 0n ? deltaApproved : undefined,
          rejectedCents: deltaRejected !== 0n ? deltaRejected : undefined,
          pendingDelta: deltaPending !== 0 ? deltaPending : undefined,
        });
        totalsCorrected = true;
      }
    }

    return {
      windowStart: from,
      windowEnd: to,
      rowsCorrected: rowsToUpsert.length + ([...projectionMap.keys()].filter(id => !sourceMap.has(id)).length),
      totalsCorrected,
    };
  }

  async getTotals(companyId: string): Promise<CompanyTotals> {
    const totals = await this.repo.getTotals(companyId);
    if (!totals) {
      throw new NotFoundException({
        error: {
          code: 'company_not_found',
          message: `No totals found for company ${companyId}`,
          details: { companyId },
        },
      });
    }
    return totals;
  }

  private rowsDiffer(a: OperationRow, b: OperationRow): boolean {
    return (
      a.status !== b.status ||
      a.amountCents !== b.amountCents ||
      a.workerName !== b.workerName ||
      a.eventTitle !== b.eventTitle ||
      a.eventLocation !== b.eventLocation
    );
  }

  private computeContribution(
    rows: OperationRow[],
  ): { approved: bigint; rejected: bigint; pending: number } {
    let approved = 0n;
    let rejected = 0n;
    let pending = 0;
    for (const row of rows) {
      if (row.status === 'approved') approved += BigInt(row.amountCents);
      else if (row.status === 'rejected') rejected += BigInt(row.amountCents);
      else if (row.status === 'pending') pending++;
    }
    return { approved, rejected, pending };
  }
}
```

Wait, I'm overcomplicating this. Let me re-read the plan for `rederive`:

"In `rederive`: delete old projection rows for the window → bulk-insert new rows → recompute totals for affected companies. All in one transaction."

And the control flow says:
"1. `ProjectionsService.rederive(from, to)` opens a transaction.
2. `DELETE FROM operation_read_models WHERE created_at >= $1 AND created_at < $2`.
3. `fetchSourceWindow(from, to)` — reads from `payment_orders` JOIN `workers` JOIN `events`.
4. `bulkUpsert(rows)`.
5. For each affected company: recompute totals from the newly inserted rows; `resetTotals`.
6. Commit. Return `DriftReport` with count of rows."

Step 5 says "recompute totals from the newly inserted rows" and use `resetTotals`. This means: compute the totals from just the window's rows and call resetTotals. But that would be wrong if there are orders outside the window...

Unless the interpretation is that `resetTotals` sets the absolute totals, and we're expected to compute them from ALL projection data for that company. But the plan says "from the newly inserted rows" which is just the window.

I think there might be an inconsistency in the plan, but I should follow it as stated. The plan says to use `resetTotals` with values computed from the newly inserted rows. I'll add an `// ASSUMPTION:` note about this.

Actually wait - maybe the plan's intent is that `rederive` is meant to be called for the FULL history (or at least a window that covers all data for the affected companies). In that case, "recompute totals from the newly inserted rows" would give correct all-time totals. This makes sense as a batch re-derivation tool.

OK, I'll follow the plan literally: compute totals from the newly inserted (window) rows and call resetTotals. I'll add an assumption note.

Now let me also think about the `rederive` method. The plan says "All in one transaction" but the service layer is supposed to have "Zero Prisma client calls." So how do we handle transactions?

Looking at the plan again: "WritesService.approveOrder / rejectOrder: read source order → validate transition → update source → call projections.applyOrderStatusChanged. Entire sequence in one $transaction."

So the transaction is managed by the WritesService (which has direct Prisma access per the plan - it's in the writes feature). The ProjectionsService methods are called within that transaction context.

But wait - the plan says WritesService has `constructor(prisma: PrismaClient, projections: ProjectionsService)`. So WritesService opens the transaction and calls both prisma directly AND projections service methods. The projections service methods must work within the active transaction.

For Prisma, you can pass a transaction client to nested operations. But the plan's ProjectionsService constructor only takes `ProjectionsRepository`, which takes `PrismaClient`. 

Hmm, this is a design tension. Let me look at how the plan handles this...

The plan says:
- `ProjectionsRepository` constructor takes `PrismaClient`
- `WritesService` constructor takes `PrismaClient` and `ProjectionsService`
- The entire write path is in one `$transaction`

I think the intended pattern is that `WritesService` uses `prisma.$transaction(async (tx) => { ... })` and within that, it calls prisma methods directly for source writes, and calls projections service methods. But the projections service uses its own `PrismaClient` instance...

This is a known issue with Prisma interactive transactions - you need to use the transaction client, not the regular one. But the plan as written has this tension.

For the purposes of making the file compile, I'll just implement the service methods as described in the plan. The transaction handling is the responsibility of the caller (WritesService) and how it integrates with Prisma's transaction system is a separate concern that affects the writes service, not the projections service.

Actually, for `rederive` and `repairDrift`, these are called by the drift-repair processor, not by WritesService. The plan says "All in one transaction" for rederive. Since ProjectionsService can't use Prisma directly (layer rule), and the repository uses PrismaClient... I think the repository methods are designed to be atomic enough, or the transaction is handled at a higher level.

You know what, let me just focus on making the file compile correctly with the right signatures and logic. The transaction concern is a design detail that would be handled in the repository or through Prisma's global transaction. The compiler error is just about syntax.

Let me write a clean version:

```typescript
import { Injectable, NotFoundException } from '@nestjs/common';
import { ProjectionsRepository } from './projections.repository';
import {
  CreateOrderInput,
  OrderStatus,
  OperationRow,
  CompanyTotals,
  DriftReport,
} from './projections.types';

@Injectable()
export class ProjectionsService {
  constructor(private readonly repo: ProjectionsRepository) {}

  async applyOrderCreated(
    input: CreateOrderInput,
    order: { id: string; createdAt: Date },
  ): Promise<void> {
    const row = await this.repo.fetchSourceRow(order.id);
    if (!row) {
      throw new NotFoundException({
        error: {
          code: 'order_not_found',
          message: `Order ${order.id} not found in source`,
          details: { orderId: order.id },
        },
      });
    }
    await this.repo.upsertOrder(row);
    await this.repo.adjustTotals(input.companyId, { pendingDelta: 1 });
  }

  async applyOrderStatusChanged(
    orderId: string,
    newStatus: OrderStatus,
  ): Promise<void> {
    const row = await this.repo.fetchSourceRow(orderId);
    if (!row) {
      throw new NotFoundException({
        error: {
          code: 'order_not_found',
          message: `Order ${orderId} not found in source`,
          details: { orderId },
        },
      });
    }
    await this.repo.updateOrderStatus(orderId, newStatus);

    const delta: { approvedCents?: bigint; rejectedCents?: bigint; pendingDelta?: number } = {};
    if (newStatus === 'approved') {
      delta.pendingDelta = -1;
      delta.approvedCents = BigInt(row.amountCents);
    } else if (newStatus === 'rejected') {
      delta.pendingDelta = -1;
      delta.rejectedCents = BigInt(row.amountCents);
    }

    await this.repo.adjustTotals(row.companyId, delta);
  }

  // ASSUMPTION: The plan specifies using resetTotals with values computed from the newly inserted window rows. This is correct when rederive covers all data for the affected companies (e.g., full-history re-derivation). For partial windows, this would overwrite all-time totals with window-only values.
  async rederive(from: Date, to: Date): Promise<DriftReport> {
    const rows = await this.repo.fetchSourceWindow(from, to);

    await this.repo.deleteProjectionWindow(from, to);
    if (rows.length > 0) {
      await this.repo.bulkUpsert(rows);
    }

    // Recompute totals for affected companies from the newly inserted rows
    const companyMap = new Map<string, { approved: bigint; rejected: bigint; pending: number }>();
    for (const row of rows) {
      const entry = companyMap.get(row.companyId) ?? { approved: 0n, rejected: 0n, pending: 0 };
      if (row.status === 'approved') {
        entry.approved += BigInt(row.amountCents);
      } else if (row.status === 'rejected') {
        entry.rejected += BigInt(row.amountCents);
      } else if (row.status === 'pending') {
        entry.pending += 1;
      }
      companyMap.set(row.companyId, entry);
    }

    for (const [companyId, totals] of companyMap) {
      await this.repo.resetTotals(companyId, {
        companyId,
        approvedTotalCents: totals.approved,
        rejectedTotalCents: totals.rejected,
        pendingCount: totals.pending,
      });
    }

    return {
      windowStart: from,
      windowEnd: to,
      rowsCorrected: rows.length,
      totalsCorrected: companyMap.size > 0,
    };
  }

  async repairDrift(from: Date, to: Date): Promise<DriftReport> {
    const sourceRows = await this.repo.fetchSourceWindow(from, to);
    const projectionRows = await this.repo.fetchProjectionWindow(from, to);

    const sourceMap = new Map(sourceRows.map((r) => [r.id, r]));
    const projectionMap = new Map(projectionRows.map((r) => [r.id, r]));

    // Identify discrepancies
    const rowsToUpsert: OperationRow[] = [];
    for (const [id, srcRow] of sourceMap) {
      const projRow = projectionMap.get(id);
      if (!projRow || this.rowsDiffer(srcRow, projRow)) {
        rowsToUpsert.push(srcRow);
      }
    }

    const orphanedIds = [...projectionMap.keys()].filter((id) => !sourceMap.has(id));

    const hasDrift = rowsToUpsert.length > 0 || orphanedIds.length > 0;

    if (hasDrift) {
      // Simplest correct approach: re-derive the entire window
      await this.repo.deleteProjectionWindow(from, to);
      if (sourceRows.length > 0) {
        await this.repo.bulkUpsert(sourceRows);
      }

      // Recompute totals for affected companies using delta approach
      const affectedCompanies = new Set<string>();
      sourceRows.forEach((r) => affectedCompanies.add(r.companyId));
      projectionRows.forEach((r) => affectedCompanies.add(r.companyId));

      let totalsCorrected = false;
      for (const companyId of affectedCompanies) {
        const oldContrib = this.computeContribution(
          projectionRows.filter((r) => r.companyId === companyId),
        );
        const newContrib = this.computeContribution(
          sourceRows.filter((r) => r.companyId === companyId),
        );

        const deltaApproved = newContrib.approved - oldContrib.approved;
        const deltaRejected = newContrib.rejected - oldContrib.rejected;
        const deltaPending = newContrib.pending - oldContrib.pending;

        if (deltaApproved !== 0n || deltaRejected !== 0n || deltaPending !== 0) {
          await this.repo.adjustTotals(companyId, {
            approvedCents: deltaApproved !== 0n ? deltaApproved : undefined,
            rejectedCents: deltaRejected !== 0n ? deltaRejected : undefined,
            pendingDelta: deltaPending !== 0 ? deltaPending : undefined,
          });
          totalsCorrected = true;
        }
      }

      return {
        windowStart: from,
        windowEnd: to,
        rowsCorrected: rowsToUpsert.length + orphanedIds.length,
        totalsCorrected,
      };
    }

    return {
      windowStart: from,
      windowEnd: to,
      rowsCorrected: 0,
      totalsCorrected: false,
    };
  }

  async getTotals(companyId: string): Promise<CompanyTotals> {
    const totals = await this.repo.getTotals(companyId);
    if (!totals) {
      throw new NotFoundException({
        error: {
          code: 'company_not_found',
          message: `No totals found for company ${companyId}`,
          details: { companyId },
        },
      });
    }
    return totals;
  }

  private rowsDiffer(a: OperationRow, b: OperationRow): boolean {
    return (
      a.status !== b.status ||
      a.amountCents !== b.amountCents ||
      a.workerName !== b.workerName ||
      a.eventTitle !== b.eventTitle ||
      a.eventLocation !== b.eventLocation
    );
  }

  private computeContribution(
    rows: OperationRow[],
  ): { approved: bigint; rejected: bigint; pending: number } {
    let approved = 0n;
    let rejected = 0n;
    let pending = 0;
    for (const row of rows) {
      if (row.status === 'approved') approved += BigInt(row.amountCents);
      else if (row.status === 'rejected') rejected += BigInt(row.amountCents);
      else if (row.status === 'pending') pending++;
    }
    return { approved, rejected, pending };
  }
}
```

Wait, I need to check - does the repository have a `fetchSourceRow` method? Looking at the plan's repository interface:

```
upsertOrder(order: OperationRow): Promise<void>;
updateOrderStatus(orderId: string, status: OrderStatus): Promise<void>;
adjustTotals(companyId: string, delta: {...}): Promise<void>;
resetTotals(companyId: string, totals: CompanyTotals): Promise<void>;
fetchSourceWindow(from: Date, to: Date): Promise<OperationRow[]>;
fetchProjectionWindow(from: Date, to: Date): Promise<OperationRow[]>;
deleteProjectionWindow(from: Date, to: Date): Promise<number>;
bulkUpsert(rows: OperationRow[]): Promise<void>;
getTotals(companyId: string): Promise<CompanyTotals | null>;
```

There's no `fetchSourceRow(orderId: string)` method! The plan only has `fetchSourceWindow(from, to)`.

So in `applyOrderCreated` and `applyOrderStatusChanged`, I can't call `this.repo.fetchSourceRow(order.id)`. 

Hmm, but the control flow says:
- For create: "Read the joined source row (order + worker + event) — all inside the transaction."
- For status change: "Read the order from payment_orders"

The WritesService has direct Prisma access, so it can read the source row. But then how does ProjectionsService get the joined row to upsert?

Looking more carefully at the plan's control flow for create:
1. WritesService opens transaction
2. Insert into payment_orders
3. Read the joined source row
4. Call ProjectionsService.applyOrderCreated

So the WritesService reads the row and... passes it? But the signature is `applyOrderCreated(input: CreateOrderInput, order: { id: string; createdAt: Date })`. It doesn't take the full joined row.

I think the intent is that `applyOrderCreated` itself reads the source row to build the projection row. But the repository doesn't have a single-row fetch method.

Options:
1. Add a `fetchSourceRow` method to the repository (but I'm told not to change files the error doesn't name)
2. Use `fetchSourceWindow` with a very narrow window around the order's createdAt
3. Have the service construct the row from available data

Actually wait - I'm only rewriting `projections.service.ts`. The repository file is separate and I shouldn't change it. But the error is only in `projections.service.ts`. So the repository might already have a `fetchSourceRow` method that's not listed in the plan (the plan is a guide, not the actual code).

The instruction says: "If a message refers to a shape you cannot see, say so in an `// ASSUMPTION:` line rather than guessing at it repeatedly."

I can't see the repository file. The error is in the service file. I need to make the service compile. If I call a method on the repository that doesn't exist, that would be a different error (TS2339 - property does not exist). The current error is TS1128 (Declaration or statement expected) which is a pure syntax error.

So the fix is purely syntactic. The current file has a syntax error at line 22. I need to produce a syntactically valid file that implements the plan.

Since I can't see the actual repository file, I'll use the methods listed in the plan and add an assumption if I need something not listed.

For `applyOrderCreated`, I need the full joined row to upsert. The plan's repository doesn't list a single-row fetch. I'll assume the repository has a `fetchSourceRow` method, or I'll restructure to avoid needing it.

Actually, let me think about this differently. The `applyOrderCreated` is called from within the WritesService's transaction. The WritesService already has the order data (it just created it). What if `applyOrderCreated` is designed to work with just the input + order id, and the repository's `upsertOrder` is expected to be called with a partially-constructed row?

No, that doesn't make sense. The projection row needs worker_name, event_title, event_location which come from joins.

I'll add an `// ASSUMPTION:` that the repository exposes a `fetchSourceRow(id: string): Promise<OperationRow | null>` method. This is the most reasonable interpretation given the control flow description.

Let me finalize my answer. The key fix is making it syntactically valid (no stray braces, proper class structure). Let me write it cleanly.
```

## reply

```typescript
import { Injectable, NotFoundException } from '@nestjs/common';
import { ProjectionsRepository } from './projections.repository';
import {
  CreateOrderInput,
  OrderStatus,
  OperationRow,
  CompanyTotals,
  DriftReport,
} from './projections.types';

@Injectable()
export class ProjectionsService {
  constructor(private readonly repo: ProjectionsRepository) {}

  async applyOrderCreated(
    input: CreateOrderInput,
    order: { id: string; createdAt: Date },
  ): Promise<void> {
    // ASSUMPTION: The repository exposes fetchSourceRow(id) returning the joined row; the plan's
    // control-flow requires reading worker/event data to build the projection row, but the
    // repository interface in the plan only lists fetchSourceWindow.
    const row = await this.repo.fetchSourceRow(order.id);
    if (!row) {
      throw new NotFoundException({
        error: {
          code: 'order_not_found',
          message: `Order ${order.id} not found in source`,
          details: { orderId: order.id },
        },
      });
    }
    await this.repo.upsertOrder(row);
    await this.repo.adjustTotals(input.companyId, { pendingDelta: 1 });
  }

  async applyOrderStatusChanged(
    orderId: string,
    newStatus: OrderStatus,
  ): Promise<void> {
    const row = await this.repo.fetchSourceRow(orderId);
    if (!row) {
      throw new NotFoundException({
        error: {
          code: 'order_not_found',
          message: `Order ${orderId} not found in source`,
          details: { orderId },
        },
      });
    }

    await this.repo.updateOrderStatus(orderId, newStatus);

    const delta: {
      approvedCents?: bigint;
      rejectedCents?: bigint;
      pendingDelta?: number;
    } = {};

    if (newStatus === 'approved') {
      delta.pendingDelta = -1;
      delta.approvedCents = BigInt(row.amountCents);
    } else if (newStatus === 'rejected') {
      delta.pendingDelta = -1;
      delta.rejectedCents = BigInt(row.amountCents);
    }

    await this.repo.adjustTotals(row.companyId, delta);
  }

  // ASSUMPTION: The plan specifies recomputing totals from the newly-inserted window rows and
  // calling resetTotals. This yields correct all-time totals when rederive covers the full
  // history for the affected companies. For a partial window it would overwrite all-time
  // totals with window-only values; the plan prescribes this behaviour explicitly.
  async rederive(from: Date, to: Date): Promise<DriftReport> {
    const rows = await this.repo.fetchSourceWindow(from, to);

    await this.repo.deleteProjectionWindow(from, to);
    if (rows.length > 0) {
      await this.repo.bulkUpsert(rows);
    }

    const companyMap = new Map<
      string,
      { approved: bigint; rejected: bigint; pending: number }
    >();

    for (const row of rows) {
      const entry =
        companyMap.get(row.companyId) ?? { approved: 0n, rejected: 0n, pending: 0 };
      if (row.status === 'approved') {
        entry.approved += BigInt(row.amountCents);
      } else if (row.status === 'rejected') {
        entry.rejected += BigInt(row.amountCents);
      } else if (row.status === 'pending') {
        entry.pending += 1;
      }
      companyMap.set(row.companyId, entry);
    }

    for (const [companyId, totals] of companyMap) {
      await this.repo.resetTotals(companyId, {
        companyId,
        approvedTotalCents: totals.approved,
        rejectedTotalCents: totals.rejected,
        pendingCount: totals.pending,
      });
    }

    return {
      windowStart: from,
      windowEnd: to,
      rowsCorrected: rows.length,
      totalsCorrected: companyMap.size > 0,
    };
  }

  async repairDrift(from: Date, to: Date): Promise<DriftReport> {
    const sourceRows = await this.repo.fetchSourceWindow(from, to);
    const projectionRows = await this.repo.fetchProjectionWindow(from, to);

    const sourceMap = new Map(sourceRows.map((r) => [r.id, r]));
    const projectionMap = new Map(projectionRows.map((r) => [r.id, r]));

    const rowsToUpsert: OperationRow[] = [];
    for (const [id, srcRow] of sourceMap) {
      const projRow = projectionMap.get(id);
      if (!projRow || this.rowsDiffer(srcRow, projRow)) {
        rowsToUpsert.push(srcRow);
      }
    }

    const orphanedCount = [...projectionMap.keys()].filter(
      (id) => !sourceMap.has(id),
    ).length;

    const hasDrift = rowsToUpsert.length > 0 || orphanedCount > 0;

    if (!hasDrift) {
      return {
        windowStart: from,
        windowEnd: to,
        rowsCorrected: 0,
        totalsCorrected: false,
      };
    }

    // Re-derive the window to fix all discrepancies in one pass.
    await this.repo.deleteProjectionWindow(from, to);
    if (sourceRows.length > 0) {
      await this.repo.bulkUpsert(sourceRows);
    }

    // Adjust totals by the delta between old projection contribution and new source contribution.
    const affectedCompanies = new Set<string>();
    sourceRows.forEach((r) => affectedCompanies.add(r.companyId));
    projectionRows.forEach((r) => affectedCompanies.add(r.companyId));

    let totalsCorrected = false;
    for (const companyId of affectedCompanies) {
      const oldContrib = this.computeContribution(
        projectionRows.filter((r) => r.companyId === companyId),
      );
      const newContrib = this.computeContribution(
        sourceRows.filter((r) => r.companyId === companyId),
      );

      const deltaApproved = newContrib.approved - oldContrib.approved;
      const deltaRejected = newContrib.rejected - oldContrib.rejected;
      const deltaPending = newContrib.pending - oldContrib.pending;

      if (deltaApproved !== 0n || deltaRejected !== 0n || deltaPending !== 0) {
        await this.repo.adjustTotals(companyId, {
          approvedCents: deltaApproved !== 0n ? deltaApproved : undefined,
          rejectedCents: deltaRejected !== 0n ? deltaRejected : undefined,
          pendingDelta: deltaPending !== 0 ? deltaPending : undefined,
        });
        totalsCorrected = true;
      }
    }

    return {
      windowStart: from,
      windowEnd: to,
      rowsCorrected: rowsToUpsert.length + orphanedCount,
      totalsCorrected,
    };
  }

  async getTotals(companyId: string): Promise<CompanyTotals> {
    const totals = await this.repo.getTotals(companyId);
    if (!totals) {
      throw new NotFoundException({
        error: {
          code: 'company_not_found',
          message: `No totals found for company ${companyId}`,
          details: { companyId },
        },
      });
    }
    return totals;
  }

  private rowsDiffer(a: OperationRow, b: OperationRow): boolean {
    return (
      a.status !== b.status ||
      a.amountCents !== b.amountCents ||
      a.workerName !== b.workerName ||
      a.eventTitle !== b.eventTitle ||
      a.eventLocation !== b.eventLocation
    );
  }

  private computeContribution(
    rows: OperationRow[],
  ): { approved: bigint; rejected: bigint; pending: number } {
    let approved = 0n;
    let rejected = 0n;
    let pending = 0;
    for (const row of rows) {
      if (row.status === 'approved') approved += BigInt(row.amountCents);
      else if (row.status === 'rejected') rejected += BigInt(row.amountCents);
      else if (row.status === 'pending') pending++;
    }
    return { approved, rejected, pending };
  }
}
```
