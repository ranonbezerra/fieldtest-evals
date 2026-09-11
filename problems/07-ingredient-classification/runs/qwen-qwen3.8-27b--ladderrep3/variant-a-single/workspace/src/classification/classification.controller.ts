import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiError } from '../common/api-error.js';
import { ClassificationService, type ClassificationResultDto, type PublishResultDto } from './classification.service.js';

function requireId(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ApiError('invalid_input', `${field} must be a non-empty string.`, { field }, HttpStatus.BAD_REQUEST);
  }
  return value;
}

function optionalId(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  return requireId(value, field);
}

@Controller()
export class ClassificationController {
  constructor(private readonly service: ClassificationService) {}

  /** Classify a product against the active methodology version, optionally with a profile. */
  @Post('classifications')
  @HttpCode(HttpStatus.OK)
  classify(@Body() body: unknown): Promise<ClassificationResultDto> {
    const payload = (body ?? {}) as Record<string, unknown>;
    const productId = requireId(payload.productId, 'productId');
    const profileId = optionalId(payload.profileId, 'profileId');
    return this.service.classify(productId, profileId);
  }

  /** All stored classification results for a product, across versions and profiles. */
  @Get('products/:productId/classifications')
  storedResults(@Param('productId') productId: string) {
    return this.service.getStoredResults(productId);
  }

  /** A single stored result for (product, methodologyVersion, profile), exactly as it was. */
  @Get('products/:productId/classifications/:methodologyVersionId')
  storedResult(
    @Param('productId') productId: string,
    @Param('methodologyVersionId') methodologyVersionId: string,
    @Query('profileId') profileId?: string,
  ) {
    return this.service.getStoredResult(productId, methodologyVersionId, optionalId(profileId, 'profileId'));
  }

  /** Publish a methodology version; re-scores affected products idempotently. */
  @Post('methodology-versions/:methodologyVersionId/publish')
  @HttpCode(HttpStatus.OK)
  publish(@Param('methodologyVersionId') methodologyVersionId: string): Promise<PublishResultDto> {
    return this.service.publishMethodologyVersion(methodologyVersionId);
  }
}
