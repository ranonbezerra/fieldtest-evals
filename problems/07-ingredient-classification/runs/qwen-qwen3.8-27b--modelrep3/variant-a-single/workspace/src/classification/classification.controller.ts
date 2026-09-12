import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { AppException } from '../common/app.exception.js';
import { ClassificationService } from './classification.service.js';

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

@Controller()
export class ClassificationController {
  constructor(private readonly classifications: ClassificationService) {}

  @Post('products/:productId/classifications')
  async classify(
    @Param('productId') productId: string,
    @Body() body: { profileId?: string } | undefined,
  ) {
    if (!isNonEmptyString(productId)) {
      throw new AppException(400, 'invalid_input', 'productId must be a non-empty string.', { productId });
    }

    const profileId = body?.profileId;
    if (profileId !== undefined && !isNonEmptyString(profileId)) {
      throw new AppException(400, 'invalid_input', 'profileId must be a non-empty string when provided.', {
        profileId,
      });
    }

    return this.classifications.classify(productId, profileId);
  }

  @Get('products/:productId/classifications')
  async getClassification(
    @Param('productId') productId: string,
    @Query('methodologyVersionId') methodologyVersionId?: string,
    @Query('profileId') profileId?: string,
  ) {
    if (!isNonEmptyString(productId) || !isNonEmptyString(methodologyVersionId)) {
      throw new AppException(
        400,
        'invalid_input',
        'productId and methodologyVersionId are required non-empty strings.',
        { productId, methodologyVersionId },
      );
    }

    if (profileId !== undefined && !isNonEmptyString(profileId)) {
      throw new AppException(400, 'invalid_input', 'profileId must be a non-empty string when provided.', {
        profileId,
      });
    }

    return this.classifications.getClassification(productId, methodologyVersionId, profileId);
  }

  @Post('methodology-versions/:versionId/publish')
  async publish(@Param('versionId') versionId: string) {
    if (!isNonEmptyString(versionId)) {
      throw new AppException(400, 'invalid_input', 'versionId must be a non-empty string.', { versionId });
    }

    return this.classifications.publishMethodologyVersion(versionId);
  }
}
