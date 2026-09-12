import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import type { Plan } from '@prisma/client';
import { bodyOf, optionalString, requireNonNegativeInt, requireString } from '../common/validators.js';
import { PlanService } from './plan.service.js';

@Controller('plans')
export class PlanController {
  constructor(private readonly plans: PlanService) {}

  @Get()
  list(): Promise<Plan[]> {
    return this.plans.list();
  }

  @Get(':id')
  getById(@Param('id') id: string): Promise<Plan> {
    return this.plans.get(id);
  }

  @Post()
  create(@Body() rawBody: unknown): Promise<Plan> {
    const body = bodyOf(rawBody);
    const name = requireString(body, 'name', { max: 200 });
    const priceCents = requireNonNegativeInt(body, 'priceCents');
    const currency = optionalString(body, 'currency', { max: 8 });
    return this.plans.create({ name, priceCents, currency });
  }
}
