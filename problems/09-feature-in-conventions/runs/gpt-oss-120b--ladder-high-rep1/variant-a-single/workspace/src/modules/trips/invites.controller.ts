import { Controller, Param, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../auth/auth.guard.js';
import { CurrentUser } from '../../auth/current-user.decorator.js';
import type { CurrentUserPayload } from '../../auth/types.js';
import { ApiResult, type ApiOk } from '../../common/api-result.js';
import { TripsService } from './trips.service.js';
import type { Member } from './entities/member.entity.js';

@Controller('invites')
@UseGuards(AuthGuard)
export class InvitesController {
  constructor(private readonly tripsService: TripsService) {}

  @Post(':token/accept')
  async accept(@Param('token') token: string, @CurrentUser() user: CurrentUserPayload): Promise<ApiOk<Member>> {
    const member = await this.tripsService.acceptInvite(token, user);
    return ApiResult.ok(member);
  }
}
