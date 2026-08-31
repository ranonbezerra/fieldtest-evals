import { BadRequestException, Body, Controller, Param, Post } from '@nestjs/common';
import type { AnchorProof, VerifyResult } from './anchor.service';
import { AnchorService } from './anchor.service';

@Controller('anchors')
export class AnchorController {
  constructor(private readonly anchorService: AnchorService) {}

  @Post(':documentId/:version/anchor')
  async anchor(
    @Param() params: { documentId: string; version: string },
    @Body() body: { content: unknown },
  ): Promise<AnchorProof> {
    const documentId = this.requireDocumentId(params.documentId);
    const version = this.requireVersion(params.version);
    const content = this.requireContent(body);
    return this.anchorService.anchorDocument(documentId, version, content);
  }

  @Post(':documentId/:version/verify')
  async verify(
    @Param() params: { documentId: string; version: string },
    @Body() body: { content: unknown },
  ): Promise<VerifyResult> {
    const documentId = this.requireDocumentId(params.documentId);
    const version = this.requireVersion(params.version);
    const content = this.requireContent(body);
    return this.anchorService.verify(documentId, version, content);
  }

  private requireDocumentId(documentId: string): string {
    if (typeof documentId !== 'string' || documentId.length === 0) {
      throw new BadRequestException('documentId must be a non-empty string');
    }
    return documentId;
  }

  private requireVersion(raw: string): number {
    const version = Number(raw);
    if (!Number.isInteger(version)) {
      throw new BadRequestException(`version must be an integer, received "${raw}"`);
    }
    return version;
  }

  private requireContent(body: unknown): unknown {
    if (typeof body !== 'object' || body === null || !('content' in body)) {
      throw new BadRequestException('request body must be an object with a "content" field');
    }
    return (body as { content: unknown }).content;
  }
}
