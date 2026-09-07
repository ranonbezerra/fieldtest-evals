# repair1-invite-member.dto.ts

## reasoning

```
Let me analyze the compiler errors that relate to `src/modules/trips/dto/invite-member.dto.ts`:

Looking at the error messages:
```
src/modules/trips/trips.controller.ts(12,33): error TS2307: Cannot find module './dto/invite-member.dto' or its corresponding type declarations.
```

That's the only error that directly names `invite-member.dto.ts`. The error is that the module cannot be found - meaning the file doesn't exist or doesn't export what the controller expects.

Now I need to figure out what shape `invite-member.dto.ts` should have. The feature spec says:

- `POST /trips/:id/invites` — owner invites by email

So the DTO for inviting a member would need an `email` field.

Looking at the controller import:
```
src/modules/trips/trips.controller.ts(12,33): error TS2307: Cannot find module './dto/invite-member.dto' or its corresponding type declarations.
```

The controller imports from `./dto/invite-member.dto`. The DTO needs to be a valid TypeScript module that exports what the controller expects.

For a "invite member" DTO, based on the feature spec (owner invites by email), the DTO should have an `email` field.

Now, looking at the conventions:
- The task says to use the existing `ApiResult<T>` helpers and `AppError` codes
- The DTO is for input validation

Let me think about what a typical NestJS DTO for inviting a member would look like. It would use class-validator decorators typically.

The DTO should export a class with an `email` property that's validated.

Since the error is just "Cannot find module", the file simply doesn't exist. I need to create it with the appropriate export that the controller expects.

Based on the feature spec: "owner invites by email" - the DTO needs an `email` field.

Let me write a clean DTO:

```typescript
import { IsEmail, IsString } from 'class-validator';

export class InviteMemberDto {
  @IsString()
  @IsEmail()
  email: string;
}
```

This is the minimal, correct DTO for the "invite by email" endpoint. The controller imports `InviteMemberDto` from this file.

Wait, I need to be careful. The task says "Change nothing the messages do not name." The only message that names this file is the controller's import error. So I just need to make this file exist and export the right thing.

The class name should be `InviteMemberDto` (PascalCase per conventions, kebab-case file name).

Let me keep it simple and correct.
```

## reply

```typescript
import { IsEmail, IsString } from 'class-validator';

export class InviteMemberDto {
  @IsString()
  @IsEmail()
  email: string;
}
```
