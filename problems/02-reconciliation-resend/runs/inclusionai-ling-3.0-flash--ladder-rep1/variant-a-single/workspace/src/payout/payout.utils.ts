import { createHash } from "crypto";

// ASSUMPTION: txid is a 24-char hex substring of SHA-256(orderRef:effectiveDate)
// since no specific format was mandated beyond determinism.
export function deriveTxid(orderRef: string, effectiveDate: Date): string {
  const dateStr = effectiveDate.toISOString().split("T")[0];
  return createHash("sha256").update(`${orderRef}:${dateStr}`).digest("hex").substring(0, 24);
}
