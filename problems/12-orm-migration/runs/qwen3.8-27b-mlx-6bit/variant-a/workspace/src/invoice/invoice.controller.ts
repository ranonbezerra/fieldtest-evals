import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Query,
  BadRequestException,
} from '@nestjs/common';
import { InvoiceService, CreateInvoiceBody } from './invoice.service';

@Controller('invoices')
export class InvoiceController {
  constructor(private readonly invoiceService: InvoiceService) {}

  @Post()
  async create(@Body() body: CreateInvoiceBody) {
    if (!body || typeof body !== 'object') {
      throw new BadRequestException('Request body must be a JSON object');
    }

    if (typeof body.account_id !== 'string' || body.account_id.length === 0) {
      throw new BadRequestException(
        'account_id is required and must be a non-empty string',
      );
    }

    if (!Array.isArray(body.line_items) || body.line_items.length === 0) {
      throw new BadRequestException(
        'line_items is required and must be a non-empty array',
      );
    }

    for (const item of body.line_items) {
      if (!item || typeof item !== 'object') {
        throw new BadRequestException('Each line item must be an object');
      }
      if (
        typeof item.description !== 'string' ||
        item.description.length === 0
      ) {
        throw new BadRequestException(
          'Each line item must have a non-empty string description',
        );
      }
      if (
        typeof item.amount_cents !== 'string' ||
        !/^-?\d+$/.test(item.amount_cents)
      ) {
        throw new BadRequestException(
          'Each line item must have amount_cents as an integer string',
        );
      }
    }

    return this.invoiceService.create(body);
  }

  @Get(':id')
  async getById(@Param('id') id: string) {
    return this.invoiceService.getById(id);
  }

  @Get()
  async listByAccount(
    @Query('account_id') accountId: string,
    @Query('page') page?: string,
    @Query('page_size') pageSize?: string,
  ) {
    if (!accountId) {
      throw new BadRequestException('account_id query parameter is required');
    }

    let parsedPage: number | undefined;
    if (page !== undefined) {
      parsedPage = Number(page);
      if (!Number.isInteger(parsedPage) || parsedPage < 1) {
        throw new BadRequestException('page must be a positive integer');
      }
    }

    let parsedPageSize: number | undefined;
    if (pageSize !== undefined) {
      parsedPageSize = Number(pageSize);
      if (!Number.isInteger(parsedPageSize) || parsedPageSize < 1) {
        throw new BadRequestException('page_size must be a positive integer');
      }
    }

    return this.invoiceService.listByAccount(
      accountId,
      parsedPage,
      parsedPageSize,
    );
  }
}
