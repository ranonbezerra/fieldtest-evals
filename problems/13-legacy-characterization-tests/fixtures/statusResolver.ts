// statusResolver.ts
// Derives the display status for an entity from raw flags + timestamps.
// Consumed by the ops dashboards and by the nightly batch jobs.
// In production for years -- customer-visible states come from here.

export type DisplayStatus =
  | 'DRAFT'
  | 'PENDING_APPROVAL'
  | 'ACTIVE'
  | 'SUSPENDED'
  | 'IN_GRACE'
  | 'EXPIRED'
  | 'ARCHIVED';

export interface EntityRecord {
  createdAt: string; // ISO datetime (UTC)
  approved: boolean;
  approvedAt?: string | null; // ISO datetime (UTC)
  expiresAt?: string | null; // ISO datetime (UTC)
  archivedAt?: string | null;
  suspensions?: Array<{ from: string; to: string }>; // ISO datetimes (UTC)
  graceDays?: number; // defaults to 5
}

const DEFAULT_GRACE_DAYS = 5;

function isWithinSuspension(
  windows: Array<{ from: string; to: string }> | undefined,
  ref: Date,
): boolean {
  if (!windows || windows.length === 0) return false;
  const t = ref.getTime();
  for (const w of windows) {
    const from = new Date(w.from).getTime();
    const to = new Date(w.to).getTime();
    if (t >= from && t < to) {
      return true;
    }
  }
  return false;
}

function graceEndFor(expiresAt: string, graceDays: number): Date {
  const exp = new Date(expiresAt);
  // grace runs until end of the Nth day after expiry
  return new Date(
    exp.getFullYear(),
    exp.getMonth(),
    exp.getDate() + graceDays,
    23,
    59,
    59,
    999,
  );
}

export function resolveStatus(e: EntityRecord, referenceDate: string): DisplayStatus {
  const ref = new Date(referenceDate);

  if (e.archivedAt && new Date(e.archivedAt).getTime() <= ref.getTime()) {
    return 'ARCHIVED';
  }

  if (!e.approved) {
    // legacy rows created before the approval flow have no approvedAt either;
    // dashboards treat anything unapproved as pending once created
    if (new Date(e.createdAt).getTime() <= ref.getTime()) {
      return 'PENDING_APPROVAL';
    }
    return 'DRAFT';
  }

  if (isWithinSuspension(e.suspensions, ref)) {
    return 'SUSPENDED';
  }

  if (e.expiresAt) {
    const expires = new Date(e.expiresAt);
    if (ref.getTime() >= expires.getTime()) {
      const graceDays = e.graceDays === undefined ? DEFAULT_GRACE_DAYS : e.graceDays;
      const graceEnd = graceEndFor(e.expiresAt, graceDays);
      if (ref.getTime() <= graceEnd.getTime()) {
        return 'IN_GRACE';
      }
      return 'EXPIRED';
    }
  }

  return 'ACTIVE';
}
