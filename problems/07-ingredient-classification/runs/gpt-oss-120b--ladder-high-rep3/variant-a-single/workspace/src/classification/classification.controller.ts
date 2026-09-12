import { Controller, Post, Body } from '@nestjs/common';
import { ClassificationService } from './classification.service.js';
import { ClassifyDto } from './dto/classify.dto.js';
import { ClassificationResultDto } from './dto/classification-result.dto.js';

@Controller('classification')
export class ClassificationController {
  constructor(private readonly classificationService: ClassificationService) {}

  @Post('classify')
  async classify(@Body() dto: ClassifyDto): Promise<ClassificationResultDto> {
    return this.classificationService.classify(dto.productId, dto.profileId);
  }
}
