import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { TenantMiddleware } from './tenant.middleware';
import { TenantResolverService } from './tenant-resolver.service';
import { TenantService } from './tenant.service';

@Module({
  imports: [PrismaModule],
  providers: [TenantResolverService, TenantService, TenantMiddleware],
  exports: [TenantResolverService, TenantService, TenantMiddleware],
})
export class TenantModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(TenantMiddleware).forRoutes('*');
  }
}
