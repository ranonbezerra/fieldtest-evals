import { Body, Controller, Inject, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ApiError } from '../common/api-error';
import { assertJsonValue, type JsonValue } from './canonical';
import { AnchorService } from './anchor.service';

@Controller('anchors')
export class AnchorController {
  constructor(@Inject(AnchorService) private readonly anchors: AnchorService) {}

  /** POST /anchors — anchor one report version; idempotent per (document, version). */
  @Post()
  async anchor(@Body() body: unknown, @Res() res: Response): Promise<void> {
    const documentId = readDocumentId(body);
    const version = readVersion(body);
    const dto = await this.anchors.anchorDocument(documentId, version);
    res.status(dto.state === 'CONFIRMED' ? 200 : 202).json(dto);
  }

  /** POST /anchors/verify — recompute the canonical hash; return the proof or a mismatch report. */
  @Post('verify')
  async verify(@Body() body: unknown, @Res() res: Response): Promise<void> {
    const documentId = readDocumentId(body);
    const version = readVersion(body);
    const content = readContent(body);
    const result = await this.anchors.verify(documentId, version, content);
    res.status(200).json(result);
  }
}

function readBody(body: unknown): Record<string, unknown> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new ApiError(400, 'invalid_request', 'request body must be a JSON object');
  }
  return body as Record<string, unknown>;
}

function readDocumentId(body: unknown): string {
  const { documentId } = readBody(body);
  if (typeof documentId !== 'string' || documentId.length === 0 || documentId.length > 255) {
    throw new ApiError(400, 'invalid_request', 'documentId must be a non-empty string of at most 255 characters');
  }
  return documentId;
}

function readVersion(body: unknown): number {
  const { version } = readBody(body);
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    throw new ApiError(400, 'invalid_request', 'version must be a positive integer');
  }
  return version;
}

function readContent(body: unknown): JsonValue {
  const { content } = readBody(body);
  if (content === undefined) {
    throw new ApiError(400, 'invalid_request', 'content is required');
  }
  assertJsonValue(content);
  return content;
}
