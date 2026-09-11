import { Global, MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { TenantModule } from '../tenant/tenant.module.js';
import { AuthMiddleware } from './auth.middleware.js';
import { HostTenantExtractor } from './host-tenant.extractor.js';
import { JwtTokenVerifier } from './jwt.token-verifier.js';
import type { TokenVerifier } from './token-verifier.contract.js';
import { TenantResolver } from './tenant.resolver.js';

export const TOKEN_VERIFIER = 'TOKEN_VERIFIER';

@Global()
@Module({
  imports: [TenantModule],
  providers: [
    HostTenantExtractor,
    TenantResolver,
    AuthMiddleware,
    {
      provide: TOKEN_VERIFIER,
      useFactory: (): TokenVerifier => {
        // Configuration comes from environment variables only.
        // ASSUMPTION: JWT_SECRET is provided in every real deployment;
        // without it the middleware's verification step cannot run.
        const secret = process.env.JWT_SECRET ?? '';
        return new JwtTokenVerifier(secret);
      },
    },
  ],
  exports: [TenantResolver, HostTenantExtractor],
})
export class AuthModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(AuthMiddleware).exclude('/', '/health').forRoutes('*');
  }
}
