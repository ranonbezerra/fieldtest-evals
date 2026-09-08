# repair2-sign-up.dto.ts

## reasoning

```
We need to rewrite sign-up DTO to fix compile errors. Errors refer to missing module 'class-validator' import. So we need to import appropriate decorators: IsEmail, IsString, MinLength, etc. Also need to export class SignUpDto. Likely also need to define properties email and password with validation decorators.

Also there might be other compile errors: in auth.service, error TS2322: Type 'string | undefined' is not assignable to type 'string' at line 120. That's unrelated.

We just need to rewrite sign-up.dto.ts.

Make sure to import from 'class-validator'. Use appropriate types.

Also need to consider environment: Typescript strict.

Define:

import { IsEmail, IsString, MinLength } from 'class-validator';
export class SignUpDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  password: string;
}

Maybe also use @IsNotEmpty.

That's fine.

Make sure file path matches imports in other files: they import './dto/sign-up.dto'.

Thus implement.

No other changes.

Provide as fenced block.
```

## reply

```ts
// src/auth/dto/sign-up.dto.ts

import { IsEmail, IsString, MinLength, IsNotEmpty } from 'class-validator';

/**
 * Data Transfer Object for the sign‑up endpoint.
 *
 * Contains the minimal fields required to create a new user account.
 * Validation rules are applied using class‑validator decorators.
 */
export class SignUpDto {
  @IsEmail()
  @IsNotEmpty()
  email!: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(8) // enforce a reasonable password length
  password!: string;
}
```
