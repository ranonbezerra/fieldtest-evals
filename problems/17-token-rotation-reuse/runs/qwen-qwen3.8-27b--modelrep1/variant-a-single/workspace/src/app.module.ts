import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module.js';

// The pre-existing sign-in feature is assumed to be wired by the host app;
// this wires the rotation feature into it.
@Module({
  imports: [AuthModule],
})
export class AppModule {}
