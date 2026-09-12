import { Body, Controller, Get, Param, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ApiError } from '../common/api-error.js';
import { AnchorsService, VerifyResult } from './anchors.service.js';

function parseDocumentId(raw: string): string {
  if (raw.length === 0 || raw.length > 128) {
    throw new ApiError('validation_failed', 400, 'documentId must be a non-empty string of at most 128 characters', {
      field: 'documentId',
    });
  }
  return raw;
}

function parseVersionParam(raw: string): number {
  const version = Number(raw);
  if (!Number.isInteger(version) || version < 1) {
    throw new ApiError('validation_failed', 400, 'version must be a positive integer', { field: 'version' });
  }
  return version;
}

function parseAnchorBody(body: unknown): { documentId: string; version: number } {
  if (typeof body !== 'object' || body === null) {
    throw new ApiError('validation_failed', 400, 'body must be an object');
  }
  const { documentId, version } = body as Record<string, unknown>;
  if (typeof documentId !== 'string' || documentId.length === 0 || documentId.length > 128) {
    throw new ApiError('validation_failed', 400, 'documentId must be a non-empty string of at most 128 characters', {
      field: 'documentId',
    });
  }
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    throw new ApiError('validation_failed', 400, 'version must be a positive integer', { field: 'version' });
  }
  return { documentId, version };
}

function parseVerifyBody(body: unknown): { documentId: string; version: number; content: unknown } {
  const { documentId, version } = parseAnchorBody(body);
  const content = (body as Record<string, unknown>).content;
  if (content === null || typeof content !== 'object') {
    throw new ApiError('validation_failed', 400, 'content must be a JSON object or array', { field: 'content' });
  }
  return { documentId, version, content };
}

@Controller('anchors')
export class AnchorsController {
  constructor(private readonly anchors: AnchorsService) {}

  @Post()
  async anchorDocument(@Body() body: unknown, @Res() res: Response): Promise<void> {
    const { documentId, version } = parseAnchorBody(body);
    const view = await this.anchors.anchorDocument(documentId, version);
    res.status(view.status === 'CONFIRMED' ? 200 : 202).json(view);
  }

  @Post('verify')
  verify(@Body() body: unknown): Promise<VerifyResult> {
    const { documentId, version, content } = parseVerifyBody(body);
    return this.anchors.verify(documentId, version, content);
  }

  @Get(':documentId/versions/:version')
  get(@Param('documentId') documentIdRaw: string, @Param('version') versionRaw: string) {
    return this.anchors.get(parseDocumentId(documentIdRaw), parseVersionParam(versionRaw));
  }
}
