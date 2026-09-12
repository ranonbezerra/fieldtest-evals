import { Controller, Post, Param, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { AnchorService } from './anchor.service.js';

@Controller('anchor')
export class AnchorController {
  constructor(private readonly anchorService: AnchorService) {}

  /**
   * POST /anchor/:documentId/:version
   * Body: { content: any }
   */
  @Post(':documentId/:version')
  async anchorDocument(
    @Param('documentId') documentId: string,
    @Param('version') version: string,
    @Body('content') content: any,
  ) {
    const versionNum = parseInt(version, 10);
    return this.anchorService.anchorDocument(documentId, versionNum, content);
  }

  /**
   * POST /anchor/:documentId/:version/verify
   * Body: { content: any }
   */
  @Post(':documentId/:version/verify')
  @HttpCode(HttpStatus.OK)
  async verify(
    @Param('documentId') documentId: string,
    @Param('version') version: string,
    @Body('content') content: any,
  ) {
    const versionNum = parseInt(version, 10);
    return this.anchorService.verify(documentId, versionNum, content);
  }
}
