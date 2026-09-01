import { BadRequestException, Injectable } from '@nestjs/common';
import type {
  OperationPage,
  OperationQueryParams,
} from '../projections/projections.types.js';
import { OperationsRepository } from './operations.repository.js';

const MAX_PAGE_SIZE = 100;

@Injectable()
export class OperationsService {
  constructor(private readonly repo: OperationsRepository) {}

  async query(params: OperationQueryParams): Promise<OperationPage> {
    if (params.page < 1 || params.pageSize > MAX_PAGE_SIZE) {
      // ASSUMPTION: neither the plan nor the references show how errors are mapped to the standard envelope; this service throws BadRequestException carrying the envelope object as its response body.
      throw new BadRequestException({
        error: {
          code: 'invalid_query_params',
          message: `Invalid query parameters: page must be >= 1 and pageSize must not exceed ${MAX_PAGE_SIZE}.`,
          details: { page: params.page, pageSize: params.pageSize },
        },
      });
    }

    return this.repo.findPage(params);
  }
}
