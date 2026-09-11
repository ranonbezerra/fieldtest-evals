import { Inject, Module, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { AuthController } from './auth.controller.js';
import { AuthRepository, PRISMA_CLIENT } from './auth.repository.js';
import { AuthService, CLOCK } from './auth.service.js';

@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    AuthRepository,
    { provide: PRISMA_CLIENT, useFactory: () => new PrismaClient() },
    { provide: CLOCK, useValue: (): Date => new Date() },
  ],
})
export class AuthModule implements OnModuleDestroy {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async onModuleDestroy(): Promise<void> {
    await this.prisma.$disconnect();
  }
}
