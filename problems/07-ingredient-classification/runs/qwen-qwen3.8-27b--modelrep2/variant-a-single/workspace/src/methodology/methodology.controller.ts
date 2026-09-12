import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import type { Severity } from '@prisma/client';
import { InvalidInputException } from '../common/exceptions.js';
import { assertNonEmptyString, assertObject, assertSeverity, assertUuid } from '../common/validate.js';
import type { RuleInput } from './methodology.repository.js';
import { MethodologyService } from './methodology.service.js';

@Controller('methodologies')
export class MethodologyController {
  constructor(private readonly methodologies: MethodologyService) {}

  @Get()
  list() {
    return this.methodologies.list();
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.methodologies.get(assertUuid(id, 'id'));
  }

  @Post()
  create(@Body() body: unknown) {
    const payload = assertObject(body, 'body');
    const label = assertNonEmptyString(payload['label'], 'label');
    return this.methodologies.create({ label, rules: parseRuleList(payload['rules']) });
  }

  @Post(':id/publish')
  publish(@Param('id') id: string) {
    return this.methodologies.publish(assertUuid(id, 'id'));
  }
}

function parseRuleList(value: unknown): RuleInput[] {
  if (!Array.isArray(value)) {
    throw new InvalidInputException('Field "rules" must be an array.', { field: 'rules' });
  }
  const seen = new Set<string>();
  return value.map((entry, index) => {
    const rule = assertObject(entry, `rules[${index}]`);
    const ingredientId = assertUuid(rule['ingredientId'], `rules[${index}].ingredientId`);
    const severity: Severity = assertSeverity(rule['severity'], `rules[${index}].severity`);
    const sourceCitation = assertNonEmptyString(
      rule['sourceCitation'],
      `rules[${index}].sourceCitation`,
    );
    if (seen.has(ingredientId)) {
      throw new InvalidInputException(`Duplicate rule for ingredient "${ingredientId}".`, {
        ingredientId,
      });
    }
    seen.add(ingredientId);
    return { ingredientId, severity, sourceCitation };
  });
}
