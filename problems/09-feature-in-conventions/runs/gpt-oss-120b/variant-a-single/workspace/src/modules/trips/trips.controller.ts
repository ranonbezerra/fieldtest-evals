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
import { inviteDtoSchema, type InviteDto } from './dto/invite.dto.js';
import type { Trip } from './entities/trip.entity.js';
import { TripsService } from './trips.service.js';

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
    return ApiResult.ok(await this.trips.create(dto, user.id));
  }

  @Post(':id/invites')
  @UseGuards(AuthGuard)
  async invite(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id', new ParseUUIDPipe()) tripId: string,
    @Body() body: unknown,
  ): Promise<ApiOk<{ token: string; status: string }>> {
    const parsed = inviteDtoSchema.safeParse(body);
    if (!parsed.success) {
      throw AppError.validation('invalid body', { issues: parsed.error.issues });
    }
    const dto: InviteDto = parsed.data;
    const invite = await this.trips.invite(tripId, dto.email, user.id);
    return ApiResult.ok({ token: invite.token, status: invite.status });
  }

  @Post('invites/:token/accept')
  @UseGuards(AuthGuard)
  async accept(
    @CurrentUser() user: CurrentUserPayload,
    @Param('token') token: string,
  ): Promise<ApiOk<{ memberId: string }>> {
    const member = await this.trips.acceptInvite(token, user.id);
    return ApiResult.ok({ memberId: member.id });
  }

  @Get(':id')
  @UseGuards(AuthGuard)
  async get(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id', new ParseUUIDPipe()) tripId: string,
  ): Promise<ApiOk<Trip>> {
    return ApiResult.ok(await this.trips.getTrip(tripId, user.id));
  }
}
