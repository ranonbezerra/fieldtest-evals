# repair2-plan.controller.ts

## reasoning

```
We need to write plan.controller fixing imports. Likely need to import Controller, Get, Post, etc, and PlanService, DTOs. Since missing files, we assume they exist. Provide placeholder imports with paths. Use NestJS decorators. Provide basic CRUD methods. Ensure compile: import from '@nestjs/common', import PlanService from './plan.service', DTOs from './plan.dto'. Also use class-validator? Not needed here. Provide methods using service. Return promises. Use proper types maybe Plan from @prisma/client. But Plan not exported? Actually error shows no exported member 'Plan' in @prisma/client, maybe schema hasn't generated. We can avoid referencing Plan type. Use any. So controller methods signatures return any. Provide basic endpoints: GET /plans, GET /plans/:id, POST /plans, PATCH /plans/:id, DELETE /plans/:id. Use appropriate Nest decorators. Use DTO classes CreatePlanDto, UpdatePlanDto assumed. Provide import placeholders. Ensure no missing modules. Also need to import Request from 'express'? Not needed. Provide class with @Controller('plans'). Use constructor injection private readonly planService: PlanService. Methods call this.planService.xxx.

Write file.
```

## reply

```ts
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
```
