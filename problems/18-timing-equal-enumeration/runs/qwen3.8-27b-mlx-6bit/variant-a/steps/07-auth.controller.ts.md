# 07-auth.controller.ts

## reasoning

```
Let me analyze what I need to write for `src/auth/auth.controller.ts` based on the PLAN.md.

From the plan:
- `@Controller("auth")` decorator
- `AuthController` class
- Constructor takes `AuthService`
- Two endpoints:
  - `@Post("sign-up")` → `signUp(@Body() dto: SignUpDto): Promise<{ message: string }>`
  - `@Post("sign-in")` → `signIn(@Body() dto: SignInDto): Promise<{ token: string }>`

The controller validates input (via the global ValidationPipe) and calls the service. Zero business logic.

The controller imports:
- `Controller`, `Post`, `Body` from `@nestjs/common`
- `AuthService` from `./auth.service.ts`
- `SignUpDto`, `SignInDto` from `./auth.dto.ts`

The sign-in endpoint: the plan says it returns `200 { token }` on success, and throws `AuthFailureError` on failure (which is handled by the global exception filter to produce 401). So the controller just calls `this.auth.signIn(email, password)` and returns the result. If it throws, the global filter handles it.

The sign-up endpoint: always returns `200 { message }`. The service handles both branches internally.

Let me write the complete file.
```

## reply

```ts
import { Body, Controller, Post } from "@nestjs/common";
import { AuthService } from "./auth.service";
import { SignInDto, SignUpDto } from "./auth.dto";

@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post("sign-up")
  async signUp(@Body() dto: SignUpDto): Promise<{ message: string }> {
    return this.auth.signUp(dto.email, dto.password);
  }

  @Post("sign-in")
  async signIn(@Body() dto: SignInDto): Promise<{ token: string }> {
    return this.auth.signIn(dto.email, dto.password);
  }
}
```
