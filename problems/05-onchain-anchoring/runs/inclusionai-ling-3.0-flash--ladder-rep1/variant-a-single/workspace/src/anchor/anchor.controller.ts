import { Controller, Post, Get, Param, Body, HttpException } from '@nestjs/common';
import { AnchorService } from './anchor.service.js';
import type { AnchorRecord, VerifyResult } from './anchor.types.js';

@Controller('anchor')
export class AnchorController {
  constructor(private readonly anchorService: AnchorService) {}

  @Post()
  async anchorDocument(@Body() body: { documentId: string; version: string; content: Record<string, unknown> }): Promise<AnchorRecord> {
    try {
      return await this.anchorService.anchorDocument(body.documentId, body.version, body.content);
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new HttpException(
        { error: { code: 'internal_error', message: (error as Error).message, details: {} } },
        500,
      );
    }
  }

  @Get(':documentId/version/:version/verify')
  async verify(@Param('documentId') documentId: string, @Param('version') version: string, @Body() body: { content: Record<string, unknown> }): Promise<VerifyResult> {
    try {
      return await this.anchorService.verify(documentId, version, body.content);
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new HttpException(
        { error: { code: 'internal_error', message: (error as Error).message, details: {} } },
        500,
      );
    }
  }

  @Get(':documentId/version/:version')
  async getAnchor(@Param('documentId') documentId: string, @Param('version') version: string): Promise<AnchorRecord | null> {
    return this.anchorService.getAnchor(documentId, version);
  }
}
