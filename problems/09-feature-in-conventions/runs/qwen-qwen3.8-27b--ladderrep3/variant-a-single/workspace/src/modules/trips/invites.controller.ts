import { Controller, Param, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../auth/auth.guard.js';
import { CurrentUser } from '../../auth/current-user.decorator.js';
import type { CurrentUserPayload } from '../../auth/types.js';
import { ApiResult, type ApiOk } from '../../common/api-result.js';
import type { TripMember } from './entities/trip-member.entity.js';
import { TripsService } from './trips.service.js';

/**
 * Own route root because accepting lives at /invites/:token, not under /trips.
 * Thin by rule: call the service, wrap in the envelope.
 */
@Controller('invites')
export class InvitesController {
  constructor(private readonly trips: TripsService) {}

  @Post(':token/accept')
  @UseGuards(AuthGuard)
  async accept(
    @CurrentUser() user: CurrentUserPayload,
    @Param('token') token: string,
  ): Promise<ApiOk<TripMember>> {
    return ApiResult.ok(await this.trips.acceptInvite(token, user));
  }
}
