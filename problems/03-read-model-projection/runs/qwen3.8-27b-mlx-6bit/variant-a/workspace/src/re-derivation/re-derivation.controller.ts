import { Controller, Post, Body } from '@nestjs/common';
import type { ReDeriveInput } from '../operations/operations.types.js';
import { ReDerivationService } from './re-derivation.service.js';

@Controller()
export class ReDerivationController {
  constructor(private readonly service: ReDerivationService) {}

  @Post('operations/re-derive')
  reDerive(@Body() input: ReDeriveInput): Promise<{ rows_rewritten: number }> {
    return this.service.reDerive(input);
  }
}
