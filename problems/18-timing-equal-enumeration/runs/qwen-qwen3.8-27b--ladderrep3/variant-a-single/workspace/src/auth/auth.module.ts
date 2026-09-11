import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller.js';
import { AuthService, MAIL_PORT } from './auth.service.js';
import { AuthRepository } from './auth.repository.js';
import { Argon2idHasher, PasswordHasher } from './password-hash.js';

@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    AuthRepository,
    { provide: PasswordHasher, useClass: Argon2idHasher },
    {
      provide: MAIL_PORT,
      // ASSUMPTION: the task states a mail port sendEmail(to, template, vars)
      // exists in the host application; it should be bound to this token
      // there. This standalone build needs a concrete provider to boot, so a
      // console sink stands in for it.
      useValue: {
        async sendEmail(to: string, template: string, vars: Record<string, string>): Promise<void> {
          console.error(`[mail] to=${to} template=${template} vars=${JSON.stringify(vars)}`);
        },
      },
    },
  ],
  exports: [AuthService],
})
export class AuthModule {}
