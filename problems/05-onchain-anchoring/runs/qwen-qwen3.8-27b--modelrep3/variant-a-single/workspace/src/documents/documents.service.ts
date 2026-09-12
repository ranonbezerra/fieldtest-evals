import { Injectable } from '@nestjs/common';
import { Prisma, ReportVersion } from '@prisma/client';
import { ApiError } from '../common/api-error.js';
import { DocumentsRepository } from './documents.repository.js';

@Injectable()
export class DocumentsService {
  constructor(private readonly documents: DocumentsRepository) {}

  /** Store structured content for a report version. Versions are immutable. */
  async createVersion(documentId: string, version: number, content: Prisma.InputJsonValue): Promise<ReportVersion> {
    const created = await this.documents.createVersion(documentId, version, content);
    if (!created) {
      throw new ApiError(
        'document_version_exists',
        409,
        `version ${version} of document ${documentId} already exists; report versions are immutable`,
        { documentId, version },
      );
    }
    return created;
  }

  async getVersion(documentId: string, version: number): Promise<ReportVersion> {
    const found = await this.documents.findVersion(documentId, version);
    if (!found) {
      throw new ApiError('resource_not_found', 404, `version ${version} of document ${documentId} does not exist`, {
        documentId,
        version,
      });
    }
    return found;
  }
}
