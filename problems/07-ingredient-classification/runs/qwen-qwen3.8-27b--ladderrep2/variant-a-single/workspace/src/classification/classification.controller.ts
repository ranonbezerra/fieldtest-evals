import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query } from '@nestjs/common';
import { ApiError } from '../common/api-error.js';
import { ClassificationService } from './classification.service.js';

@Controller()
export class ClassificationController {
  constructor(@Inject(ClassificationService) private readonly classifications: ClassificationService) {}

  /**
   * Classifies the product under the active methodology version.
   * Body (optional): { "profileId": "<profile-id>" }.
   */
  @Post('products/:productId/classifications')
  @HttpCode(200)
  classify(@Param('productId') productId: string, @Body() body: unknown) {
    let profileId: string | undefined;
    if (body !== undefined && body !== null) {
      if (typeof body !== 'object' || Array.isArray(body)) {
        throw new ApiError(400, 'validation_error', 'Body must be a JSON object or empty.', { field: 'body' });
      }
      const raw = (body as Record<string, unknown>).profileId;
      if (raw !== undefined) {
        if (typeof raw !== 'string' || raw.trim().length === 0) {
          throw new ApiError(400, 'validation_error', 'profileId must be a non-empty string.', { field: 'profileId' });
        }
        profileId = raw.trim();
      }
    }
    return this.classifications.classify(productId, profileId);
  }

  /**
   * Stored results, keyed by (product, methodology version) and retrievable as
   * they were. Query: productId (required); methodologyVersionId (optional —
   * defaults to the active version).
   */
  @Get('classifications')
  stored(@Query('productId') productId: string | undefined, @Query('methodologyVersionId') methodologyVersionId: string | undefined) {
    if (!productId || productId.trim().length === 0) {
      throw new ApiError(400, 'validation_error', 'productId query parameter is required.', { field: 'productId' });
    }
    return this.classifications.savedResult(productId.trim(), methodologyVersionId?.trim() || undefined);
  }
}
