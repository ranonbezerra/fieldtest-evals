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
