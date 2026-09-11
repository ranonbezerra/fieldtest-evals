import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module.js';
import { AllExceptionsFilter } from './errors/all-exceptions.filter.js';

@Module({
  imports: [AuthModule],
  providers: [{ provide: 'APP_FILTER', useClass: AllExceptionsFilter }],
})
export class AppModule {}
