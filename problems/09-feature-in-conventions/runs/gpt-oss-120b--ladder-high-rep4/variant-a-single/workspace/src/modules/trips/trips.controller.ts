import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../auth/auth.guard.js';
import { CurrentUser } from '../../auth/current-user.decorator.js';
import type { CurrentUserPayload } from '../../auth/types.js';
import { ApiResult, type ApiOk } from '../../common/api-result.js';
import { AppError } from '../../common/app-error.js';
import { createTripSchema, type CreateTripDto } from './dto/create-trip.dto.js';
import { createInviteSchema, type CreateInviteDto } from './dto/create-invite.dto.js';
import type { Trip } from './entities/trip.entity.js';
import type { Invite } from './entities/invite.entity.js';
import type { TripDetails } from './entities/trip-details.entity.js';
import { TripsService } from './trips.service.js';

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
    return ApiResult.ok(await this.trips.create(dto, user.id));
  }

  @Post(':id/invites')
  @UseGuards(AuthGuard)
  async invite(
    @Param('id') tripId: string,
    @Body() body: unknown,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<ApiOk<Invite>> {
    const parsed = createInviteSchema.safeParse(body);
    if (!parsed.success) {
      throw AppError.validation('invalid body', { issues: parsed.error.issues });
    }
    const dto: CreateInviteDto = parsed.data;
    return ApiResult.ok(await this.trips.invite(tripId, dto.email, user.id));
  }

  @Get(':id')
  @UseGuards(AuthGuard)
  async get(
    @Param('id') tripId: string,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<ApiOk<TripDetails>> {
    return ApiResult.ok(await this.trips.getDetails(tripId, user.id));
  }
}
