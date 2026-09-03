import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
} from '@nestjs/common';
import { PlanService } from './plan.service.js';
import { CreatePlanInput, UpdatePlanInput, Plan } from './dto.js';

@Controller('plans')
export class PlanController {
  constructor(private readonly planService: PlanService) {}

  @Get()
  async list(): Promise<Plan[]> {
    return this.planService.list();
  }

  @Get(':id')
  async getById(@Param('id') id: string): Promise<Plan> {
    return this.planService.findById(id);
  }

  @Post()
  async create(@Body() input: CreatePlanInput): Promise<Plan> {
    return this.planService.create(input);
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() input: UpdatePlanInput,
  ): Promise<Plan> {
    return this.planService.update(id, input);
  }

  @Delete(':id')
  async remove(@Param('id') id: string): Promise<void> {
    await this.planService.delete(id);
  }
}
