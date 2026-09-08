# repair2-sign-in.dto.ts

## reasoning

```
We need to write DTO using class-validator. Likely import { IsEmail, IsString, MinLength } etc. Provide class SignInDto with email and password fields with decorators. Ensure exported. Use strict types.

Implement.
```

## reply

```typescript
// src/auth/dto/sign-in.dto.ts

import { IsEmail, IsNotEmpty, IsString, MinLength } from 'class-validator';

export class SignInDto {
  @IsEmail()
  @IsNotEmpty()
  email!: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(8) // reasonable minimum length for a password
  password!: string;
}
```
