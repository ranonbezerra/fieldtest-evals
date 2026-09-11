import 'reflect-metadata';
import { Injectable } from '@nestjs/common';
import { GuideService } from '../guide/guide.service.js';
import type { GoldenScenario } from './golden-scenarios.js';
import { scoreFaithfulness, scoreHelpfulness } from './judges.js';

export interface ScenarioReport {
  id: string;
  status: 'answered' | 'refused';
  output: string;
  helpful: number;
  faithful: number;
  /** min(helpful, faithful) — see runScenario. */
  score: number;
}

export interface EvalReport {
  scenarios: ScenarioReport[];
  meanScore: number;
}

@Injectable()
export class EvalService {
  constructor(private readonly guide: GuideService) {}

  async runScenario(scenario: GoldenScenario): Promise<ScenarioReport> {
    const result = await this.guide.answer(scenario.question, scenario.sources, 'full');
    const helpful = scoreHelpfulness(result, scenario);
    const faithful = scoreFaithfulness(result, scenario.sources, scenario);
    // min, not average: averaging lets a fluent lie hide behind a good
    // helpfulness score — and a confident useless refusal behind a perfect
    // faithfulness score.
    const score = Math.min(helpful, faithful);
    return {
      id: scenario.id,
      status: result.status,
      output: result.text,
      helpful,
      faithful,
      score,
    };
  }

  async run(scenarios: GoldenScenario[]): Promise<EvalReport> {
    const rows = await Promise.all(scenarios.map((scenario) => this.runScenario(scenario)));
    const meanScore =
      rows.length === 0 ? 0 : rows.reduce((sum, row) => sum + row.score, 0) / rows.length;
    return { scenarios: rows, meanScore };
  }
}
