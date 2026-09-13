import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../auth/auth.guard.js';
import { CurrentUser } from '../../auth/current-user.decorator.js';
import type { CurrentUserPayload } from '../../auth/types.js';
import { ApiResult, type ApiOk } from '../../common/api-result.js';
import { AppError } from '../../common/app-error.js';
import type { CreateTripDto } from './dto/create-trip.dto.js';
import type { InviteDto } from './dto/invite.dto.js';
import { createTripSchema } from './dto/create-trip.dto.js';
import { inviteSchema } from './dto/invite.dto.js';
import type { TripDetail } from './entities/trip.entity.js';
import type { Trip } from './entities/trip.entity.js';
import type { Invite } from './entities/invite.entity.js';
import type { TripMember } from './entities/trip-member.entity.js';
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
    @Body() body: unknown,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<ApiOk<Trip>> {
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
    @Param('id') id: string,
    @Body() body: unknown,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<ApiOk<Invite>> {
    const parsed = inviteSchema.safeParse(body);
    if (!parsed.success) {
      throw AppError.validation('invalid body', { issues: parsed.error.issues });
    }
    const dto: InviteDto = parsed.data;
    return ApiResult.ok(await this.trips.invite(id, user.id, dto.email));
  }

  @Get(':id')
  @UseGuards(AuthGuard)
  async getById(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<ApiOk<TripDetail>> {
    return ApiResult.ok(await this.trips.getById(id, user.id));
  }
}
