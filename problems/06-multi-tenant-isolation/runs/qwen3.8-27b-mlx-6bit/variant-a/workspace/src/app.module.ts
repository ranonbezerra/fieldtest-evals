import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TenantModule } from './tenant/tenant.module';
import { CustomerModule } from './customer/customer.module';
import { TenantResolutionMiddleware } from './tenant/tenant-resolution.middleware';

// ASSUMPTION: @nestjs/jwt is not yet installed in the workspace; the import is correct per plan and will resolve once `pnpm add @nestjs/jwt` is run.

@Module({
  imports: [
    JwtModule.register({
      secret: process.env.JWT_SECRET,
    }),
    TenantModule,
    CustomerModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(TenantResolutionMiddleware).forRoutes('*');
  }
}
