import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { AnchoringService } from './anchoring.service.js';
import { AnchorDto, VerifyAnchorDto, toAnchorResponse, toVerifyResponse } from './anchor.dto.js';

@Controller('anchors')
export class AnchoringController {
  constructor(private readonly anchoring: AnchoringService) {}

  /**
   * Anchor one published report version. 202: confirmation is asynchronous
   * and always comes from a chain receipt, never from this response.
   */
  @Post()
  @HttpCode(202)
  async anchor(@Body() dto: AnchorDto) {
    const anchor = await this.anchoring.anchorDocument(dto.documentId, dto.version, dto.content);
    return toAnchorResponse(anchor);
  }

  /**
   * Recompute the hash of the supplied content and return the anchoring
   * proof (txId, block) or a mismatch report.
   */
  @Post('verify')
  @HttpCode(200)
  async verify(@Body() dto: VerifyAnchorDto) {
    const report = await this.anchoring.verify(dto.documentId, dto.version, dto.content);
    return toVerifyResponse(report);
  }
}
