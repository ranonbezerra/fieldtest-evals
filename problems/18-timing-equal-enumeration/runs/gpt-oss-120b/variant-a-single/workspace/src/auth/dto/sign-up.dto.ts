// src/auth/dto/sign-up.dto.ts

import { IsEmail, IsString, MinLength, IsNotEmpty } from 'class-validator';

/**
 * Data Transfer Object for the sign‑up endpoint.
 *
 * Contains the minimal fields required to create a new user account.
 * Validation rules are applied using class‑validator decorators.
 */
export class SignUpDto {
  @IsEmail()
  @IsNotEmpty()
  email!: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(8) // enforce a reasonable password length
  password!: string;
}
