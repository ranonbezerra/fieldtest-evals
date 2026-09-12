import type { JsonValue } from './canonical';

// ASSUMPTION: the task provides no report store, so the canonical structured
// content (the source of truth the anchor is computed over, never the PDF
// rendering) is fetched through this port. FakeReportSource is the wiring for
// local runs and tests; a production deployment provides the real store.
export interface ReportSource {
  fetch(documentId: string, version: number): Promise<JsonValue | null>;
}

/** DI token. */
export const REPORT_SOURCE = 'REPORT_SOURCE';
