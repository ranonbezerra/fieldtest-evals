# repair1-auth.controller.ts

## reasoning

```
Let me analyze the compiler errors that relate to `src/auth/auth.controller.ts`:

1. `src/auth/auth.controller.ts` - the first error is truncated but says "annot find module './auth.repository' or its corresponding type declarations." - This is actually from `src/auth/auth.service.ts` based on the context (line 5, column 32). Let me re-read...

Wait, looking more carefully at the errors:

```
annot find module './auth.repository' or its corresponding type declarations.
src/auth/auth.repository.ts(3,31): error TS2307: Cannot find module '../prisma/prisma.service' or its corresponding type declarations.
src/auth/auth.service.ts(2,25): error TS2307: Cannot find module 'argon2' or its corresponding type declarations.
src/auth/auth.service.ts(5,32): error TS2307: Cannot find module './auth.repository' or its corresponding type declarations.
```

The first line is truncated - it starts with "annot find module" which is "Cannot find module" cut off. It doesn't show the file/line. But looking at the pattern, it could be from `src/auth/auth.controller.ts` importing something that doesn't exist.

Wait, let me re-read the task: "Rewrite `src/auth/auth.controller.ts` complete, fixing what these messages require of this file."

So I need to figure out which errors are in `src/auth/auth.controller.ts`. The first line is truncated but it's the only one that could be from the controller. It says "annot find module './auth.repository' or its corresponding type declarations." - but wait, that doesn't make sense for a controller. The controller should import from `./auth.service` and `./auth.dto`.

Actually, looking at the first error more carefully - it's truncated at the beginning. It could be:
- `src/auth/auth.controller.ts(X,XX): error TS2307: Cannot find module './auth.repository' or its corresponding type declarations.`

But why would the controller import `./auth.repository`? It shouldn't - it should only import from `./auth.service` and `./auth.dto`.

Wait, maybe the truncated first line is actually from a different file. Let me look at the full list again:

```
annot find module './auth.repository' or its corresponding type declarations.
src/auth/auth.repository.ts(3,31): error TS2307: Cannot find module '../prisma/prisma.service' or its corresponding type declarations.
src/auth/auth.service.ts(2,25): error TS2307: Cannot find module 'argon2' or its corresponding type declarations.
src/auth/auth.service.ts(5,32): error TS2307: Cannot find module './auth.repository' or its corresponding type declarations.
```

The first line is clearly truncated - it's missing the file path and line/column. It ends with "annot find module './auth.repository' or its corresponding type declarations." This is the tail end of a "Cannot find module" error.

Given that the task says these are errors for the whole workspace and I need to fix `src/auth/auth.controller.ts`, the first error is likely from the controller file. But importing `./auth.repository` in the controller would be a design error per the conventions (controller should only call service).

Hmm, but wait. Let me reconsider. The task says "Rewrite `src/auth/auth.controller.ts` complete, fixing what these messages require of this file." So the errors that pertain to the controller are what I need to fix.

Looking at the errors again, the only one that could be from `auth.controller.ts` is the first truncated one. The others are clearly from other files (repository, service, main, test).

But actually, I think the issue might be different. Let me reconsider what the controller would look like based on the plan:

```ts
@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post("sign-up")
  signUp(@Body() dto: SignUpDto): Promise<{ message: string }>;

  @Post("sign-in")
  signIn(@Body() dto: SignInDto): Promise<{ token: string }>;
}
```

The controller imports:
- `@Controller`, `@Post`, `@Body` from `@nestjs/common`
- `AuthService` from `./auth.service`
- `SignUpDto`, `SignInDto` from `./auth.dto`

Now, the errors that could be from the controller... The first truncated error says "Cannot find module './auth.repository'" - but that doesn't make sense for a controller. Unless the previous implementation of the controller was importing the repository directly (which would be a layering violation).

Actually, I think I'm overthinking this. The task is clear: "Rewrite `src/auth/auth.controller.ts` complete, fixing what these messages require of this file." 

The key insight is: the controller file currently has an error. The first (truncated) error line is from this file. It says it can't find module `./auth.repository`. This means the current controller is importing from `./auth.repository` which either doesn't exist yet or the import path is wrong.

But per the plan and conventions, the controller should NOT import the repository. It should only import the service. So the fix is to rewrite the controller correctly, importing only from `./auth.service` and `./auth.dto`.

Now, the other errors in the list are from other files:
- `src/auth/auth.repository.ts` - can't find `../prisma/prisma.service` (not my problem)
- `src/auth/auth.service.ts` - can't find `argon2` and `./auth.repository` (not my problem)
- `src/main.ts` - can't find `express` (not my problem)
- `test/auth.spec.ts` - various issues (not my problem)

So for `src/auth/auth.controller.ts`, I just need to write it correctly per the plan, importing from `./auth.service` and `./auth.dto`, and not importing from `./auth.repository`.

Let me also consider: the error about `'exception' is of type 'unknown'` in test/auth.spec.ts line 30 - that's not in the controller.

The `'inject' does not exist on type 'INestApplication<any>'` errors - those are in the test file, not the controller.

So my task is straightforward: write a correct `src/auth/auth.controller.ts` that:
1. Imports from `@nestjs/common`
2. Imports `AuthService` from `./auth.service`
3. Imports DTOs from `./auth.dto`
4. Has `@Controller("auth")`
5. Has `@Post("sign-up")` and `@Post("sign-in")`
6. Calls the service methods
7. No business logic
8. No import of `./auth.repository`

Let me write this:

```ts
import { Body, Controller, Post } from "@nestjs/common";
import { AuthService } from "./auth.service";
import { SignInDto, SignUpDto } from "./auth.dto";

@Controller("auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post("sign-up")
  signUp(@Body() dto: SignUpDto): Promise<{ message: string }> {
    return this.authService.signUp(dto.email, dto.password);
  }

  @Post("sign-in")
  signIn(@Body() dto: SignInDto): Promise<{ token: string }> {
    return this.authService.signIn(dto.email, dto.password);
  }
}
```

This should be correct. It doesn't import `./auth.repository` (which was causing the error), it only imports what it needs per the layering conventions.

Wait, but I should double-check: does the plan say the return type for sign-in includes error handling? Looking at the plan:

```
@Post("sign-in")
signIn(@Body() dto: SignInDto): Promise<{ token: string }>;
```

And the service throws `AuthFailureError` on failure. The controller just lets it propagate. That's fine - the global exception filter in `main.ts` handles it.

This looks good. Let me finalize.
```

## reply

```ts
import { Body, Controller, Post } from "@nestjs/common";
import { AuthService } from "./auth.service";
import { SignInDto, SignUpDto } from "./auth.dto";

@Controller("auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post("sign-up")
  signUp(@Body() dto: SignUpDto): Promise<{ message: string }> {
    return this.authService.signUp(dto.email, dto.password);
  }

  @Post("sign-in")
  signIn(@Body() dto: SignInDto): Promise<{ token: string }> {
    return this.authService.signIn(dto.email, dto.password);
  }
}
```
