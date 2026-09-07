// src/plan/plan.controller.ts

import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  NotFoundException,
} from '@nestjs/common';

// ASSUMPTION: The following modules exist in the project.
// If they are located elsewhere, adjust the import paths accordingly.
import { PlanService } from './plan.service';
import {
  CreatePlanDto,
  UpdatePlanDto,
} from './plan.dto';

@Controller('plans')
export class PlanController {
  constructor(private readonly planService: PlanService) {}

  @Get()
  async findAll() {
    // Returns an array of plans for the resolved tenant.
    return this.planService.findAll();
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    const plan = await this.planService.findOne(id);
    if (!plan) {
      throw new NotFoundException(`Plan with id ${id} not found`);
    }
    return plan;
  }

  @Post()
  async create(@Body() createDto: CreatePlanDto) {
    // The service will handle tenant scoping via the tenant‑aware Prisma client.
    return this.planService.create(createDto);
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() updateDto: UpdatePlanDto,
  ) {
    const updated = await this.planService.update(id, updateDto);
    if (!updated) {
      throw new NotFoundException(`Plan with id ${id} not found`);
    }
    return updated;
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    const deleted = await this.planService.remove(id);
    if (!deleted) {
      throw new NotFoundException(`Plan with id ${id} not found`);
    }
    return { success: true };
  }
}
