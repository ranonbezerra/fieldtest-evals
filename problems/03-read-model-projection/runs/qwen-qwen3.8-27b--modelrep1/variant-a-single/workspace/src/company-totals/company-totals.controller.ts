import { Controller, Get, Query } from '@nestjs/common';
import { optionalUuid } from '../common/validation.js';
import { CompanyTotalsService } from './company-totals.service.js';

@Controller('company-totals')
export class CompanyTotalsController {
  constructor(private readonly service: CompanyTotalsService) {}

  @Get()
  list(@Query() query: Record<string, string | undefined>) {
    return this.service.forCompany(optionalUuid(query.company_id, 'company_id'));
  }
}
