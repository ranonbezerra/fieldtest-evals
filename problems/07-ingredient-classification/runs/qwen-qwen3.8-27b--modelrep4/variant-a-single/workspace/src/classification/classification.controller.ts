import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { BadRequestError } from '../common/api-error.filter.js';
import { ClassificationService } from './classification.service.js';
import type { RuleDraft } from './classification.service.js';

const SEVERITIES: readonly RuleDraft['severity'][] = ['watch', 'restricted', 'banned'];

@Controller()
export class ClassificationController {
  constructor(readonly service: ClassificationService) {}

  @Post('products')
  createProduct(@Body() body: unknown) {
    const data = objectBody(body);
    const name = nonEmptyString(data, 'name');
    const ingredients = stringArray(data, 'ingredients');
    return this.service.createProduct(name, ingredients);
  }

  @Post('classifications')
  classify(@Body() body: unknown) {
    const data = objectBody(body);
    const productId = nonEmptyString(data, 'product_id');
    const profileId = optionalNonEmptyString(data, 'profile_id');
    return this.service.classify(productId, profileId);
  }

  @Get('classifications')
  listClassifications(@Query('product_id') productId?: string, @Query('methodology_version_id') methodologyVersionId?: string) {
    const requiredProductId = nonEmptyString({ product_id: productId }, 'product_id');
    const versionId = optionalNonEmptyString({ methodology_version_id: methodologyVersionId }, 'methodology_version_id');
    return this.service.listStoredResults(requiredProductId, versionId);
  }

  @Post('methodology-versions')
  publishMethodologyVersion(@Body() body: unknown) {
    const data = objectBody(body);
    const code = nonEmptyString(data, 'code');
    const rulesRaw = array(data, 'rules');
    const rules: RuleDraft[] = rulesRaw.map((entry, position) => {
      if (typeof entry !== 'object' || entry === null) {
        throw new BadRequestError('invalid_request', `rules[${position}] must be an object.`, {
          field: `rules[${position}]`,
        });
      }
      const rule = entry as Record<string, unknown>;
      const ingredient = nonEmptyString(rule, 'ingredient');
      const severity = rule.severity;
      if (typeof severity !== 'string' || !SEVERITIES.includes(severity as RuleDraft['severity'])) {
        throw new BadRequestError(
          'invalid_severity',
          `rules[${position}].severity must be one of: ${SEVERITIES.join(', ')}.`,
          { field: `rules[${position}].severity` },
        );
      }
      const source = nonEmptyString(rule, 'source');
      return { ingredient, severity: severity as RuleDraft['severity'], source };
    });
    return this.service.publishVersion({ code, rules });
  }
}

function objectBody(body: unknown): Record<string, unknown> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new BadRequestError('invalid_request', 'Request body must be a JSON object.', {});
  }
  return body as Record<string, unknown>;
}

function nonEmptyString(data: Record<string, unknown>, field: string): string {
  const value = data[field];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new BadRequestError('invalid_request', `Field "${field}" must be a non-empty string.`, { field });
  }
  return value;
}

function optionalNonEmptyString(data: Record<string, unknown>, field: string): string | undefined {
  const value = data[field];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new BadRequestError('invalid_request', `Field "${field}" must be a non-empty string when provided.`, {
      field,
    });
  }
  return value;
}

function stringArray(data: Record<string, unknown>, field: string): string[] {
  const value = data[field];
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string' || entry.trim().length === 0)) {
    throw new BadRequestError('invalid_request', `Field "${field}" must be an array of non-empty strings.`, {
      field,
    });
  }
  return value;
}

function array(data: Record<string, unknown>, field: string): unknown[] {
  const value = data[field];
  if (!Array.isArray(value)) {
    throw new BadRequestError('invalid_request', `Field "${field}" must be an array.`, { field });
  }
  return value;
}
