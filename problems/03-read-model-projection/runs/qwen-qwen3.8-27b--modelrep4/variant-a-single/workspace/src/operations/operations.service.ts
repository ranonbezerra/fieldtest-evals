import { Injectable } from '@nestjs/common';
import { ApiError } from '../common/api-error.js';
import { isOrderStatus } from '../common/order-status.js';
import {
  OperationsRepository,
  type OperationViewRow,
  type OperationsFilter,
  type TotalsRow,
} from './operations.repository.js';

const DAY_MS = 86_400_000;

export interface DriftRepairResult {
  companiesRepaired: string[];
  windowsRepaired: number;
}

interface StatusTotal {
  amountCents: number;
  count: number;
}

interface TotalsDto {
  pending: StatusTotal;
  approved: StatusTotal;
  rejected: StatusTotal;
  completed: StatusTotal;
  cancelled: StatusTotal;
}

function parseIso(value: string, field: string): Date {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new ApiError(400, 'validation_error', `"${field}" must be a valid ISO-8601 date`, { field });
  }
  return parsed;
}

function toOperationDto(row: OperationViewRow) {
  return {
    id: row.id,
    companyId: row.company_id,
    workerId: row.worker_id,
    workerName: row.worker_name,
    eventId: row.event_id,
    eventTitle: row.event_title,
    eventVenue: row.event_venue,
    eventStartsAt: row.event_starts_at,
    status: row.status,
    amountCents: row.amount_cents,
    currency: row.currency,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toTotalsDto(row: TotalsRow | null): TotalsDto {
  const n = (value: bigint | undefined): number => Number(value ?? 0n);
  return {
    pending: { amountCents: n(row?.pending_cents), count: n(row?.pending_count) },
    approved: { amountCents: n(row?.approved_cents), count: n(row?.approved_count) },
    rejected: { amountCents: n(row?.rejected_cents), count: n(row?.rejected_count) },
    completed: { amountCents: n(row?.completed_cents), count: n(row?.completed_count) },
    cancelled: { amountCents: n(row?.cancelled_cents), count: n(row?.cancelled_count) },
  };
}

@Injectable()
export class OperationsService {
  constructor(private readonly repo: OperationsRepository) {}

  /** The dashboard: one index scan on the projection + one counter read. */
  async list(query: {
    companyId: string;
    status?: string;
    from?: string;
    to?: string;
    page?: number;
    pageSize?: number;
  }) {
    if (query.status !== undefined && !isOrderStatus(query.status)) {
      throw new ApiError(400, 'validation_error', `unknown status "${query.status}"`, { field: 'status' });
    }
    const from = query.from !== undefined ? parseIso(query.from, 'from') : new Date(0);
    const to = query.to !== undefined ? parseIso(query.to, 'to') : new Date('2999-01-01T00:00:00.000Z');
    if (from.getTime() >= to.getTime()) {
      throw new ApiError(400, 'validation_error', '"from" must be strictly earlier than "to"', { field: 'from' });
    }
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    if (pageSize > 100) {
      throw new ApiError(400, 'validation_error', '"pageSize" must be at most 100', { field: 'pageSize', max: 100 });
    }

    const filter: OperationsFilter = { companyId: query.companyId, status: query.status, from, to };
    const [rows, totalItems, totals] = await Promise.all([
      this.repo.findPage(filter, pageSize, (page - 1) * pageSize),
      this.repo.count(filter),
      this.repo.getTotals(query.companyId),
    ]);
    const totalItemsNumber = Number(totalItems);
    return {
      items: rows.map(toOperationDto),
      pagination: {
        page,
        pageSize,
        totalItems: totalItemsNumber,
        totalPages: totalItemsNumber === 0 ? 0 : Math.ceil(totalItemsNumber / pageSize),
      },
      totals: toTotalsDto(totals),
    };
  }

  /** Re-derivation routine for an arbitrary date window (optionally one company). */
  async rederive(from: string, to: string, companyId?: string) {
    const fromDate = parseIso(from, 'from');
    const toDate = parseIso(to, 'to');
    if (fromDate.getTime() >= toDate.getTime()) {
      throw new ApiError(400, 'validation_error', '"from" must be strictly earlier than "to"', { field: 'from' });
    }
    const scope = companyId !== undefined && companyId.trim() !== '' ? companyId : undefined;
    await this.repo.rederive(fromDate, toDate, scope);
    return { derived: true, from: fromDate.toISOString(), to: toDate.toISOString(), companyId: scope ?? null };
  }

  /**
   * Scheduled drift repair: re-derives every (company, day) window whose
   * digest no longer matches the source tables, then re-checks the all-time
   * per-company totals as a backstop for drift older than the lookback window.
   */
  async repairDrift(): Promise<DriftRepairResult> {
    const rawLookback = Number(process.env.DRIFT_REPAIR_LOOKBACK_DAYS ?? 14);
    const lookbackDays = Number.isFinite(rawLookback) && rawLookback > 0 ? rawLookback : 14;
    const now = new Date();
    const windowStart = new Date(now.getTime() - lookbackDays * DAY_MS);

    const dayDrift = await this.repo.driftCheck(windowStart, now);
    const windowsByCompany = new Map<string, { from: Date; to: Date }>();
    for (const { companyId, day } of dayDrift) {
      const dayEnd = new Date(day.getTime() + DAY_MS);
      const current = windowsByCompany.get(companyId);
      if (current === undefined) {
        windowsByCompany.set(companyId, { from: day, to: dayEnd });
      } else {
        if (day.getTime() < current.from.getTime()) current.from = day;
        if (dayEnd.getTime() > current.to.getTime()) current.to = dayEnd;
      }
    }

    const companiesRepaired: string[] = [];
    let windowsRepaired = 0;
    for (const [companyId, window] of windowsByCompany) {
      await this.repo.rederive(window.from, window.to, companyId);
      companiesRepaired.push(companyId);
      windowsRepaired += 1;
    }

    for (const companyId of await this.repo.companyTotalsDrift()) {
      if (windowsByCompany.has(companyId)) continue;
      const range = await this.repo.companyOrderRange(companyId);
      if (range !== null) {
        await this.repo.rederive(range.min, new Date(range.max.getTime() + DAY_MS), companyId);
      } else {
        await this.repo.dropCompanyProjection(companyId);
      }
      companiesRepaired.push(companyId);
      windowsRepaired += 1;
    }

    return { companiesRepaired, windowsRepaired };
  }
}
