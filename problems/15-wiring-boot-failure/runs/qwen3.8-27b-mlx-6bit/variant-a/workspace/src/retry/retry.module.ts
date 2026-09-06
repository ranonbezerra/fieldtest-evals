import { Module } from '@nestjs/common';
import { RetryProcessor } from './retry.processor.js';

// ASSUMPTION: The plan places RetryProcessor at src/retry/retry.processor.ts, but the file currently resides at src/jobs/retry.processor.ts. The import above follows the plan; the file must be relocated for this module to resolve.

@Module({
  providers: [RetryProcessor],
  exports: [RetryProcessor],
})
export class RetryModule {}
