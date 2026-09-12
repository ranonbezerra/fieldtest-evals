import { Controller, Param, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../auth/auth.guard.js';
import { CurrentUser } from '../../auth/current-user.decorator.js';
import type { CurrentUserPayload } from '../../auth/types.js';
import { ApiResult, type ApiOk } from '../../common/api-result.js';
import type { Membership } from './entities/trip.entity.js';
import { TripsService } from './trips.service.js';

/**
 * Token-driven invite endpoints. They live in the trips module because the
 * invite lifecycle belongs to trips; the route prefix differs, hence a
 * second controller.
 */
@Controller('invites')
export class InvitesController {
  constructor(private readonly trips: TripsService) {}

  @Post(':token/accept')
  @UseGuards(AuthGuard)
  async accept(
    @Param('token') token: string,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<ApiOk<Membership>> {
    return ApiResult.ok(await this.trips.acceptInvite(token, user));
  }
}
