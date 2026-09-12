import * as cv from 'class-validator';

export class SignInDto {
  @cv.IsEmail()
  email!: string;

  @cv.IsString()
  @cv.MinLength(8)
  password!: string;
}
