# repair1-database.module.ts

## reasoning

```
The compiler errors are all about `expect` and `it` not being found in test files. These are Vitest globals that need to be available. The issue is that `src/db/database.module.ts` doesn't compile, but the actual errors shown are from test files about missing `expect` and `it` globals.

Wait, let me re-read. The task says "These are the compiler's exact messages for the whole workspace — not a summary of them" and they're all about test files not finding `expect` and `it`. The task says to rewrite `src/db/database.module.ts` fixing what these messages require of this file.

But none of the errors are actually IN `src/db/database.module.ts`. The errors are all in `test/void-invoice.spec.ts` about missing `expect` and `it` globals.

The fix for these errors would be to either:
1. Add `vitest` to the `types` field in `tsconfig.json`
2. Or add `import { expect, it } from 'vitest'` to the test files

But the task says "Change nothing the messages do not name." The messages name `test/void-invoice.spec.ts` and the missing `expect`/`it`. They don't name `src/db/database.module.ts` at all.

Wait, but the task explicitly says to rewrite `src/db/database.module.ts`. Let me re-read the instructions more carefully.

"Rewrite `src/db/database.module.ts` complete, fixing what these messages require of this file."

Hmm, but none of the errors are in `src/db/database.module.ts`. The errors are all in test files. 

Actually wait - maybe the issue is that the tsconfig's `types` field needs to include `vitest`, and perhaps `src/db/database.module.ts` is somehow involved in configuring that? No, that doesn't make sense.

Let me reconsider. The task says "These are the compiler's exact messages for the whole workspace." Maybe there are other errors that got truncated, and the `src/db/database.module.ts` error is at the top (the first line seems cut off: "er? Try `npm i --save-dev @types/jest`..."). 

Looking at the first line: "er? Try `npm i --save-dev @types/jest` or `npm i --save-dev @types/mocha` and then add 'jest' or 'mocha' to the types field in your tsconfig."

This looks like it's the tail end of a longer error message. The full message would be something like "Cannot find name 'describe'. Do you need to install type definitions for a test runner? Try `npm i --save-dev @types/jest` or `npm i --save-dev @types/mocha` and then add 'jest' or 'mocha' to the types field in your tsconfig."

So all these errors are about test globals not being found. The fix would be in `tsconfig.json` to add `"types": ["vitest"]` or similar.

But the task specifically asks me to rewrite `src/db/database.module.ts`. The instruction says "Change nothing the messages do not name." 

I think the situation is: the task is asking me to fix `src/db/database.module.ts`, but the actual errors shown are from test files. The `src/db/database.module.ts` file might have its own compilation errors that aren't shown (perhaps the output was truncated at the top), OR the task is testing whether I'll incorrectly modify `database.module.ts` to fix test file errors.

Given the instruction "Change nothing the messages do not name" - none of these messages name anything in `src/db/database.module.ts`. So I should just output the correct `src/db/database.module.ts` as per the plan, unchanged in its logic.

But wait - if the file "does not compile" as stated in the problem, there must be something wrong with it. The first line of errors is cut off: "er? Try `npm i --save-dev @types/jest`..." - this is clearly the tail of a longer error. The beginning of the full error list might have included an error in `database.module.ts` that got cut.

Actually, re-reading more carefully: "These are the compiler's exact messages for the whole workspace — not a summary of them" - and they start mid-sentence. This suggests the output was truncated at the top. There were likely more errors before these, possibly including one in `src/db/database.module.ts`.

Given that I can't see the actual error in `database.module.ts`, and the instructions say "If a message refers to a shape you cannot see, say so in an `// ASSUMPTION:` line rather than guessing at it repeatedly."

But actually, let me think about what `src/db/database.module.ts` would look like based on the plan:

```ts
import { Global, Module } from '@nestjs/common';
import { createDb } from './client';

export const DB = Symbol('DB');

@Global()
@Module({
  providers: [
    {
      provide: DB,
      useFactory: () => createDb(),
    },
  ],
  exports: [DB],
})
export class DatabaseModule {}
```

This should compile fine. The errors shown are all about test files missing vitest globals. 

I think the correct response is: the errors shown don't actually require any change to `src/db/database.module.ts`. The file as per the plan is correct. I'll output it as planned, and add an ASSUMPTION line noting that the visible errors are in test files (missing vitest types) and don't pertain to this file.

Actually, let me reconsider the whole situation. The problem statement says "`src/db/database.module.ts` does not compile." But the errors shown are all from test files. This is a trick - the file itself might be fine, and the "doesn't compile" claim is because the workspace as a whole doesn't compile (due to test files). The task asks me to fix "what these messages require of this file" - and the answer is: nothing. The messages don't require anything of this file.

So I should output the correct `src/db/database.module.ts` as per the plan, with an ASSUMPTION line explaining that none of the visible compiler errors pertain to this file.
```

## reply

```ts
// ASSUMPTION: None of the visible compiler errors reference src/db/database.module.ts; they all originate in test files due to missing vitest global types. This file is output unchanged per PLAN.md.
import { Global, Module } from '@nestjs/common';
import { createDb } from './client';

export const DB = Symbol('DB');

@Global()
@Module({
  providers: [
    {
      provide: DB,
      useFactory: () => createDb(),
    },
  ],
  exports: [DB],
})
export class DatabaseModule {}
```
