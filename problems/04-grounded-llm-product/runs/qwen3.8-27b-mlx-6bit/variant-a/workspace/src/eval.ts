import type { LlmClient } from "./llm-client.js";
import { answer } from "./answer.js";
import { groundAnswer, splitSentences, tokenSet, isGrounded } from "./grounding.js";

export interface Scenario {
  id: string;
  question: string;
  sources: string[];
  expectedFacts: string[];
  plantedFalseFacts: string[];
  redactTokens: string[];
}

export interface JudgeResult {
  helpfulness: number;
  faithfulness: number;
  score: number;
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function judgeHelpfulness(answerText: string, expectedFacts: string[]): number {
  if (expectedFacts.length === 0) {
    return 1;
  }

  const normalizedAnswer = normalize(answerText);
  let present = 0;

  for (const fact of expectedFacts) {
    const normalizedFact = normalize(fact);
    if (normalizedFact.length > 0 && normalizedAnswer.includes(normalizedFact)) {
      present += 1;
    }
  }

  return present / expectedFacts.length;
}

export function judgeFaithfulness(
  answerText: string,
  sources: string[],
  plantedFalseFacts: string[]
): number {
  if (sources.length === 0) {
    return 0;
  }

  const grounded = groundAnswer(answerText, sources);
  if (grounded.refused) {
    return 0;
  }

  const sourceTokens = new Set<string>();
  for (const source of sources) {
    for (const token of tokenSet(source)) {
      sourceTokens.add(token);
    }
  }

  const sentences = splitSentences(answerText);
  for (const sentence of sentences) {
    if (!isGrounded(sentence, sourceTokens)) {
      return 0;
    }
  }

  const normalizedAnswer = normalize(answerText);
  for (const fact of plantedFalseFacts) {
    const normalizedFact = normalize(fact);
    if (normalizedFact.length > 0 && normalizedAnswer.includes(normalizedFact)) {
      return 0;
    }
  }

  return 1;
}

export async function evaluateScenario(
  scenario: Scenario,
  llm: LlmClient
): Promise<JudgeResult> {
  const result = await answer(
    { question: scenario.question, sources: scenario.sources, mode: "full" },
    llm
  );

  const helpfulness = judgeHelpfulness(result.text, scenario.expectedFacts);
  const faithfulness = judgeFaithfulness(
    result.text,
    scenario.sources,
    scenario.plantedFalseFacts
  );

  return {
    helpfulness,
    faithfulness,
    score: Math.min(helpfulness, faithfulness),
  };
}
