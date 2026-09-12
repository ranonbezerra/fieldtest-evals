import {
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
  registerDecorator,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

/** Hard cap for a single payout, in minor units (guard against input errors). */
export const MAX_PAYOUT_AMOUNT_MINOR = 10n ** 15n;

@ValidatorConstraint({ name: 'isMinorUnits' })
class IsMinorUnitsConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (typeof value === 'number') {
      return Number.isSafeInteger(value) && value > 0 && BigInt(value) <= MAX_PAYOUT_AMOUNT_MINOR;
    }
    if (typeof value === 'string') {
      return /^\d+$/.test(value) && value.length <= 25 && BigInt(value) > 0n && BigInt(value) <= MAX_PAYOUT_AMOUNT_MINOR;
    }
    return false;
  }

  defaultMessage(): string {
    return 'amount must be a positive integer in minor units (integer or decimal string, no floating point)';
  }
}

export function IsMinorUnits(): PropertyDecorator {
  return (target, propertyKey) => {
    registerDecorator({
      target: target.constructor,
      propertyKey: String(propertyKey),
      validator: new IsMinorUnitsConstraint(),
    });
  };
}

export class CreatePayoutDto {
  @IsUUID('4')
  accountId!: string;

  /**
   * Minor units, as an integer or a decimal string (the safe JSON transport
   * for large integers). Floating point is rejected.
   */
  @IsMinorUnits()
  amount!: number | string;

  // ASSUMPTION: the exact address format is chain-specific; we only enforce a
  // safe character set and a sane length.
  @IsString()
  @MinLength(6)
  @MaxLength(256)
  @Matches(/^[A-Za-z0-9._-]+$/, {
    message: 'destinationAddress may only contain letters, digits, ".", "_" or "-"',
  })
  destinationAddress!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(128)
  idempotencyKey!: string;
}
