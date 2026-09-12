import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../auth/auth.guard.js';
import { CurrentUser } from '../../auth/current-user.decorator.js';
import type { CurrentUserPayload } from '../../auth/types.js';
import { ApiResult, type ApiOk } from '../../common/api-result.js';
import { AppError } from '../../common/app-error.js';
import { createTripSchema } from './dto/create-trip.dto.js';
import { inviteSchema } from './dto/invite.dto.js';
import { TripsService } from './trips.service.js';
import type { Trip } from './entities/trip.entity.js';
import type { Invite } from './entities/invite.entity.js';

@Controller('trips')
@UseGuards(AuthGuard)
export class TripsController {
  constructor(private readonly svc: TripsService) {}

  @Post()
  async create(
    @Body() body: unknown,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<ApiOk<Trip>> {
    const parsed = createTripSchema.safeParse(body);
    if (!parsed.success) {
      throw AppError.validation('invalid body', { issues: parsed.error.issues });
    }
    const dto = parsed.data;
    const trip = await this.svc.createTrip(dto, user);
    return ApiResult.ok(trip);
  }

  @Post(':id/invites')
  async invite(
    @Param('id') tripId: string,
    @Body() body: unknown,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<ApiOk<Invite>> {
    const parsed = inviteSchema.safeParse(body);
    if (!parsed.success) {
      throw AppError.validation('invalid body', { issues: parsed.error.issues });
    }
    const dto = parsed.data;
    const invite = await this.svc.invite(tripId, dto, user);
    return ApiResult.ok(invite);
  }

  @Get(':id')
  async get(
    @Param('id') tripId: string,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<ApiOk<Trip>> {
    const trip = await this.svc.getTrip(tripId, user);
    return ApiResult.ok(trip);
  }
}
