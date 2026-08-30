import { Body, Controller, HttpException, HttpStatus, Post } from '@nestjs/common';
import { PayoutError, PayoutService } from './payout.service';

export interface CreatePayoutDto {
  accountId: string;
  amount: string;
  destinationAddress: string;
  idempotencyKey: string;
}

@Controller('payouts')
export class PayoutController {
  constructor(private readonly service: PayoutService) {}

  @Post()
  async create(@Body() body: CreatePayoutDto): Promise<{ payoutId: string }> {
    const input = this.toInput(body);

    try {
      return await this.service.createPayout(input);
    } catch (err) {
      throw this.toHttpException(err);
    }
  }

  private toInput(body: CreatePayoutDto): {
    accountId: string;
    amount: bigint;
    destinationAddress: string;
    idempotencyKey: string;
  } {
    const raw: unknown = body;
    if (typeof raw !== 'object' || raw === null) {
      throw this.invalidInput('Request body must be a JSON object', 'body');
    }

    const candidate = raw as Record<string, unknown>;

    for (const field of ['accountId', 'destinationAddress', 'idempotencyKey'] as const) {
      if (typeof candidate[field] !== 'string' || candidate[field].length === 0) {
        throw this.invalidInput(`Field "${field}" must be a non-empty string`, field);
      }
    }

    if (typeof candidate.amount !== 'string' || !/^\d+$/.test(candidate.amount)) {
      throw this.invalidInput(
        'Field "amount" must be a decimal string of whole minor units',
        'amount',
      );
    }

    return {
      accountId: candidate.accountId as string,
      amount: BigInt(candidate.amount as string),
      destinationAddress: candidate.destinationAddress as string,
      idempotencyKey: candidate.idempotencyKey as string,
    };
  }

  private invalidInput(message: string, field: string): HttpException {
    // ASSUMPTION: the plan does not name an error code for invalid request input; "invalid_input" is the most defensible snake_case choice.
    return new HttpException(
      { error: { code: 'invalid_input', message, details: { field } } },
      HttpStatus.BAD_REQUEST,
    );
  }

  private toHttpException(err: unknown): HttpException {
    if (err instanceof PayoutError) {
      return new HttpException(
        { error: { code: err.code, message: err.message, details: err.details } },
        this.statusForCode(err.code),
      );
    }

    return new HttpException(
      { error: { code: 'internal_error', message: 'Internal server error', details: {} } },
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }

  private statusForCode(code: string): HttpStatus {
    switch (code) {
      case 'insufficient_funds':
      case 'duplicate_payout':
        return HttpStatus.CONFLICT;
      case 'resource_not_found':
        return HttpStatus.NOT_FOUND;
      default:
        return HttpStatus.INTERNAL_SERVER_ERROR;
    }
  }
}
