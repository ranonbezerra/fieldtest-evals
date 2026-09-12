import { Body, BadRequestException, Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { PayoutRepository } from '../payout/payout.repository.js';

@Controller('accounts')
export class AccountsController {
  constructor(private readonly payouts: PayoutRepository) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() body: Record<string, unknown>) {
    const accountId = typeof body['accountId'] === 'string' ? body['accountId'] : '';
    const rawBalance = body['initialBalance'];
    const initialBalance = typeof rawBalance === 'number' ? rawBalance : 0;
    const invalid: string[] = [];

    if (!accountId) invalid.push('accountId');
    if (!Number.isInteger(initialBalance) || initialBalance < 0) {
      invalid.push('initialBalance');
    }
    if (invalid.length > 0) {
      throw new BadRequestException({
        error: { code: 'validation_error', message: 'Invalid account fields.', details: { invalid } },
      });
    }

    const account = await this.payouts.account(accountId, BigInt(initialBalance));
    return { id: account.id, accountNumber: account.accountNumber, balance: account.balance };
  }

  @Get(':id')
  async get(@Param('id') id: string) {
    const account = await this.payouts.account(id);
    return { id: account.id, accountNumber: account.accountNumber, balance: account.balance };
  }
}
