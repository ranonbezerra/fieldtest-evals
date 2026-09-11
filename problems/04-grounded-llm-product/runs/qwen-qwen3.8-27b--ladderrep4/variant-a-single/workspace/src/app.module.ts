import { Module } from '@nestjs/common';
import { GuideModule } from './guide/guide.module';

// ASSUMPTION: the task defines no persistent entities, so this product has no
// Prisma schema and no migrations; everything the pipeline needs arrives in
// the request.
@Module({
  imports: [GuideModule],
})
export class AppModule {}
