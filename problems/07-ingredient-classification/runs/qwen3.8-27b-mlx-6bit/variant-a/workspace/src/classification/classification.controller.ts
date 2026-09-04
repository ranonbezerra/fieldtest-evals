import { Controller, Post, Body } from '@nestjs/common';
import { ClassificationService } from './classification.service.js';

@Controller()
export class ClassificationController {
  constructor(private readonly classificationService: ClassificationService) {}

  @Post('classify')
  async classify(@Body() body: { productId: number; profileId?: number }) {
    return this.classificationService.classify(body.productId, body.profileId);
  }
}
