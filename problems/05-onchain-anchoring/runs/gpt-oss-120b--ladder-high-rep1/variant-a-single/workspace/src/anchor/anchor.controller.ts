import { Controller, Post, Param, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { AnchorService } from './anchor.service.js';

@Controller('anchor')
export class AnchorController {
  constructor(private readonly anchorService: AnchorService) {}

  @Post(':documentId/:version')
  @HttpCode(HttpStatus.CREATED)
  async anchorDocument(
    @Param('documentId') documentId: string,
    @Param('version') version: string,
    @Body() body: { content: any },
  ) {
    const result = await this.anchorService.anchorDocument(documentId, Number(version), body.content);
    return result;
  }

  @Post(':documentId/:version/verify')
  @HttpCode(HttpStatus.OK)
  async verify(
    @Param('documentId') documentId: string,
    @Param('version') version: string,
    @Body() body: { content: any },
  ) {
    const result = await this.anchorService.verify(documentId, Number(version), body.content);
    return result;
  }
}
