# 06-auth.dto.ts

## reasoning

```
The user wants me to write exactly one file: `src/auth/auth.dto.ts`.

From the plan, the specification for this file is:

```ts
export class SignUpDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  password: string;
}

export class SignInDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  password: string;
}
```

The plan says "DTO validation | Class-validator decorators on DTO classes, global `ValidationPipe` in `main.ts`".

I need to import the decorators from `class-validator`. The standard imports would be:
- `IsEmail` from `class-validator`
- `IsString` from `class-validator`
- `MinLength` from `class-validator`

Let me write the complete file with proper imports. The plan shows the exact structure. I'll add the import statement since it's needed for a complete file.

The file is simple and fully specified by the plan. No assumptions needed.
```

## reply

```ts
import { IsEmail, IsString, MinLength } from "class-validator";

export class SignUpDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  password!: string;
}

export class SignInDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  password!: string;
}
```
