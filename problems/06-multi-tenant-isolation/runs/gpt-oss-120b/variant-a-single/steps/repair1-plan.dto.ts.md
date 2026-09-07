# repair1-plan.dto.ts

## reasoning

```
We need to write DTO. Likely need to import classes correctly. Errors are about missing imports elsewhere, but we just fix this file to compile. Need to export class CreatePlanDto etc. Use class-validator? Not required. Provide basic types. Ensure no missing imports. Probably need to import IsString, IsNumber from class-validator. Also export type.

Let's output minimal DTO that matches typical pattern.
```

## reply

```ts
// src/plan/plan.dto.ts
// ------------------------------------------------------------
// Data Transfer Objects for the Plan feature.
// ------------------------------------------------------------

import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsNumber,
  Min,
  MaxLength,
} from 'class-validator';

/**
 * DTO used when creating a new plan.
 *
 * The controller validates the incoming payload against this class.
 * No business logic is placed here – it only describes the shape of the
 * data that the service expects.
 */
export class CreatePlanDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name!: string;

  @IsString()
  @IsOptional()
  @MaxLength(1000)
  description?: string;

  @IsNumber()
  @Min(0)
  price!: number;
}

/**
 * DTO used when updating an existing plan.
 *
 * All fields are optional because a partial update is allowed.
 * The service will merge the provided fields with the existing entity.
 */
export class UpdatePlanDto {
  @IsString()
  @IsOptional()
  @MaxLength(255)
  name?: string;

  @IsString()
  @IsOptional()
  @MaxLength(1000)
  description?: string;

  @IsNumber()
  @IsOptional()
  @Min(0)
  price?: number;
}
```
