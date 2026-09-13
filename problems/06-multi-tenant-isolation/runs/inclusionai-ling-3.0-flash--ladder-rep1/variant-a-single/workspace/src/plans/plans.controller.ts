import { Controller, Get, Post, Put, Delete, Param, Body } from '@nestjs/common';
import { PlansService } from './plans.service.js';
import { CreatePlanDto, UpdatePlanDto } from './plans.dto.js';

@Controller('plans')
export class PlansController {
  constructor(private readonly plansService: PlansService) {}

  @Get()
  async findAll() {
    return this.plansService.findAll();
  }

  @Get(':id')
  async findById(@Param('id') id: string) {
    return this.plansService.findById(id);
  }

  @Post()
  async create(@Body() data: CreatePlanDto) {
    return this.plansService.create(data);
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() data: UpdatePlanDto) {
    return this.plansService.update(id, data);
  }

  @Delete(':id')
  async delete(@Param('id') id: string) {
    return this.plansService.delete(id);
  }
}
