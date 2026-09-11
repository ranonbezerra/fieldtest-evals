import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { Errors } from '../common/api-error.js';
import { ClassificationService } from './classification.service.js';
import { PROFILE_CONTEXTS } from './fixtures.js';
import type { MethodologyFixture } from './fixtures.js';

const SEVERITIES: readonly string[] = ['banned', 'restricted', 'watch'];

function asNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw Errors.invalidInput(`${field} must be a non-empty string.`, { field });
  }
  return value;
}

function asObject(body: unknown): Record<string, unknown> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw Errors.invalidInput('Request body must be a JSON object.', {});
  }
  return body as Record<string, unknown>;
}

function assertProductInput(body: unknown): { name: string; brand: string | null; ingredients: string[] } {
  const b = asObject(body);
  const name = asNonEmptyString(b.name, 'name');
  let brand: string | null = null;
  if (b.brand !== undefined && b.brand !== null) {
    brand = asNonEmptyString(b.brand, 'brand');
  }
  if (!Array.isArray(b.ingredients)) {
    throw Errors.invalidInput('ingredients must be an array of INCI strings.', { field: 'ingredients' });
  }
  const ingredients = b.ingredients.map((value, index) => asNonEmptyString(value, `ingredients[${index}]`));
  return { name, brand, ingredients };
}

function assertProfileInput(body: unknown): { name: string; contexts: string[] } {
  const b = asObject(body);
  const name = asNonEmptyString(b.name, 'name');
  let contexts: string[] = [];
  if (b.contexts !== undefined && b.contexts !== null) {
    if (!Array.isArray(b.contexts)) {
      throw Errors.invalidInput('contexts must be an array of profile contexts.', { field: 'contexts' });
    }
    contexts = b.contexts.map((value, index) => asNonEmptyString(value, `contexts[${index}]`));
    for (const context of contexts) {
      if (!PROFILE_CONTEXTS.includes(context)) {
        throw Errors.invalidInput(`Unknown profile context '${context}'. Allowed: ${PROFILE_CONTEXTS.join(', ')}.`, {
          field: 'contexts',
          context,
        });
      }
    }
  }
  return { name, contexts };
}

function assertMethodologyFixture(body: unknown): MethodologyFixture {
  const b = asObject(body);
  const slug = asNonEmptyString(b.slug, 'slug');
  const name = asNonEmptyString(b.name, 'name');
  if (!Array.isArray(b.rules) || b.rules.length === 0) {
    throw Errors.invalidInput('rules must be a non-empty array.', { field: 'rules' });
  }
  const rules = b.rules.map((value, index) => {
    const field = `rules[${index}]`;
    const r = asObject(value);
    const ingredient = asNonEmptyString(r.ingredient, `${field}.ingredient`);
    const kind = r.kind;
    if (kind !== 'base' && kind !== 'context') {
      throw Errors.invalidInput(`${field}.kind must be 'base' or 'context'.`, { field });
    }
    const severity = asNonEmptyString(r.severity, `${field}.severity`);
    if (!SEVERITIES.includes(severity)) {
      throw Errors.invalidInput(`${field}.severity must be one of ${SEVERITIES.join(', ')}.`, { field });
    }
    const source = asNonEmptyString(r.source, `${field}.source`);
    if (kind === 'base') {
      if (r.context !== undefined) {
        throw Errors.invalidInput(`${field}.context is only allowed on context rules.`, { field });
      }
      return { ingredient, kind: 'base' as const, severity: severity as 'banned' | 'restricted' | 'watch', source };
    }
    const context = asNonEmptyString(r.context, `${field}.context`);
    if (!PROFILE_CONTEXTS.includes(context)) {
      throw Errors.invalidInput(`Unknown context '${context}'. Allowed: ${PROFILE_CONTEXTS.join(', ')}.`, { field });
    }
    return {
      ingredient,
      kind: 'context' as const,
      context,
      severity: severity as 'banned' | 'restricted' | 'watch',
      source,
    };
  });
  return { slug, name, rules };
}

@Controller()
export class ClassificationController {
  constructor(private readonly classificationService: ClassificationService) {}

  @Post('products')
  createProduct(@Body() body: unknown) {
    const { name, brand, ingredients } = assertProductInput(body);
    return this.classificationService.createProduct(name, brand, ingredients);
  }

  @Get('products/:productId/classification')
  classify(@Param('productId') productId: string, @Query('profileId') profileId?: string) {
    return this.classificationService.classify(productId, profileId || undefined);
  }

  @Get('products/:productId/classification-results')
  getStoredResult(
    @Param('productId') productId: string,
    @Query('methodologyVersionId') methodologyVersionId?: string,
  ) {
    if (!methodologyVersionId) {
      throw Errors.invalidInput('methodologyVersionId query parameter is required.', {
        field: 'methodologyVersionId',
      });
    }
    return this.classificationService.getStoredResult(productId, methodologyVersionId);
  }

  @Post('profiles')
  createProfile(@Body() body: unknown) {
    const { name, contexts } = assertProfileInput(body);
    return this.classificationService.createProfile(name, contexts);
  }

  @Get('methodology-versions')
  listMethodologyVersions() {
    return this.classificationService.listVersions();
  }

  @Post('methodology-versions')
  ingestMethodology(@Body() body: unknown) {
    return this.classificationService.ingestMethodology(assertMethodologyFixture(body));
  }

  @Post('methodology-versions/:versionId/publish')
  publishMethodology(@Param('versionId') versionId: string) {
    return this.classificationService.publish(versionId);
  }

  @Post('methodology-versions/:versionId/rescore')
  rescoreMethodology(@Param('versionId') versionId: string) {
    return this.classificationService.rescore(versionId);
  }
}
