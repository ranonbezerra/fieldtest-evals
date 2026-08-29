import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../auth/auth.guard.js';
import { CurrentUser } from '../../auth/current-user.decorator.js';
import type { CurrentUserPayload } from '../../auth/types.js';
import { ApiResult, type ApiOk } from '../../common/api-result.js';
import { AppError } from '../../common/app-error.js';
import { createUserSchema, type CreateUserDto } from './dto/create-user.dto.js';
import type { User } from './entities/user.entity.js';
import { UsersService } from './users.service.js';

/**
 * Thin by rule: validate, call the service, wrap in the envelope.
 * No Drizzle, no business logic, no ORM type in any signature.
 */
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Post()
  async create(@Body() body: unknown): Promise<ApiOk<User>> {
    const parsed = createUserSchema.safeParse(body);
    if (!parsed.success) {
      throw AppError.validation('invalid body', { issues: parsed.error.issues });
    }
    const dto: CreateUserDto = parsed.data;
    return ApiResult.ok(await this.users.create(dto));
  }

  @Get('me')
  @UseGuards(AuthGuard)
  async me(@CurrentUser() user: CurrentUserPayload): Promise<ApiOk<User>> {
    return ApiResult.ok(await this.users.getById(user.id));
  }
}
