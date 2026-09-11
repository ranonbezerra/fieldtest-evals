import { Controller, Get, Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { AuthModule } from './auth/auth.module.js';
import { CustomerModule } from './customer/customer.module.js';
import { ExceptionEnvelopeFilter } from './errors/exception-envelope.filter.js';
import { OrderModule } from './order/order.module.js';
import { PlanModule } from './plan/plan.module.js';
import { TenantsModule } from './tenant/tenants/tenants.module.js';

@Controller('/health')
class HealthController {
  @Get()
  check(): { status: string } {
    return { status: 'ok' };
  }
}

@Module({
  imports: [AuthModule, TenantsModule, CustomerModule, PlanModule, OrderModule],
  controllers: [HealthController],
  providers: [{ provide: APP_FILTER, useClass: ExceptionEnvelopeFilter }],
})
export class AppModule {}
