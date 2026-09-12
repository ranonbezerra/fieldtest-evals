import * as cv from 'class-validator';

export class SignUpDto {
  @cv.IsEmail()
  email!: string;

  @cv.IsString()
  @cv.MinLength(8)
  password!: string;
}
