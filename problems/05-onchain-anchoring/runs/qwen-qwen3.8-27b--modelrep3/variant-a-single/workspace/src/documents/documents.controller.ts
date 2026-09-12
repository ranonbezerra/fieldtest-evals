import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ApiError } from '../common/api-error.js';
import { DocumentsService } from './documents.service.js';

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

@Controller('documents')
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Post(':documentId/versions')
  create(@Param('documentId') documentIdRaw: string, @Body() body: unknown) {
    const documentId = parseDocumentId(documentIdRaw);
    if (typeof body !== 'object' || body === null) {
      throw new ApiError('validation_failed', 400, 'body must be an object');
    }
    const { version, content } = body as Record<string, unknown>;
    const parsedVersion = typeof version === 'string' ? Number(version) : version;
    if (typeof parsedVersion !== 'number' || !Number.isInteger(parsedVersion) || parsedVersion < 1) {
      throw new ApiError('validation_failed', 400, 'version must be a positive integer', { field: 'version' });
    }
    if (content === null || typeof content !== 'object') {
      throw new ApiError('validation_failed', 400, 'content must be a JSON object or array', { field: 'content' });
    }
    return this.documents.createVersion(documentId, parsedVersion, content as Prisma.InputJsonValue);
  }

  @Get(':documentId/versions/:version')
  get(@Param('documentId') documentIdRaw: string, @Param('version') versionRaw: string) {
    return this.documents.getVersion(parseDocumentId(documentIdRaw), parseVersionParam(versionRaw));
  }
}
