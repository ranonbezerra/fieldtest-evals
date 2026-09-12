import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { AnchorService } from './anchor.service.js';

@Controller('anchor')
export class AnchorController {
  constructor(private readonly anchorService: AnchorService) {}

  @Post(':documentId/:version')
  async anchorDocument(
    @Param('documentId') documentId: string,
    @Param('version') version: string,
    @Body() content: unknown,
  ) {
    try {
      await this.anchorService.anchorDocument(
        documentId,
        parseInt(version, 10),
        content,
      );
      return { status: 'anchoring_started' };
    } catch (err) {
      if (err instanceof HttpException) {
        throw err;
      }
      throw new HttpException(
        { error: { code: 'internal_error', message: `${err}` , details: {} } },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('verify/:documentId/:version')
  async verify(
    @Param('documentId') documentId: string,
    @Param('version') version: string,
    @Body() content: unknown,
  ) {
    const result = await this.anchorService.verify(
      documentId,
      parseInt(version, 10),
      content,
    );
    return result;
  }
}
