import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { MethodologyService, RuleEntry } from './methodology.service.js';
import { Errors } from '../common/errors.js';

@Controller('methodologies')
export class MethodologyController {
  constructor(private readonly service: MethodologyService) {}

  @Get('active')
  async getActive() {
    const active = await this.service.getActive();
    if (!active) {
      throw Errors.notFound('Methodology version', { detail: 'no active version' });
    }
    return active;
  }

  @Get(':version')
  async getVersion(@Param('version') version: string) {
    return this.service.getVersion(version);
  }

  @Post('publish')
  async publish(
    @Body() body: { version: string; rules: RuleEntry[] },
  ) {
    if (!body?.version) {
      throw Errors.invalidInput('version is required.', { field: 'version' });
    }
    if (!Array.isArray(body.rules)) {
      throw Errors.invalidInput('rules must be an array.', { field: 'rules' });
    }
    for (const rule of body.rules) {
      if (!rule.ingredientId || !rule.severity || !rule.flag || !rule.source) {
        throw Errors.invalidInput(
          'Each rule requires ingredientId, severity, flag, and source.',
          { rule },
        );
      }
    }
    return this.service.publish(body.version, body.rules);
  }

  @Post('rescore')
  async rescore() {
    await this.service.rescoreAll();
    return { status: 'ok' };
  }
}
