# repair1-create-payout.dto.ts

## reasoning

```
We need to create DTO file fixing imports. Likely use class-validator and class-transformer. Add decorators. Ensure types. Use explicit types. Provide export class CreatePayoutDto with properties: accountId: string; amount: number; destinationAddress: string; idempotencyKey: string. Use IsString, IsNotEmpty, IsNumber, IsPositive. Import from 'class-validator' and 'class-transformer'. Add Transform to convert amount to number. Also export. Ensure no implicit any. Provide file.
```

## reply

```ts
// src/payout/dto/create-payout.dto.ts
// ---------------------------------------------------------------
// Data Transfer Object for creating a payout.
// ---------------------------------------------------------------

import {
  IsString,
  IsNotEmpty,
  IsNumber,
  IsPositive,
} from 'class-validator';
import { Transform } from 'class-transformer';

// NOTE: The DTO contains only validation rules – no business logic.
// It matches the shape expected by the controller and service layers.

export class CreatePayoutDto {
  @IsString()
  @IsNotEmpty()
  accountId!: string;

  @IsNumber()
  @IsPositive()
  @Transform(({ value }) => Number(value))
  amount!: number; // amount in minor units (integer)

  @IsString()
  @IsNotEmpty()
  destinationAddress!: string;

  @IsString()
  @IsNotEmpty()
  idempotencyKey!: string;
}
```
