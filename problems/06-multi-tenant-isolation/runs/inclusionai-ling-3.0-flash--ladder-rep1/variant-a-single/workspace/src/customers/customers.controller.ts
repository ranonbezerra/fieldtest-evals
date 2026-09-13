import { Controller, Get, Post, Put, Delete, Param, Body, Query } from '@nestjs/common';
import { CustomersService } from './customers.service.js';

@Controller('customers')
export class CustomersController {
  constructor(private readonly customersService: CustomersService) {}

  @Get()
  findAll(@Query('tenantId') tenantId: string) {
    return this.customersService.findAll(tenantId);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @Query('tenantId') tenantId: string) {
    return this.customersService.findOne(id, tenantId);
  }

  @Post()
  create(@Body() body: { tenantId: string; email: string; name: string; phone?: string }) {
    return this.customersService.create(body.tenantId, body);
  }

  @Put(':id')
  update(@Param('id') id: string, @Query('tenantId') tenantId: string, @Body() body: Partial<{ email: string; name: string; phone?: string }>) {
    return this.customersService.update(id, tenantId, body);
  }

  @Delete(':id')
  delete(@Param('id') id: string, @Query('tenantId') tenantId: string) {
    return this.customersService.delete(id, tenantId);
  }
}
