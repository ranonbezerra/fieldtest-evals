# repair2-trips.controller.ts

## reasoning

```
We need to adjust imports with .js extensions and ensure service has create method? In service code, there is createTrip, not create. Controller likely calls service.create. Should map to createTrip. Also need correct import paths with .js. Provide minimal controller implementing endpoints per spec using service methods.

Assume existing auth guard and decorator CurrentUser. We'll import them.

Write controller with methods: POST /trips -> createTrip, POST /trips/:id/invites -> invite, POST /invites/:token/accept -> acceptInvite, GET /trips/:id -> getTrip.

Use appropriate DTOs? Not required compile.

Implement using TripsService methods with correct names.

Add imports with .js extensions.

Assume AppError, ApiResult already.

Provide file.
```

## reply

```ts
// src/modules/trips/trips.controller.ts

import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { TripsService } from './trips.service.js';
import { AuthGuard } from '../../common/auth.guard.js';
import { CurrentUser } from '../../common/current-user.decorator.js';
import { ApiResult } from '../../common/api-result.js';
import {
  CreateTripDto,
  InviteDto,
  AcceptInviteDto,
} from './dto/index.js';

// The controller follows the strict layer conventions:
// – No business logic, only input validation & delegation to the service.
// – All responses are wrapped in the shared `ApiResult` envelope.
// – Errors are produced by the service and propagated unchanged.
@UseGuards(AuthGuard)
@Controller()
export class TripsController {
  constructor(private readonly tripsService: TripsService) {}

  // -------------------------------------------------------------------------
  // 1️⃣ POST /trips – create a new trip; the authenticated user becomes owner.
  // -------------------------------------------------------------------------
  @Post('trips')
  @HttpCode(HttpStatus.CREATED)
  async createTrip(
    @CurrentUser('id') userId: string,
    @Body() body: CreateTripDto,
  ): Promise<ApiResult<any>> {
    // Delegates to the service; the service returns an `ApiResult`.
    return this.tripsService.createTrip(userId, {
      name: body.name,
      destination: body.destination,
      startDate: new Date(body.startDate),
      endDate: new Date(body.endDate),
    });
  }

  // -------------------------------------------------------------------------
  // 2️⃣ POST /trips/:id/invites – owner invites a user by e‑mail.
  // -------------------------------------------------------------------------
  @Post('trips/:id/invites')
  async invite(
    @CurrentUser('id') userId: string,
    @Param('id') tripId: string,
    @Body() body: InviteDto,
  ): Promise<ApiResult<any>> {
    return this.tripsService.invite(userId, tripId, body.email);
  }

  // -------------------------------------------------------------------------
  // 3️⃣ POST /invites/:token/accept – accepting an invite.
  // -------------------------------------------------------------------------
  @Post('invites/:token/accept')
  async acceptInvite(
    @CurrentUser('id') userId: string,
    @Param('token') token: string,
    @Body() _body: AcceptInviteDto,
  ): Promise<ApiResult<any>> {
    // The DTO is empty; it exists only to satisfy validation pipelines.
    return this.tripsService.acceptInvite(token, userId);
  }

  // -------------------------------------------------------------------------
  // 4️⃣ GET /trips/:id – retrieve trip with members & pending invites.
  // -------------------------------------------------------------------------
  @Get('trips/:id')
  async getTrip(
    @CurrentUser('id') userId: string,
    @Param('id') tripId: string,
  ): Promise<ApiResult<any>> {
    return this.tripsService.getTrip(userId, tripId);
  }
}
```
