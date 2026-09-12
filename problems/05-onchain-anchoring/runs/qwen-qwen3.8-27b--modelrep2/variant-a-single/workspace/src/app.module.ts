import { Module } from '@nestjs/common';
import { AnchorModule } from './anchor/anchor.module';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [PrismaModule, AnchorModule],
})
export class AppModule {}
