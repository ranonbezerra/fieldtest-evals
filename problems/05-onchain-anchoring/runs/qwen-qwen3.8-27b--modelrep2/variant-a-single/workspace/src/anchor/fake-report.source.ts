import { assertJsonValue, type JsonValue } from './canonical';
import type { ReportSource } from './report.source';

/** In-memory report store for local runs and tests. */
export class FakeReportSource implements ReportSource {
  private readonly store = new Map<string, JsonValue>();

  seed(documentId: string, version: number, content: unknown): void {
    assertJsonValue(content);
    this.store.set(this.key(documentId, version), content);
  }

  has(documentId: string, version: number): boolean {
    return this.store.has(this.key(documentId, version));
  }

  async fetch(documentId: string, version: number): Promise<JsonValue | null> {
    return this.store.get(this.key(documentId, version)) ?? null;
  }

  private key(documentId: string, version: number): string {
    return `${documentId}@v${version}`;
  }
}
