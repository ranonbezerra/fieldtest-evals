import { Controller, Param, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../auth/auth.guard.js';
import { CurrentUser } from '../../auth/current-user.decorator.js';
import type { CurrentUserPayload } from '../../auth/types.js';
import { ApiResult, type ApiOk } from '../../common/api-result.js';
import type { Membership } from './entities/membership.entity.js';
import { TripsService } from './trips.service.js';

/**
 * The accept endpoint lives under `/invites` (the token is the invitee's only
 * credential), so it gets its own controller in this module.
 */
@Controller('invites')
export class InvitesController {
  constructor(private readonly trips: TripsService) {}

  @Post(':token/accept')
  @UseGuards(AuthGuard)
  async accept(
    @CurrentUser() user: CurrentUserPayload,
    @Param('token') token: string,
  ): Promise<ApiOk<Membership>> {
    return ApiResult.ok(await this.trips.accept(user, token));
  }
}
