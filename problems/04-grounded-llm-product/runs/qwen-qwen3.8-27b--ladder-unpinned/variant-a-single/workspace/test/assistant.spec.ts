import { describe, it, expect } from 'vitest';
import { isGrounded } from '../src/assistant/assistant.grounding';
import { ScriptedLlmClient } from '../src/assistant/assistant.llm-client';
// ASSUMPTION: ScriptedLlmClient accepts a single string response in its constructor and returns it on each generate() call.
import { redactForHint } from '../src/assistant/assistant.redaction';
// ASSUMPTION: redactForHint(answer, sources) returns a string with boss names, locations, and quantities redacted.
import { AssistantService } from '../src/assistant/assistant.service';
// ASSUMPTION: AssistantService constructor takes an LlmClient; answer() returns { text: string; refused: boolean }.

describe('AssistantService', () => {
  describe('grounding gate', () => {
    it('refuses a confident lie that is not grounded in sources', async () => {
      const sources = [
        'The village has a blacksmith and a tavern.',
        'The forest to the south is home to deer.',
      ];
      const llm = new ScriptedLlmClient(
        'You need a Dragon Scale to enter the castle. It is found in the northern cave.'
      );
      const service = new AssistantService(llm);
      const result = await service.answer('How do I enter the castle?', sources, 'full');

      expect(result.refused).toBe(true);
    });

    it('returns a correct grounded answer without modification', async () => {
      const sources = [
        'The bridge to the east is made of stone.',
        'It has four arches and spans the river.',
      ];
      const llm = new ScriptedLlmClient('The bridge to the east is made of stone.');
      const service = new AssistantService(llm);
      const result = await service.answer('What is the bridge made of?', sources, 'full');

      expect(result.refused).toBe(false);
      expect(result.text).toBe('The bridge to the east is made of stone.');
    });

    it('refuses when the sources do not contain the answer', async () => {
      const sources = [
        'The garden has roses and lilies.',
        'Water flows from the spring in the east.',
      ];
      const llm = new ScriptedLlmClient(
        'The final boss is defeated with the Sword of Light in the arena.'
      );
      const service = new AssistantService(llm);
      const result = await service.answer('How do I defeat the final boss?', sources, 'full');

      expect(result.refused).toBe(true);
    });

    it('catches a quantity error exactly (5 vs 4 shards)', async () => {
      const sources = [
        'You need 4 shards to complete the ritual at the altar.',
      ];
      const llm = new ScriptedLlmClient(
        'You need 5 shards to complete the ritual at the altar.'
      );
      const service = new AssistantService(llm);
      const result = await service.answer('How many shards do I need?', sources, 'full');

      expect(result.refused).toBe(true);
    });

    it('detects the quantity mismatch at the sentence level', () => {
      const sources = ['You need 4 shards to complete the ritual at the altar.'];
      const falseSentence = 'You need 5 shards to complete the ritual at the altar.';
      const trueSentence = 'You need 4 shards to complete the ritual at the altar.';

      expect(isGrounded(falseSentence, sources)).toBe(false);
      expect(isGrounded(trueSentence, sources)).toBe(true);
    });
  });

  describe('hint mode', () => {
    it('redacts boss names and locations in the returned answer', async () => {
      const sources = [
        'The boss Ashbringer guards the crystal in the east wing.',
        'You need 3 keys to open the door.',
      ];
      const llm = new ScriptedLlmClient(
        'The boss Ashbringer guards the crystal in the east wing. You need 3 keys to open the door.'
      );
      const service = new AssistantService(llm);
      const result = await service.answer('What do I need to get past the door?', sources, 'hint');

      expect(result.refused).toBe(false);
      expect(result.text).not.toContain('Ashbringer');
      expect(result.text).not.toContain('east wing');
    });

    it('redacts quantities and locations when called directly', () => {
      const answer = 'You need 3 keys to open the door in the east wing.';
      const sources = ['You need 3 keys to open the door in the east wing.'];
      const redacted = redactForHint(answer, sources);

      expect(redacted).not.toContain('3 keys');
      expect(redacted).not.toContain('east wing');
    });
  });
});
