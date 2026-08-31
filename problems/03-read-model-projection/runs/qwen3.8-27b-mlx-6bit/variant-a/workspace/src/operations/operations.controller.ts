import {
  ArgumentsHost,
  Catch,
  Controller,
  ExceptionFilter,
  Get,
  HttpStatus,
  Query,
  UseFilters,
} from '@nestjs/common';

import { OperationReadModelService } from './operation-read-model.service';
import {
  InvalidParameterError,
  OperationsPage,
  OperationsQueryInput,
  ResourceNotFoundError,
} from './operation-read-model.types';

// Maps the domain errors raised on this endpoint to the single error envelope
// `{ "error": { code, message, details } }` with the matching HTTP status.
// `details` is always an object (empty here) and never null. Errors that are
// not one of the mapped domain errors are left to Nest's default handling.
@Catch(InvalidParameterError, ResourceNotFoundError)
class OperationErrorFilter implements ExceptionFilter {
  catch(
    exception: InvalidParameterError | ResourceNotFoundError,
    host: ArgumentsHost,
  ): void {
    const status =
      exception instanceof ResourceNotFoundError
        ? HttpStatus.NOT_FOUND
        : HttpStatus.BAD_REQUEST;
    const body = {
      error: {
        code: exception.code,
        message: exception.message,
        details: {},
      },
    };
    const response = host.switchToHttp().getResponse();
    response.status(status).json(body);
  }
}

@Controller('operations')
@UseFilters(new OperationErrorFilter())
export class OperationsController {
  constructor(private readonly service: OperationReadModelService) {}

  // GET /operations?companyId&status&fromDate&toDate&page&pageSize
  // Validates and coerces the raw query string, then serves the page entirely
  // from the projection via the service. The response shape is unchanged from
  // what operators currently see.
  @Get()
  async getOperations(
    @Query() query: Record<string, string | undefined>,
  ): Promise<OperationsPage> {
    return this.service.queryOperations(this.parseQuery(query));
  }

  // Coerces the raw query-string parameters into the typed dashboard input.
  // Missing or malformed values are rejected with `invalid_parameter` before
  // the service is called; range rules on the typed values stay in the service.
  private parseQuery(
    query: Record<string, string | undefined>,
  ): OperationsQueryInput {
    return {
      companyId: this.parseBigInt(query.companyId, 'companyId'),
      status: query.status && query.status.length > 0 ? query.status : undefined,
      fromDate: this.parseDate(query.fromDate, 'fromDate'),
      toDate: this.parseDate(query.toDate, 'toDate'),
      page: this.parsePositiveInt(query.page, 'page'),
      pageSize: this.parsePositiveInt(query.pageSize, 'pageSize'),
    };
  }

  private parseBigInt(value: string | undefined, field: string): bigint {
    if (value === undefined || !/^-?\d+$/.test(value)) {
      throw new InvalidParameterError(`${field} must be an integer`);
    }
    return BigInt(value);
  }

  private parsePositiveInt(value: string | undefined, field: string): number {
    if (value === undefined || !/^\d+$/.test(value)) {
      throw new InvalidParameterError(`${field} must be a positive integer`);
    }
    const parsed = Number(value);
    if (parsed < 1 || !Number.isSafeInteger(parsed)) {
      throw new InvalidParameterError(`${field} must be a positive integer`);
    }
    return parsed;
  }

  private parseDate(value: string | undefined, field: string): Date | undefined {
    if (value === undefined) {
      return undefined;
    }
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      throw new InvalidParameterError(`${field} must be a valid ISO-8601 date`);
    }
    return parsed;
  }
}
