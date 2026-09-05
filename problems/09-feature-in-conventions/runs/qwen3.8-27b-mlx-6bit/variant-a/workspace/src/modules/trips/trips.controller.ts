import { Controller, Post, Get, Body, Param, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../common/auth.guard';
// ASSUMPTION: the auth guard and current-user decorator are imported without a `.js` extension; the compiler could not resolve the `.js`-suffixed paths.
import { CurrentUser } from '../../common/current-user.decorator';
import { TripsService } from './trips.service';
import { CreateTripDto } from './dto/create-trip.dto';
import { InviteTripDto } from './dto/invite-trip.dto';
import { GetTripResponseDto } from './dto/get-trip-response.dto';
import { Trip } from './entities/trip.entity';
import { TripMember } from './entities/trip-member.entity';
import { TripInvite } from './entities/trip-invite.entity';

@Controller('trips')
@UseGuards(AuthGuard)
export class TripsController {
  constructor(private readonly tripsService: TripsService) {}

  @Post()
  createTrip(
    @Body() dto: CreateTripDto,
    @CurrentUser() userId: number,
  ): Promise<Trip> {
    return this.tripsService.createTrip(dto, userId);
  }

  @Post(':id/invites')
  invite(
    @Param('id') id: string,
    @Body() dto: InviteTripDto,
    @CurrentUser() userId: number,
  ): Promise<TripInvite> {
    return this.tripsService.inviteToTrip(Number(id), dto, userId);
  }

  @Get(':id')
  getTrip(
    @Param('id') id: string,
    @CurrentUser() userId: number,
  ): Promise<GetTripResponseDto> {
    return this.tripsService.getTrip(Number(id), userId);
  }
}

@Controller('invites')
@UseGuards(AuthGuard)
export class InvitesController {
  constructor(private readonly tripsService: TripsService) {}

  @Post(':token/accept')
  accept(
    @Param('token') token: string,
    @CurrentUser() userId: number,
  ): Promise<TripMember> {
    return this.tripsService.acceptInvite(token, userId);
  }
}
