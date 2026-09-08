# repair1-sign-in.dto.ts

## reasoning

```
We need to write DTO with class-validator imports. Ensure compiled. Probably need to export class SignInDto with email and password, decorated with IsEmail, IsString, MinLength etc. Include import { IsEmail, IsString, MinLength } from 'class-validator'; Also use class-transformer? Not needed. Provide proper export.
```

## reply

```ts
import { IsEmail, IsString, MinLength } from 'class-validator';

export class SignInDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  password!: string;
}
```
