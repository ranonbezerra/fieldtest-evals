import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../auth/auth.guard.js';
import { CurrentUser } from '../../auth/current-user.decorator.js';
import type { CurrentUserPayload } from '../../auth/types.js';
import { ApiResult, type ApiOk } from '../../common/api-result.js';
import { AppError } from '../../common/app-error.js';
import { createInviteSchema, type CreateInviteDto } from './dto/create-invite.dto.js';
import { createTripSchema, type CreateTripDto } from './dto/create-trip.dto.js';
import type { Trip, TripInvite, TripMember } from './entities/trip.entity.js';
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
  async create(@Body() body: unknown, @CurrentUser() user: CurrentUserPayload): Promise<ApiOk<Trip>> {
    const parsed = createTripSchema.safeParse(body);
    if (!parsed.success) {
      throw AppError.validation('invalid body', { issues: parsed.error.issues });
    }
    const dto: CreateTripDto = parsed.data;
    return ApiResult.ok(await this.trips.createTrip(dto, user));
  }

  @Post(':id/invites')
  @UseGuards(AuthGuard)
  async invite(
    @Param('id') tripId: string,
    @Body() body: unknown,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<ApiOk<TripInvite>> {
    const parsed = createInviteSchema.safeParse(body);
    if (!parsed.success) {
      throw AppError.validation('invalid body', { issues: parsed.error.issues });
    }
    const dto: CreateInviteDto = parsed.data;
    return ApiResult.ok(await this.trips.createInvite(tripId, dto, user));
  }

  @Get(':id')
  @UseGuards(AuthGuard)
  async get(@Param('id') tripId: string, @CurrentUser() user: CurrentUserPayload): Promise<ApiOk<Trip>> {
    return ApiResult.ok(await this.trips.getTrip(tripId, user));
  }
}

/** Accepts are addressed by invite token, so this route lives outside `/trips`. */
@Controller('invites')
export class InvitesController {
  constructor(private readonly trips: TripsService) {}

  @Post(':token/accept')
  @UseGuards(AuthGuard)
  async accept(@Param('token') token: string, @CurrentUser() user: CurrentUserPayload): Promise<ApiOk<TripMember>> {
    return ApiResult.ok(await this.trips.acceptInvite(token, user));
  }
}
