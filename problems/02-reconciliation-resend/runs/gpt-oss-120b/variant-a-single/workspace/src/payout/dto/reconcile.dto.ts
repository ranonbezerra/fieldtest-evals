// src/payout/dto/reconcile.dto.ts

/**
 * Data Transfer Object for the payout reconciliation endpoint.
 *
 * The exact shape required by the service layer is not visible in the provided
 * codebase. Based on typical reconciliation semantics, we assume the endpoint
 * needs a time window that defines the period to reconcile.
 *
 * @property start  ISO‑8601 timestamp marking the beginning of the window.
 * @property end    ISO‑8601 timestamp marking the end of the window.
 *
 * No external validation library (e.g., class‑validator) is imported to avoid
 * compilation errors caused by a missing dependency. Validation can be added
 * later once the package is available.
 *
 * // ASSUMPTION: The reconciliation payload consists of `start` and `end`
 * // ISO‑8601 date strings. Adjust the property names/types if the actual
 * // implementation differs.
 */
export class ReconcileDto {
  /** ISO‑8601 start of the reconciliation window */
  start!: string;

  /** ISO‑8601 end of the reconciliation window */
  end!: string;
}
