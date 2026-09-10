import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { CustomerService } from './customer.service';

@Controller('customers')
export class CustomerController {
  constructor(private readonly customerService: CustomerService) {}

  @Get()
  findAll() {
    return this.customerService.findAll();
  }

  @Get(':id')
  findById(@Param('id') id: string) {
    return this.customerService.findById(id);
  }

  @Post()
  create(@Body() body: { email: string; name?: string | null }) {
    return this.customerService.create(body);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() body: { email: string; name?: string | null },
  ) {
    return this.customerService.update(id, body);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.customerService.remove(id);
  }
}
