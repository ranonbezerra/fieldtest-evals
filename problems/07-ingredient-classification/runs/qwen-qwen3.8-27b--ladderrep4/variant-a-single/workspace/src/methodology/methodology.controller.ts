import { Body, Controller, Inject, Param, Post } from '@nestjs/common';
import { InvalidRequestError } from '../common/errors.js';
import { asRecord, optionalString, requireString, requiredPositiveInt } from '../common/validate.js';
import { SEVERITIES, type Severity } from '../classification/classification.service.js';
import {
  type CreateMethodologyResult,
  type CreateRuleInput,
  type PublishResult,
  MethodologyService,
} from './methodology.service.js';

@Controller('methodology-versions')
export class MethodologyController {
  constructor(@Inject(MethodologyService) private readonly service: MethodologyService) {}

  @Post()
  async create(@Body() body: unknown): Promise<CreateMethodologyResult> {
    const record = asRecord(body, 'body');
    const version = requiredPositiveInt(record, 'version');
    const name = optionalString(record, 'name');
    const rulesRaw = record['rules'];
    if (!Array.isArray(rulesRaw)) {
      throw new InvalidRequestError("'rules' is required and must be an array.", { field: 'rules' });
    }
    const rules: CreateRuleInput[] = rulesRaw.map((entry, index) => {
      const ruleRecord = asRecord(entry, `rules[${index}]`);
      const ingredientId = requireString(ruleRecord, 'ingredientId');
      const severity = ruleRecord['severity'];
      if (typeof severity !== 'string' || !SEVERITIES.includes(severity as Severity)) {
        throw new InvalidRequestError(`rules[${index}].severity must be one of: banned, restricted, watch.`, {
          field: `rules[${index}].severity`,
        });
      }
      const sourceCitation = requireString(ruleRecord, 'sourceCitation');
      return { ingredientId, severity: severity as Severity, sourceCitation };
    });
    return this.service.create({ version, name, rules });
  }

  @Post(':id/publish')
  async publish(@Param('id') id: string): Promise<PublishResult> {
    return this.service.publish(id);
  }
}
