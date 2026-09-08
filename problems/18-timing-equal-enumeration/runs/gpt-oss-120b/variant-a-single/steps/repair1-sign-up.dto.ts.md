# repair1-sign-up.dto.ts

## reasoning

```
We need to write DTO with class-validator imports. Likely missing. Provide class with email and password with decorators. Use IsEmail, IsString, MinLength. Export class SignUpDto. Ensure compiled. Use export class SignUpDto.
```

## reply

```ts
import { IsEmail, IsString, MinLength } from 'class-validator';

export class SignUpDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  password!: string;
}
```
