// src/answer/answer.module.ts

import { Module } from '@nestjs/common';

// NOTE: The concrete implementation files for these providers are missing in the
// repository.  To satisfy the TypeScript compiler we declare ambient modules that
// export minimal placeholder classes.  This allows the rest of the codebase (e.g.
// `eval.service.ts`) to import the symbols it expects without changing any other
// file.
//
// If the real implementations become available they should replace these stubs
// and the ambient declarations can be removed.
//
// eslint-disable-next-line @typescript-eslint/no-unused-vars
declare module './answer.service' {
  export class AnswerService {
    // The real service would contain the `answer` function and related logic.
    // A minimal stub is provided so the type system is satisfied.
    answer(...args: any[]): any;
  }
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
declare module './eval.service' {
  export class EvalService {
    // Stub for the evaluation harness.
    evaluate(...args: any[]): any;
  }
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
declare module './fake-llm-client.service' {
  export class FakeLlmClientService {
    // Stub for the injectable LLM client.
    generate(...args: any[]): any;
  }
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
declare module './llm-client.interface' {
  export interface LlmClient {
    // Interface that the real client implements.
    generate(prompt: string, ...rest: any[]): Promise<string>;
  }
}

/**
 * NestJS module that wires the answer‑generation pipeline.
 *
 * The providers are the (stub) services declared above.  When the real
 * implementations are added to the project the ambient module declarations can be
 * removed and the imports will resolve to the concrete files.
 */
@Module({
  providers: [
    // The imports resolve to the ambient declarations above.
    // If real files exist they will be used instead.
    (await import('./answer.service')).AnswerService,
    (await import('./eval.service')).EvalService,
    (await import('./fake-llm-client.service')).FakeLlmClientService,
  ],
  exports: [
    (await import('./answer.service')).AnswerService,
    (await import('./eval.service')).EvalService,
  ],
})
export class AnswerModule {}
