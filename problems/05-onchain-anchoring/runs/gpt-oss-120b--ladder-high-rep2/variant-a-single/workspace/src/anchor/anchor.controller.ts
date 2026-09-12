import { Controller, Post, Param, Body, HttpException, HttpStatus } from '@nestjs/common';
import { AnchorService } from './anchor.service.js';

@Controller('anchors')
export class AnchorController {
  constructor(private readonly anchorService: AnchorService) {}

  @Post(':documentId/:version')
  async anchor(@Param('documentId') documentId: string, @Param('version') versionStr: string) {
    const version = parseInt(versionStr, 10);
    if (isNaN(version)) {
      throw new HttpException(
        { error: { code: 'invalid_input', message: 'Version must be an integer', details: {} } },
        HttpStatus.BAD_REQUEST,
      );
    }
    return this.anchorService.anchorDocument(documentId, version);
  }

  @Post(':documentId/:version/verify')
  async verify(
    @Param('documentId') documentId: string,
    @Param('version') versionStr: string,
    @Body('content') content: any,
  ) {
    const version = parseInt(versionStr, 10);
    if (isNaN(version)) {
      throw new HttpException(
        { error: { code: 'invalid_input', message: 'Version must be an integer', details: {} } },
        HttpStatus.BAD_REQUEST,
      );
    }
    if (content === undefined) {
      throw new HttpException(
        { error: { code: 'invalid_input', message: 'Missing content in request body', details: {} } },
        HttpStatus.BAD_REQUEST,
      );
    }
    return this.anchorService.verify(documentId, version, content);
  }
}
