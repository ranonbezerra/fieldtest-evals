import { Body, Controller, Get, HttpCode, Inject, Param, Post } from '@nestjs/common';
import { ApiError } from '../common/api-error.js';
import { readObject, requireString } from '../common/body.js';
import { isSeverity } from '../common/severity.js';
import { MethodologyService, type NewMethodologyRule } from './methodology.service.js';

@Controller('methodology-versions')
export class MethodologyController {
  constructor(@Inject(MethodologyService) private readonly methodologies: MethodologyService) {}

  @Get()
  list() {
    return this.methodologies.list();
  }

  @Post()
  create(@Body() body: unknown) {
    const payload = readObject(body);
    const label = requireString(payload, 'label');
    const rules = parseRules(payload);
    return this.methodologies.create(label, rules);
  }

  @Post(':id/publish')
  @HttpCode(200)
  publish(@Param('id') id: string) {
    return this.methodologies.publish(id);
  }

  @Post(':id/rescore')
  @HttpCode(200)
  rescore(@Param('id') id: string) {
    return this.methodologies.rescore(id);
  }
}

function parseRules(payload: Record<string, unknown>): NewMethodologyRule[] {
  const rawRules = payload.rules;
  if (!Array.isArray(rawRules)) {
    throw new ApiError(400, 'validation_error', 'rules must be an array of { ingredientId, severity, source }.', { field: 'rules' });
  }
  return rawRules.map((rawRule, index) => {
    const field = `rules[${index}]`;
    if (typeof rawRule !== 'object' || rawRule === null) {
      throw new ApiError(400, 'validation_error', `${field} must be an object.`, { field });
    }
    const rule = rawRule as Record<string, unknown>;
    const ingredientId = typeof rule.ingredientId === 'string' && rule.ingredientId.trim().length > 0 ? rule.ingredientId.trim() : null;
    const source = typeof rule.source === 'string' && rule.source.trim().length > 0 ? rule.source.trim() : null;
    const severity = rule.severity;
    if (!ingredientId || !source || !isSeverity(severity)) {
      throw new ApiError(
        400,
        'validation_error',
        `${field} must carry a non-empty ingredientId, a severity of banned|restricted|watch and a non-empty source citation.`,
        { field },
      );
    }
    return { ingredientId, severity, source };
  });
}
