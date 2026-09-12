import { Body, Controller, Post } from '@nestjs/common';
import { ClassificationService } from './classification.service';
import { ClassifyDto } from './dto/classify.dto';
import { ClassificationResult } from './dto/classification-result.dto';

@Controller('classifications')
export class ClassificationController {
  constructor(private readonly classificationService: ClassificationService) {}

  @Post()
  async classify(@Body() dto: ClassifyDto): Promise<ClassificationResult> {
    return this.classificationService.classify(dto.productId, dto.profileId);
  }
}
