import { Module } from '@nestjs/common';
import { GuideModule } from './guide/guide.module';

// ASSUMPTION: the task defines no persistence, so this feature has no Prisma
// repository, no schema and no DATABASE_URL usage; the answer pipeline is
// stateless and the eval harness runs in-process.
@Module({
  imports: [GuideModule],
})
export class AppModule {}
