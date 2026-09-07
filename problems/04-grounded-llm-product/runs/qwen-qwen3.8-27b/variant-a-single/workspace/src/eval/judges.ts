import { GroundingGate, LexicalGroundingGate, extractAtoms, normalize } from '../answer/grounding-gate.js';
import { isRefusal } from '../answer/refusal.js';

/**
 * Faithfulness: does the answer say only what the sources support?
 * The judge receives the sources. Refusals are vacuously faithful; a planted
 * false fact that survives in the text is a hard zero; otherwise the score is
 * the fraction of factual atoms supported by the sources.
 */
export class FaithfulnessJudge {
  constructor(private readonly gate: GroundingGate = new LexicalGroundingGate()) {}

  judge(answer: string, sources: string[], options: { plantedFalseFacts?: string[] } = {}): number {
    if (isRefusal(answer)) return 1;

    const lowered = normalize(answer);
    for (const planted of options.plantedFalseFacts ?? []) {
      if (lowered.includes(normalize(planted))) return 0;
    }

    const atoms = extractAtoms(answer);
    if (atoms.length === 0) return 1;
    const supported = atoms.filter((atom) => this.gate.isAtomSupported(atom, sources)).length;
    return supported / atoms.length;
  }
}

/**
 * Helpfulness: does the answer deliver the golden facts?
 * A scenario that expects a refusal scores 1 only when the service refused;
 * any refusal in a non-refusal scenario scores 0.
 */
export class HelpfulnessJudge {
  judge(answer: string, spec: { expectedFacts: string[]; expectRefusal?: boolean }): number {
    if (spec.expectRefusal) return isRefusal(answer) ? 1 : 0;
    if (isRefusal(answer)) return 0;

    const total = spec.expectedFacts.length;
    if (total === 0) return 0;
    const lowered = normalize(answer);
    const hits = spec.expectedFacts.filter((fact) => lowered.includes(normalize(fact))).length;
    return hits / total;
  }
}
