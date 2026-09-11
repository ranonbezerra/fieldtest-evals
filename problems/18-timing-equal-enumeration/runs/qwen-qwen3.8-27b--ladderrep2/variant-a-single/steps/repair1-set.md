# repair1-set

## reasoning

```
The error is on line 34 of `src/auth/auth.controller.ts`:

```
src/auth/auth.controller.ts(34,12): error TS2322: Type 'unknown' is not assignable to type 'string'.
src/auth/auth.controller.ts(34,19): error TS2322: Type 'unknown' is not assignable to type 'string'.
```

Looking at the controller code, line 34 would be inside the `requireCredentials` function. Let me count the lines:

1: import { Body, Controller, HttpCode, Inject, Post } from '@nestjs/common';
2: import { AppException } from '../common/app.exception.js';
3: import { AuthService } from './auth.service.js';
4: (empty)
5: const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
6: const MIN_PASSWORD_LENGTH = 8;
7: const MAX_PASSWORD_LENGTH = 128;
8: (empty)
9: /**
10:  * Input validation lives in the controller: shape, format, bounds.
11:  * The same rules apply to sign-up and sign-in.
12:  */
13: function requireCredentials(body: unknown): { email: string; password: string } {
14:   if (typeof body !== 'object' || body === null || Array.isArray(body)) {
15:     throw new AppException(400, 'invalid_input', 'Request body must be a JSON object.', { fields: ['body'] });
16:   }
17:   const { email, password } = body as Record<string, unknown>;
18:   const fields: string[] = [];
19:   if (typeof email !== 'string' || email.length === 0 || email.length > 254 || !EMAIL_PATTERN.test(email)) {
20:     fields.push('email');
21:   }
22:   if (
23:     typeof password !== 'string' ||
24:     password.length < MIN_PASSWORD_LENGTH ||
25:     password.length > MAX_PASSWORD_LENGTH
26:   ) {
27:     fields.push('password');
28:   }
29:   if (fields.length > 0) {
30:     throw new AppException(400, 'invalid_input', 'email and password must be provided in the expected format.', {
31:       fields,
32:     });
33:   }
34:   return { email, password };
35: }
36: (empty)
37: @Controller('auth')
38: export class AuthController {
...

So line 34 is `return { email, password };`. The problem is that `email` and `password` are destructured from `body as Record<string, unknown>`, so their types are `unknown`. Even though we check `typeof email !== 'string'` and throw if they're not strings, TypeScript doesn't narrow the type of the destructured variables after the if-check because the throw is inside an `if` block that also checks other conditions.

Wait, actually TypeScript should narrow `email` to `string` after the `if (typeof email !== 'string' || ...)` check, because if the condition is true, we throw (via `fields.push('email')` — wait, no! We don't throw immediately. We push to `fields` and then throw later if `fields.length > 0`.

So the issue is: TypeScript can't narrow `email` to `string` because the check `typeof email !== 'string'` doesn't lead to an immediate throw — it just pushes to an array. The variable `email` remains `unknown` at the return statement.

The fix: after the validation checks, we need to assert the types. The simplest fix is to cast them:

```ts
return { email: email as string, password: password as string };
```

Or we could restructure to use early returns with throws, but the instructions say "Change exactly what the compiler requires" and "Do not add features, do not rename anything the errors do not mention, do not reorganise."

The minimal fix is to add type assertions on the return:

```ts
return { email: email as string, password: password as string };
```

This is the smallest change that fixes the type error without reorganizing anything.
```

## reply

### src/auth/auth.controller.ts
```ts
import { Body, Controller, HttpCode, Inject, Post } from '@nestjs/common';
import { AppException } from '../common/app.exception.js';
import { AuthService } from './auth.service.js';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 128;

/**
 * Input validation lives in the controller: shape, format, bounds.
 * The same rules apply to sign-up and sign-in.
 */
function requireCredentials(body: unknown): { email: string; password: string } {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new AppException(400, 'invalid_input', 'Request body must be a JSON object.', { fields: ['body'] });
  }
  const { email, password } = body as Record<string, unknown>;
  const fields: string[] = [];
  if (typeof email !== 'string' || email.length === 0 || email.length > 254 || !EMAIL_PATTERN.test(email)) {
    fields.push('email');
  }
  if (
    typeof password !== 'string' ||
    password.length < MIN_PASSWORD_LENGTH ||
    password.length > MAX_PASSWORD_LENGTH
  ) {
    fields.push('password');
  }
  if (fields.length > 0) {
    throw new AppException(400, 'invalid_input', 'email and password must be provided in the expected format.', {
      fields,
    });
  }
  return { email: email as string, password: password as string };
}

@Controller('auth')
export class AuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  @Post('sign-up')
  @HttpCode(200)
  signUp(@Body() body: unknown): Promise<{ status: 'ok' }> {
    const { email, password } = requireCredentials(body);
    return this.auth.signUp(email, password);
  }

  @Post('sign-in')
  @HttpCode(200)
  signIn(@Body() body: unknown): Promise<{ token: string }> {
    const { email, password } = requireCredentials(body);
    return this.auth.signIn(email, password);
  }
}
```
