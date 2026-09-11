import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { EvalModule } from './eval/eval.module.js';
import { GuideModule } from './guide/guide.module.js';

// ASSUMPTION: the task defines a service-level pipeline (answer + eval harness)
// with no HTTP surface and no persistence, so there is no controller, no
// main.ts, and no Prisma/Postgres layer to wire here.
@Module({
  imports: [GuideModule, EvalModule],
})
export class AppModule {}
