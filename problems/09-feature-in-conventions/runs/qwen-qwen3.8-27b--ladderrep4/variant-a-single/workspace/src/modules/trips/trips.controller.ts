import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../auth/auth.guard.js';
import { CurrentUser } from '../../auth/current-user.decorator.js';
import type { CurrentUserPayload } from '../../auth/types.js';
import { ApiResult, type ApiOk } from '../../common/api-result.js';
import { AppError } from '../../common/app-error.js';
import { createInviteSchema, type CreateInviteDto } from './dto/create-invite.dto.js';
import { createTripSchema, type CreateTripDto } from './dto/create-trip.dto.js';
import type { Invite } from './entities/invite.entity.js';
import type { TripMember } from './entities/member.entity.js';
import type { Trip, TripDetail } from './entities/trip.entity.js';
import { TripsService } from './trips.service.js';

/**
 * Thin by rule: validate, call the service, wrap in the envelope.
 * No Drizzle, no business logic, no ORM type in any signature.
 */
@Controller('trips')
export class TripsController {
  constructor(private readonly trips: TripsService) {}

  @Post()
  @UseGuards(AuthGuard)
  async create(
    @CurrentUser() user: CurrentUserPayload,
    @Body() body: unknown,
  ): Promise<ApiOk<Trip>> {
    const parsed = createTripSchema.safeParse(body);
    if (!parsed.success) {
      throw AppError.validation('invalid body', { issues: parsed.error.issues });
    }
    const dto: CreateTripDto = parsed.data;
    return ApiResult.ok(await this.trips.create(dto, user));
  }

  @Get(':id')
  @UseGuards(AuthGuard)
  async get(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<ApiOk<TripDetail>> {
    return ApiResult.ok(await this.trips.get(id, user));
  }

  @Post(':id/invites')
  @UseGuards(AuthGuard)
  async invite(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
    @Body() body: unknown,
  ): Promise<ApiOk<Invite>> {
    const parsed = createInviteSchema.safeParse(body);
    if (!parsed.success) {
      throw AppError.validation('invalid body', { issues: parsed.error.issues });
    }
    const dto: CreateInviteDto = parsed.data;
    return ApiResult.ok(await this.trips.invite(id, dto, user));
  }
}

/**
 * Invite tokens are a different resource root, but the same feature, so they
 * live in this module and this file.
 */
@Controller('invites')
export class InvitesController {
  constructor(private readonly trips: TripsService) {}

  @Post(':token/accept')
  @UseGuards(AuthGuard)
  async accept(
    @Param('token') token: string,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<ApiOk<TripMember>> {
    return ApiResult.ok(await this.trips.acceptInvite(token, user));
  }
}
