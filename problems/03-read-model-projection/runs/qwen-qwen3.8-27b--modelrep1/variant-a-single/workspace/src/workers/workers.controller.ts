import { Body, Controller, Param, Patch, Post } from '@nestjs/common';
import { asRecord, requireString, requireUuid } from '../common/validation.js';
import { WorkersService } from './workers.service.js';

@Controller('workers')
export class WorkersController {
  constructor(private readonly service: WorkersService) {}

  @Post()
  create(@Body() body: unknown) {
    const payload = asRecord(body, 'request body');
    return this.service.create({
      companyId: requireUuid(payload.company_id, 'company_id'),
      name: requireString(payload.name, 'name', 200),
    });
  }

  @Patch(':id')
  rename(@Param('id') id: string, @Body() body: unknown) {
    const payload = asRecord(body, 'request body');
    return this.service.rename(requireUuid(id, 'id'), requireString(payload.name, 'name', 200));
  }
}
