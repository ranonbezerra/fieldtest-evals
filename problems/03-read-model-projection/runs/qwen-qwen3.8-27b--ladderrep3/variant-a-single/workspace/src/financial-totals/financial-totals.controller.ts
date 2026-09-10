import { Controller, Get, Inject, Param } from '@nestjs/common';
import { DomainException } from '../common/domain-exception.js';
import { isUuid } from '../common/params.js';
import { FinancialTotalsService } from './financial-totals.service.js';

@Controller('companies')
export class FinancialTotalsController {
  constructor(@Inject(FinancialTotalsService) private readonly financialTotalsService: FinancialTotalsService) {}

  @Get(':companyId/financial-totals')
  get(@Param('companyId') companyId: string) {
    if (!isUuid(companyId)) {
      throw new DomainException(400, 'validation_failed', 'companyId must be a UUID', { company_id: companyId });
    }
    return this.financialTotalsService.get(companyId);
  }
}
