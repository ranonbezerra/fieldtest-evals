import { InjectionToken } from '@nestjs/common';

/**
 * Port to the platform's document store.
 * // ASSUMPTION: the task does not define where the structured content for
 * // (documentId, version) comes from; the platform's document service is
 * // modelled as this port, which the anchoring service depends on.
 */
export const DOCUMENT_SOURCE: InjectionToken<DocumentSource> = Symbol('DOCUMENT_SOURCE');

export interface DocumentSource {
  /** Returns the structured content (JSON object) for the given document version. */
  get(documentId: string, version: number): Promise<Record<string, unknown>>;
}
