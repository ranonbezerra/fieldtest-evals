import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import { AuthGuard } from '../../auth/auth.guard.js';
import { CurrentUser } from '../../auth/current-user.decorator.js';
import type { CurrentUserPayload } from '../../auth/types.js';
import { ApiResult, type ApiOk } from '../../common/api-result.js';
import { AppError } from '../../common/app-error.js';
import { createTripSchema, type CreateTripDto } from './dto/create-trip.dto.js';
import { inviteSchema, type InviteDto } from './dto/invite.dto.js';
import type { Trip } from './entities/trip.entity.js';
import type { Invite } from './entities/invite.entity.js';
import type { Member } from './entities/member.entity.js';
import { TripsService } from './trips.service.js';

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
    const trip = await this.trips.create(dto, user.id);
    return ApiResult.ok(trip);
  }

  @Post(':id/invites')
  @UseGuards(AuthGuard)
  async invite(
    @Param('id', new ParseUUIDPipe()) tripId: string,
    @Body() body: unknown,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<ApiOk<Invite>> {
    const parsed = inviteSchema.safeParse(body);
    if (!parsed.success) {
      throw AppError.validation('invalid body', { issues: parsed.error.issues });
    }
    const dto: InviteDto = parsed.data;
    const invite = await this.trips.invite(tripId, dto.email, user.id);
    return ApiResult.ok(invite);
  }

  @Post('invites/:token/accept')
  @UseGuards(AuthGuard)
  async acceptInvite(
    @Param('token') token: string,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<ApiOk<Member>> {
    const member = await this.trips.acceptInvite(token, user.id);
    return ApiResult.ok(member);
  }

  @Get(':id')
  @UseGuards(AuthGuard)
  async getTrip(
    @Param('id', new ParseUUIDPipe()) tripId: string,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<ApiOk<Trip>> {
    const trip = await this.trips.getTrip(tripId, user.id);
    return ApiResult.ok(trip);
  }
}
