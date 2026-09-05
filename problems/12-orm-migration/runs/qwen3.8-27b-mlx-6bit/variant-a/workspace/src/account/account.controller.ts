import { Body, Controller, Get, NotFoundException, Param, Post } from '@nestjs/common';
import type { Response } from 'express';

import { AccountService } from './account.service';

@Controller('accounts')
export class AccountController {
  constructor(private readonly service: AccountService) {}

  @Get(':id')
  async getById(@Param('id') id: string, @Res() res: Response): Promise<void> {
    try {
      const result = await this.service.findById(id);
      res.status(200).json(result);
    } catch (err: unknown) {
      this.sendError(res, err);
    }
  }

  @Post()
  async create(@Body() body: Record<string, unknown>, @Res() res: Response): Promise<void> {
    if (!body || typeof body.name !== 'string' || (body.name as string).trim().length === 0) {
      res.status(400).json({
        error: {
          code: 'validation_error',
          message: 'Body must contain a non-empty string field "name".',
          details: {},
        },
      });
      return;
    }

    try {
      const result = await this.service.create({ name: body.name as string });
      res.status(201).json(result);
    } catch (err: unknown) {
      this.sendError(res, err);
    }
  }

  private sendError(res: Response, err: unknown): void {
    if (err instanceof NotFoundException) {
      res.status(404).json({
        error: {
          code: 'resource_not_found',
          message: err.message,
          details: {},
        },
      });
      return;
    }

    res.status(500).json({
      error: {
        code: 'internal_error',
        message: 'An unexpected error occurred.',
        details: {},
      },
    });
  }
}
