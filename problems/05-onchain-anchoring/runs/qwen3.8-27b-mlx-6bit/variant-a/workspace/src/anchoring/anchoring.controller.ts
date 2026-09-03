import { Controller, Post, Param, Body, HttpException, HttpStatus } from '@nestjs/common';
import { AnchoringService, AnchorResult, VerifyResult } from './anchoring.service';

@Controller()
export class AnchoringController {
  constructor(private readonly service: AnchoringService) {}

  @Post('documents/:documentId/versions/:version/anchor')
  async anchor(
    @Param('documentId') documentId: string,
    @Param('version') version: string,
    @Body() body: { content?: unknown },
  ): Promise<AnchorResult> {
    const validated = this.validate(version, body?.content);
    return this.service.anchorDocument(documentId, validated.version, validated.content);
  }

  @Post('documents/:documentId/versions/:version/verify')
  async verify(
    @Param('documentId') documentId: string,
    @Param('version') version: string,
    @Body() body: { content?: unknown },
  ): Promise<VerifyResult> {
    const validated = this.validate(version, body?.content);
    return this.service.verify(documentId, validated.version, validated.content);
  }

  private validate(
    version: string,
    content: unknown,
  ): { version: number; content: Record<string, unknown> } {
    const num = Number(version);
    if (!Number.isInteger(num) || num < 1) {
      throw new HttpException(
        { error: { code: 'invalid_input', message: `version must be a positive integer, got "${version}"`, details: { version } } },
        HttpStatus.BAD_REQUEST,
      );
    }
    if (content === null || content === undefined || typeof content !== 'object' || Array.isArray(content)) {
      throw new HttpException(
        { error: { code: 'invalid_input', message: 'content must be a non-null object', details: {} } },
        HttpStatus.BAD_REQUEST,
      );
    }
    return { version: num, content: content as Record<string, unknown> };
  }
}
