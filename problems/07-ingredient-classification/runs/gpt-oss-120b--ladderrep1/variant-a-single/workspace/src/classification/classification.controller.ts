import {
  Controller,
  Get,
  Param,
  Query,
  ParseIntPipe,
  NotFoundException,
} from '@nestjs/common';
import { ClassificationService } from './classification.service';
import { ClassifyQueryDto } from './dto/classify-query.dto';
import { ClassificationResult } from '@prisma/client';

@Controller('classifications')
export class ClassificationController {
  constructor(private readonly classificationService: ClassificationService) {}

  @Get(':productId')
  async getClassification(
    @Param('productId', ParseIntPipe) productId: number,
    @Query() query: ClassifyQueryDto,
  ): Promise<ClassificationResult> {
    const version = await this.classificationService.getActiveMethodologyVersion();
    const result = await this.classificationService.getStoredResult(productId, version.id);
    if (!result) {
      throw new NotFoundException('Classification result not found');
    }
    return result;
  }

  @Get('classify/:productId')
  async classify(
    @Param('productId', ParseIntPipe) productId: number,
    @Query() query: ClassifyQueryDto,
  ) {
    const profileId = query.profileId ? parseInt(query.profileId, 10) : undefined;
    return this.classificationService.classify(productId, profileId);
  }

  @Get('rescore')
  async rescoreAll() {
    await this.classificationService.rescoreAll();
    return { status: 'ok' };
  }
}
