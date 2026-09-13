import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module.ts';
import { AllExceptionsFilter } from './errors/all-exceptions.filter.ts';

@Module({
  imports: [AuthModule],
  providers: [AllExceptionsFilter],
})
export class AppModule {}
