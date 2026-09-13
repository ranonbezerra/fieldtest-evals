-- Covering index: filter by company + status, ordered by recency,
-- with all projected columns included so the query never touches the heap.
CREATE INDEX IF NOT EXISTS "idx_order_dashboard_covering"
  ON "order_dashboard" ("companyId", "status", "createdAt" DESC)
  INCLUDE ("orderId", "workerId", "workerName", "companyName", "amount", "updatedAt", "eventCount");
