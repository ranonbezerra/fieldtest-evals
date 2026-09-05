import { Controller, Get, Param, HttpException, HttpStatus } from '@nestjs/common';
import { AccountService } from './account.service';

@Controller('accounts')
export class AccountController {
  constructor(private readonly accountService: AccountService) {}

  @Get(':id')
  async getById(@Param('id') id: string): Promise<Record<string, unknown>> {
    try {
      return await this.accountService.findById(id);
    } catch (err: unknown) {
      if (err instanceof Error && (err as { code?: string }).code === 'resource_not_found') {
        throw new HttpException(
          {
            error: {
              code: 'resource_not_found',
              message: (err as Error).message,
              details: {},
            },
          },
          HttpStatus.NOT_FOUND,
        );
      }
      throw err;
    }
  }
}
