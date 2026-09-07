# repair1-customer.dto.ts

## reasoning

```
need to write DTO file fixing imports. Likely missing class-validator and types. Provide export class CreateCustomerDto etc. Use Prisma Customer type maybe not exported. Just define DTO with fields: email, name. No imports needed. Ensure compile. Provide assumptions for missing types.
```

## reply

```ts
// src/customer/customer.dto.ts

import { IsEmail, IsNotEmpty, IsString, IsOptional } from 'class-validator';

/**
 * Data Transfer Object for creating a Customer.
 *
 * The DTO contains only the fields that are expected from the client.
 * Validation decorators are used so that the controller can validate the
 * incoming payload before it reaches the service layer.
 *
 * No business logic or Prisma‑specific types are imported here – the
 * service/repository layers will map this DTO to the Prisma `Customer`
 * model.
 */
export class CreateCustomerDto {
  @IsEmail()
  @IsNotEmpty()
  email!: string;

  @IsString()
  @IsNotEmpty()
  name!: string;

  // Additional optional fields can be added here as needed.
  // For example, a phone number:
  @IsString()
  @IsOptional()
  phone?: string;
}

/**
 * Data Transfer Object for updating a Customer.
 *
 * All fields are optional because a PATCH‑style update may modify only a subset
 * of the entity's properties.
 */
export class UpdateCustomerDto {
  @IsEmail()
  @IsOptional()
  email?: string;

  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  phone?: string;
}
```
