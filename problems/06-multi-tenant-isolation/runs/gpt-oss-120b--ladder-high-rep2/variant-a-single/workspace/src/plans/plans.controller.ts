import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Patch,
  Delete,
  NotFoundException,
} from '@nestjs/common';
import { PlansService } from './plans.service.js';
import { CreatePlanDto } from './dto/create-plan.dto.js';
import { UpdatePlanDto } from './dto/update-plan.dto.js';

@Controller('plans')
export class PlansController {
  constructor(private readonly plansService: PlansService) {}

  @Post()
  async create(@Body() createDto: CreatePlanDto) {
    return this.plansService.create(createDto);
  }

  @Get()
  async findAll() {
    return this.plansService.findAll();
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    const plan = await this.plansService.findOne(id);
    if (!plan) {
      throw new NotFoundException('Plan not found');
    }
    return plan;
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() updateDto: UpdatePlanDto) {
    const updated = await this.plansService.update(id, updateDto);
    if (!updated) {
      throw new NotFoundException('Plan not found');
    }
    return updated;
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    const deleted = await this.plansService.remove(id);
    if (!deleted) {
      throw new NotFoundException('Plan not found');
    }
    return deleted;
  }
}
