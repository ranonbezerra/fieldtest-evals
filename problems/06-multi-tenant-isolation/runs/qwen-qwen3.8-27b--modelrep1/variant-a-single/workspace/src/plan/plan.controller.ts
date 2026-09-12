import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import type { Plan } from '@prisma/client';
import { CreatePlanDto, UpdatePlanDto } from './plan.dto.js';
import { PlanService } from './plan.service.js';

@Controller('plans')
export class PlanController {
  constructor(private readonly plans: PlanService) {}

  @Post()
  create(@Body() dto: CreatePlanDto): Promise<Plan> {
    return this.plans.create(dto);
  }

  @Get()
  list(): Promise<Plan[]> {
    return this.plans.list();
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string): Promise<Plan> {
    return this.plans.get(id);
  }

  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdatePlanDto): Promise<Plan> {
    return this.plans.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.plans.remove(id);
  }
}
