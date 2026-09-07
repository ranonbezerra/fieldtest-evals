# repair2-customer.dto.ts

## reasoning

```
We need to write DTO file fixing compile errors. Likely missing imports like class-validator, etc. Provide DTO with validation decorators. Use class-validator import. Ensure export class CreateCustomerDto, UpdateCustomerDto. Also need tenantId? Probably not. Just basic fields: email, name. Use IsEmail, IsString. Provide appropriate.
```

## reply

```ts
// src/customer/customer.dto.ts

import { IsEmail, IsNotEmpty, IsString, IsOptional } from 'class-validator';

// DTO for creating a new customer.
// The tenant identifier is injected automatically by the Prisma middleware,
// so it is not part of the payload.
export class CreateCustomerDto {
  @IsEmail()
  email!: string;

  @IsString()
  @IsNotEmpty()
  name!: string;

  // Additional optional fields can be added here as needed.
}

// DTO for updating an existing customer.
// All fields are optional to allow partial updates.
export class UpdateCustomerDto {
  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;
}
```
