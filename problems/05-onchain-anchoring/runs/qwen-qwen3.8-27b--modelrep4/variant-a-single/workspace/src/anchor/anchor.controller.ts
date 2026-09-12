import { Body, Controller, Post } from '@nestjs/common';
import { AnchorService } from './anchor.service.js';
import { AnchorBadRequestError } from './anchor.errors.js';

@Controller('anchors')
export class AnchorController {
  constructor(private readonly anchoring: AnchorService) {}

  /** POST /anchors — anchor a published (document, version). */
  @Post()
  anchorDocument(@Body() body: unknown) {
    const { documentId, version } = AnchorController.readIdPair(body);
    return this.anchoring.anchorDocument(documentId, version);
  }

  /** POST /anchors/verifications — verify content against the stored anchor. */
  @Post('verifications')
  verify(@Body() body: unknown) {
    const { documentId, version, content } = AnchorController.readVerificationRequest(body);
    return this.anchoring.verify(documentId, version, content);
  }

  private static readIdPair(body: unknown): { documentId: string; version: string } {
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      throw new AnchorBadRequestError('request body must be a JSON object');
    }
    const record = body as Record<string, unknown>;
    if (typeof record.documentId !== 'string' || record.documentId.length === 0 || record.documentId.length > 255) {
      throw new AnchorBadRequestError('documentId must be a non-empty string of at most 255 characters', {
        field: 'documentId',
      });
    }
    if (typeof record.version !== 'string' || record.version.length === 0 || record.version.length > 255) {
      throw new AnchorBadRequestError('version must be a non-empty string of at most 255 characters', {
        field: 'version',
      });
    }
    return { documentId: record.documentId, version: record.version };
  }

  private static readVerificationRequest(body: unknown): {
    documentId: string;
    version: string;
    content: Record<string, unknown>;
  } {
    const { documentId, version } = AnchorController.readIdPair(body);
    const record = body as Record<string, unknown>;
    if (typeof record.content !== 'object' || record.content === null || Array.isArray(record.content)) {
      throw new AnchorBadRequestError('content must be a JSON object', { field: 'content' });
    }
    return { documentId, version, content: record.content as Record<string, unknown> };
  }
}
