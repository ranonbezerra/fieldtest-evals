import { Injectable } from '@nestjs/common';
import { CompanyTotalsRepository } from './company-totals.repository.js';

@Injectable()
export class CompanyTotalsService {
  constructor(private readonly repo: CompanyTotalsRepository) {}

  async getTotals(companyId: number) {
    return this.repo.findByCompanyId(companyId);
  }
}
