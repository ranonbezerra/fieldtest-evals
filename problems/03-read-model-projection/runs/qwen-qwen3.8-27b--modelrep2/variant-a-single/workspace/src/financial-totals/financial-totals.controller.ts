import { Controller, Get, Query } from '@nestjs/common';
import { ApiError } from '../common/api-error.js';
import { isUuid } from '../common/validation.js';
import { FinancialTotalsService } from './financial-totals.service.js';

@Controller('financial-totals')
export class FinancialTotalsController {
  constructor(private readonly service: FinancialTotalsService) {}

  @Get()
  forCompany(@Query('company_id') companyId: string | undefined) {
    if (!isUuid(companyId)) {
      throw new ApiError('validation_failed', 'Query parameters failed validation.', 400, {
        fields: { company_id: 'must be a UUID' },
      });
    }
    return this.service.forCompany(companyId);
  }
}
