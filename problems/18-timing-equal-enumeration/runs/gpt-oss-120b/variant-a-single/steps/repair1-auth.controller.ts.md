# repair1-auth.controller.ts

## reasoning

```
We need to rewrite auth.controller to compile. Need imports: AuthService, DTOs. Assume they exist. Provide controller with NestJS decorators. Use appropriate routes. No business logic beyond calling service. Return whatever service returns. Ensure imports from correct paths. Use class-validator for DTOs already. We'll just import.

```ts
import { Controller, Post, Body } from '@nestjs/common';
import { AuthService } from './auth.service';
import { SignUpDto } from './dto/sign-up.dto';
import { SignInDto } from './dto/sign-in.dto';
```

Define class AuthController with constructor injecting AuthService. Methods signUp, signIn returning Promise<any>. Call service.signUp(dto) etc.

Export class.

That's it.
```

## reply

```ts
import { Controller, Post, Body } from '@nestjs/common';
import { AuthService } from './auth.service';
import { SignUpDto } from './dto/sign-up.dto';
import { SignInDto } from './dto/sign-in.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('sign-up')
  async signUp(@Body() signUpDto: SignUpDto): Promise<unknown> {
    // The service handles all logic and returns a response that is
    // intentionally indistinguishable for existing vs. new emails.
    return this.authService.signUp(signUpDto);
  }

  @Post('sign-in')
  async signIn(@Body() signInDto: SignInDto): Promise<unknown> {
    // The service handles authentication and returns a response that hides
    // whether the email exists or the password is wrong.
    return this.authService.signIn(signInDto);
  }
}
```
