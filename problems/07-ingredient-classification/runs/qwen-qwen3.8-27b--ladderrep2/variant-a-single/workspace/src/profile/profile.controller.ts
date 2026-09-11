import { Body, Controller, Get, Inject, Param, Post } from '@nestjs/common';
import { ApiError } from '../common/api-error.js';
import { readObject, requireString } from '../common/body.js';
import { isSeverity } from '../common/severity.js';
import { ProfileService, type NewProfileModifierInput } from './profile.service.js';

@Controller('profiles')
export class ProfileController {
  constructor(@Inject(ProfileService) private readonly profiles: ProfileService) {}

  @Get()
  list() {
    return this.profiles.list();
  }

  @Post()
  create(@Body() body: unknown) {
    const payload = readObject(body);
    const name = requireString(payload, 'name');
    const modifiers = parseModifiers(payload);
    return this.profiles.create(name, modifiers);
  }

  @Get(':id')
  getById(@Param('id') id: string) {
    return this.profiles.findById(id);
  }
}

function parseModifiers(payload: Record<string, unknown>): NewProfileModifierInput[] {
  const rawModifiers = payload.modifiers;
  if (!Array.isArray(rawModifiers)) {
    throw new ApiError(400, 'validation_error', 'modifiers must be an array of { ingredientId, severity, reason }.', { field: 'modifiers' });
  }
  return rawModifiers.map((rawModifier, index) => {
    const field = `modifiers[${index}]`;
    if (typeof rawModifier !== 'object' || rawModifier === null) {
      throw new ApiError(400, 'validation_error', `${field} must be an object.`, { field });
    }
    const modifier = rawModifier as Record<string, unknown>;
    const ingredientId =
      typeof modifier.ingredientId === 'string' && modifier.ingredientId.trim().length > 0 ? modifier.ingredientId.trim() : null;
    const reason = typeof modifier.reason === 'string' && modifier.reason.trim().length > 0 ? modifier.reason.trim() : null;
    const severity = modifier.severity;
    if (!ingredientId || !reason || !isSeverity(severity)) {
      throw new ApiError(
        400,
        'validation_error',
        `${field} must carry a non-empty ingredientId, a severity of banned|restricted|watch and a non-empty reason.`,
        { field },
      );
    }
    return { ingredientId, severity, reason };
  });
}
