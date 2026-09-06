import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { AuthRepository } from './auth.repository.js';

// ASSUMPTION: AccessTokenIssuer is an interface (not a class), so it cannot
// appear as a value in `providers`. It is resolved at the app level via a
// custom injection token or useExisting binding exported by AppModule.
@Module({
  controllers: [AuthController],
  providers: [AuthService, AuthRepository],
  exports: [AuthService],
})
export class AuthModule {}
