import { Module } from '@nestjs/common';

import { AssistantModule } from './assistant/assistant.module.js';

// ASSUMPTION: the assistant is stateless (the task asks for an answer
// pipeline and an eval harness, no persistence), so this build defines no
// Prisma data source, schema, or migration.
@Module({
  imports: [AssistantModule],
})
export class AppModule {}
