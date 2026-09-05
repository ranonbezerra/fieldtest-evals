# 06-invite-trip.dto.ts

## reasoning

```
The user wants me to write exactly one file: `src/modules/trips/dto/invite-trip.dto.ts`

From the plan, this file should contain:

```ts
export class InviteTripDto {
  email: string; // @IsEmail
}
```

This is a DTO class with an `email` field. The comment says it should have `@IsEmail` validation decorator. Let me think about what's most defensible here.

The plan says:
- `email: string; // @IsEmail`

This suggests the class has an `email` property of type `string`, and the validation is `@IsEmail`. In NestJS, DTOs typically use class-validator decorators for validation. The comment `// @IsEmail` likely indicates that the property should be decorated with `@IsEmail()` from `class-validator`.

Looking at the plan more carefully, it shows the DTO as a simple class with type annotations and a comment about the decorator. Since this is a NestJS project and the plan references validation decorators, I should include the `@IsEmail()` decorator from `class-validator`.

Let me write the file with:
- Import of `@IsEmail` from `class-validator`
- The class with the decorated property

Actually, looking at the plan again: `email: string; // @IsEmail` — the comment notation might just be indicating what validation is expected, not necessarily that the decorator is literally there. But in a NestJS project with DTOs, it's standard to use class-validator decorators. The plan's notation `// @IsEmail` is the conventional way to indicate "this field uses @IsEmail validation."

I'll include the decorator as that's the standard NestJS pattern and what the plan clearly intends.
```

## reply

```ts
import { IsEmail } from 'class-validator';

export class InviteTripDto {
  @IsEmail()
  email: string;
}
```
