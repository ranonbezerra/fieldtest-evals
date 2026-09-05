# repair1-invite-trip.dto.ts

## reasoning

```
Let me analyze the compiler errors to determine what's wrong with `src/modules/trips/dto/invite-trip.dto.ts`.

Looking at the error messages, I need to find which ones relate to this specific file:

1. `src/modules/trips/trips.service.spec.ts(5,31): error TS2307: Cannot find module './dto/invite-trip.dto' or its corresponding type declarations.`
2. `src/modules/trips/trips.service.ts(5,31): error TS2307: Cannot find module './dto/invite-trip.dto' or its corresponding type declarations.`

These are "Cannot find module" errors, meaning the file either doesn't exist or doesn't export what's expected.

The task says "Rewrite `src/modules/trips/dto/invite-trip.dto.ts` complete, fixing what these messages require of this file."

So the file needs to exist and export `InviteTripDto`. The "Cannot find module" error means the file is missing or has no exports.

Looking at the plan, the DTO should be:
```ts
export class InviteTripDto {
  email: string; // @IsEmail
}
```

Now, the project uses ESM with `"type": "module"` and based on error `TS2835: Relative import paths need explicit file extensions in ECMAScript imports when '--moduleResolution' is 'node16' or 'nodenext'`, the project uses `node16` or `nodenext` module resolution.

This means imports need `.js` extensions. But the errors in the spec file show imports like `./dto/invite-trip.dto` without extensions - but those are errors in OTHER files, not in this file. The task says "Change nothing the messages do not name."

Wait, let me re-read. The errors naming this file are:
- `trips.service.spec.ts(5,31): Cannot find module './dto/invite-trip.dto'`
- `trips.service.ts(5,31): Cannot find module './dto/invite-trip.dto'`

These mean the importing files can't find this module. The fix for THIS file is to make sure it exists and properly exports `InviteTripDto`.

The file just needs to exist with the correct export. Since it's a DTO file, it should be straightforward. The `@IsEmail` decorator from `class-validator` would be used based on the plan.

Let me write the complete file:

```ts
import { IsEmail } from 'class-validator';

export class InviteTripDto {
  @IsEmail()
  email: string;
}
```

Wait, but the task says "Change nothing the messages do not name." The messages only say this file can't be found. So I just need to make it exist with the right export. The plan specifies `@IsEmail` so I should include that.

Actually, let me reconsider. The error is "Cannot find module" which means the file doesn't exist or has no named export. The fix is simply to create the file with the proper export. The plan says it should have `@IsEmail` decorator.

Let me keep it simple and aligned with the plan.
```

## reply

```ts
import { IsEmail } from 'class-validator';

export class InviteTripDto {
  @IsEmail()
  email: string;
}
```
