import { Injectable } from '@nestjs/common';

export interface RiskEvaluation {
  decision: 'ALLOW' | 'BLOCK';
  score: number;
}

@Injectable()
export class RiskClient {
  async evaluate(params: { from: string; to: string; amount: string }): Promise<RiskEvaluation> {
    throw new Error('Not implemented');
  }
}
