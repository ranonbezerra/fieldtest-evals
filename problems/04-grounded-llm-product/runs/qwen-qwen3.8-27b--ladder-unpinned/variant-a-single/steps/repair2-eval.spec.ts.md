# repair2-eval.spec.ts

## reasoning

```
The task is to rewrite `test/eval.spec.ts` to fix the compiler errors that pertain to this file. Let me look at the errors specific to `test/eval.spec.ts`:

```
test/eval.spec.ts(2,34): error TS2307: Cannot find module '../
```

## reply

```typescript
import { describe, it, expect } from 'vitest';
import { AssistantService } from '../src/assistant/assistant.service';
import { runEval } from '../src/eval/eval.harness';
import { goldenScenarios } from '../src/eval/eval.golden-scenarios';
import { faithfulnessJudge, helpfulnessJudge } from '../src/eval/eval.judges';
import type { LlmClient } from '../src/assistant/assistant.llm-client';

describe('eval harness', () => {
  describe('score = min(helpfulness, faithfulness)', () => {
    it('a correct grounded answer scores high', async () => {
      const llm: LlmClient = {
        generate: async () =>
          'The player needs 4 shards to unlock the gate. The shards are found in the north cavern.',
      };
      const service = new AssistantService(llm);
      const scenario = goldenScenarios.find((s) => s.id === 'correct-grounded')!;

      const result = await runEval(scenario, service, llm);

      expect(result.score).toBeGreaterThan(0.7);
      expect(result.score).toBe(Math.min(result.helpfulness, result.faithfulness));
    });

    it('a scripted confident-lie answer scores low', async () => {
      const llm: LlmClient = {
        generate: async () =>
          'The player needs 7 obsidian crystals to open the vault. The crystals are hidden in the southern ruins.',
      };
      const service = new AssistantService(llm);
      const scenario = goldenScenarios.find((s) => s.id === 'confident-lie')!;

      const result = await runEval(scenario, service, llm);

      expect(result.score).toBeLessThan(0.3);
      expect(result.faithfulness).toBeLessThan(0.3);
    });

    it('a scenario whose sources lack the answer yields refusal', async () => {
      const llm: LlmClient = {
        generate: async () =>
          'The player needs 4 shards to unlock the gate. The shards are found in the north cavern.',
      };
      const service = new AssistantService(llm);
      const scenario = goldenScenarios.find((s) => s.id === 'not-covered')!;

      const result = await runEval(scenario, service, llm);

      expect(result.refused).toBe(true);
      expect(result.score).toBe(0);
    });

    it('quantity errors are caught exactly', async () => {
      const llm: LlmClient = {
        generate: async () =>
          'The player needs 5 shards to unlock the gate. The shards are found in the north cavern.',
      };
      const service = new AssistantService(llm);
      const scenario = goldenScenarios.find((s) => s.id === 'quantity-error')!;

      const result = await runEval(scenario, service, llm);

      expect(result.faithfulness).toBe(0);
      expect(result.score).toBe(0);
    });
  });
});
```
