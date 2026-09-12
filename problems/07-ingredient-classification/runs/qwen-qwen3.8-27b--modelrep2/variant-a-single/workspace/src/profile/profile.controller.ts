import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import type { Severity } from '@prisma/client';
import { InvalidInputException } from '../common/exceptions.js';
import { assertNonEmptyString, assertObject, assertSeverity, assertUuid } from '../common/validate.js';
import type { ModifierInput } from './profile.repository.js';
import { ProfileService } from './profile.service.js';

@Controller('profiles')
export class ProfileController {
  constructor(private readonly profiles: ProfileService) {}

  @Get()
  list() {
    return this.profiles.list();
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.profiles.get(assertUuid(id, 'id'));
  }

  @Post()
  create(@Body() body: unknown) {
    const payload = assertObject(body, 'body');
    const name = assertNonEmptyString(payload['name'], 'name');
    let description: string | undefined;
    if (payload['description'] !== undefined) {
      description = assertNonEmptyString(payload['description'], 'description');
    }
    return this.profiles.create({
      name,
      description,
      modifiers: parseModifierList(payload['modifiers']),
    });
  }
}

function parseModifierList(value: unknown): ModifierInput[] {
  if (!Array.isArray(value)) {
    throw new InvalidInputException('Field "modifiers" must be an array.', { field: 'modifiers' });
  }
  const seen = new Set<string>();
  return value.map((entry, index) => {
    const modifier = assertObject(entry, `modifiers[${index}]`);
    const ingredientId = assertUuid(modifier['ingredientId'], `modifiers[${index}].ingredientId`);
    const severity: Severity = assertSeverity(modifier['severity'], `modifiers[${index}].severity`);
    const citation = assertNonEmptyString(modifier['citation'], `modifiers[${index}].citation`);
    if (seen.has(ingredientId)) {
      throw new InvalidInputException(`Duplicate modifier for ingredient "${ingredientId}".`, {
        ingredientId,
      });
    }
    seen.add(ingredientId);
    return { ingredientId, severity, citation };
  });
}
