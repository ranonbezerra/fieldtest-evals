import { Controller, Post, Param, Body } from '@nestjs/common';
import { AnchorService } from './anchor.service.js';
import { AnchorWorker } from './anchor.worker.js';
import { AnchorRecovery } from './anchor.recovery.js';

@Controller('anchor')
export class AnchorController {
  constructor(
    private readonly anchorService: AnchorService,
    private readonly anchorWorker: AnchorWorker,
    private readonly anchorRecovery: AnchorRecovery,
  ) {}

  @Post('documents/:documentId/versions/:version/anchor')
  async anchorDocument(@Param('documentId') documentId: string, @Param('version') version: string) {
    return this.anchorService.anchorDocument(documentId, version);
  }

  @Post('documents/:documentId/versions/:version/verify')
  async verify(
    @Param('documentId') documentId: string,
    @Param('version') version: string,
    @Body() body: { content: unknown },
  ) {
    return this.anchorService.verify(documentId, version, body.content);
  }

  @Post('recovery-sweep')
  async recoverySweep() {
    const recovered = await this.anchorRecovery.recoverStuck();
    return { recovered };
  }

  @Post('confirm')
  async confirm() {
    const confirmed = await this.anchorWorker.confirmPending();
    return { confirmed };
  }
}
