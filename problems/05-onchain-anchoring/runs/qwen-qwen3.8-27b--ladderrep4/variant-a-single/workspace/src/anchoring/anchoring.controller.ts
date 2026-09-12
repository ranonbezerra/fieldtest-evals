import { Body, Controller, HttpCode, Param, Post } from '@nestjs/common';
import type { StoredAnchor } from './anchoring.repository.js';
import { AnchoringService } from './anchoring.service.js';
import { validationError } from '../common/domain-exception.js';

@Controller('documents')
export class AnchoringController {
  constructor(private readonly anchoring: AnchoringService) {}

  /** Issue a new report version (structured JSON, the source of truth). */
  @Post(':documentId/versions')
  issueVersion(@Param('documentId') documentId: string, @Body() body: { version?: unknown; content?: unknown } = {}) {
    return this.anchoring.createVersion(
      this.requireDocumentId(documentId),
      this.requireVersion(body.version),
      this.requireContent(body.content),
    );
  }

  /** Anchor a published version on the L2 (write-ahead intent, then broadcast). */
  @Post(':documentId/versions/:version/anchors')
  async createAnchor(
    @Param('documentId') documentId: string,
    @Param('version') version: string,
  ): Promise<Omit<StoredAnchor, 'signedTx'>> {
    const anchor = await this.anchoring.anchorDocument(this.requireDocumentId(documentId), this.requireVersion(version));
    // The signed tx is internal (re-broadcast material), never exposed by the API.
    const { signedTx: _signedTx, ...visible } = anchor;
    return visible;
  }

  /** Verify supplied content against the anchor: proof or mismatch report. */
  @Post(':documentId/versions/:version/anchors/verifications')
  @HttpCode(200)
  verify(
    @Param('documentId') documentId: string,
    @Param('version') version: string,
    @Body() body: { content?: unknown } = {},
  ) {
    return this.anchoring.verify(this.requireDocumentId(documentId), this.requireVersion(version), body.content);
  }

  private requireDocumentId(raw: unknown): string {
    if (typeof raw !== 'string' || raw.length === 0) {
      throw validationError('documentId must be a non-empty string', { documentId: raw ?? null });
    }
    return raw;
  }

  private requireVersion(raw: unknown): number {
    const version = Number(raw);
    if (!Number.isInteger(version) || version < 1) {
      throw validationError('version must be a positive integer', { version: raw ?? null });
    }
    return version;
  }

  private requireContent(raw: unknown): Record<string, unknown> {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      throw validationError('content must be a JSON object', {});
    }
    return raw as Record<string, unknown>;
  }
}
