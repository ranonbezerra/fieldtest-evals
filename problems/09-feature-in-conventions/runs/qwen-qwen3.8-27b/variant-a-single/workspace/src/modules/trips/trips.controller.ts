import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { TripsService } from './trips.service';
import { CreateTripDto } from './dto/create-trip.dto';
import { InviteMemberDto } from './dto/invite-member.dto';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';

@UseGuards(AuthGuard)
@UsePipes(new ValidationPipe())
@Controller()
export class TripsController {
  constructor(private readonly tripsService: TripsService) {}

  @Post('trips')
  async createTrip(
    @Body() dto: CreateTripDto,
    @CurrentUser() userId: string,
  ) {
    return this.tripsService.createTrip(userId, dto);
  }

  @Post('trips/:id/invites')
  async inviteMember(
    @Param('id') id: string,
    @Body() dto: InviteMemberDto,
    @CurrentUser() userId: string,
  ) {
    return this.tripsService.inviteMember(userId, id, dto);
  }

  @Post('invites/:token/accept')
  async acceptInvite(
    @Param('token') token: string,
    @CurrentUser() userId: string,
  ) {
    return this.tripsService.acceptInvite(userId, token);
  }

  @Get('trips/:id')
  async getTrip(
    @Param('id') id: string,
    @CurrentUser() userId: string,
  ) {
    return this.tripsService.getTrip(userId, id);
  }
}
