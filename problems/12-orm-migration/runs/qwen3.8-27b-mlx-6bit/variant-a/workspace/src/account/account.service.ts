import { Injectable, NotFoundException } from '@nestjs/common';
import { AccountRepository, AccountRow } from './account.repository';

export interface AccountResponse {
  id: string;
  name: string;
  balance_cents: string;
  total_invoiced_cents: string;
  created_at: string;
  updated_at: string;
}

@Injectable()
export class AccountService {
  constructor(private readonly repo: AccountRepository) {}

  async findById(id: string): Promise<AccountResponse> {
    const row = await this.repo.findById(id);
    if (!row) {
      throw new NotFoundException('Account not found');
    }
    return this.toResponse(row);
  }

  async create(data: { name: string }): Promise<AccountResponse> {
    const row = await this.repo.create(data);
    return this.toResponse(row);
  }

  private toResponse(row: AccountRow): AccountResponse {
    return {
      id: row.id,
      name: row.name,
      balance_cents: row.balance_cents,
      total_invoiced_cents: row.total_invoiced_cents,
      created_at: row.created_at.toISOString(),
      updated_at: row.updated_at.toISOString(),
    };
  }
}
