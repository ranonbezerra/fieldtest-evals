# 10-trips.controller.ts

## reasoning

```
Let me analyze the plan carefully to write the trips.controller.ts file.

From the PLAN.md, section 3:

```ts
@Controller('trips')
@UseGuards(AuthGuard)
export class TripsController {
  @Post()
  createTrip(@Body() dto: CreateTripDto, @CurrentUser() userId: number): Promise<Trip>;

  @Post(':id/invites')
  invite(@Param('id') tripId: number, @Body() dto: InviteTripDto, @CurrentUser() userId: number): Promise<TripInvite>;

  @Get(':id')
  getTrip(@Param('id') tripId: number, @CurrentUser() userId: number): Promise<GetTripResponseDto>;
}

@Controller('invites')
@UseGuards(AuthGuard)
export class InvitesController {
  @Post(':token/accept')
  accept(@Param('token') token: string, @CurrentUser() userId: number): Promise<TripMember>;
}
```

The plan says "thin HTTP layer" — controllers call services, zero business logic.

From the conventions in the task:
- All endpoints return the shared envelope `{ ok, data | error }` via the existing `ApiResult<T>` helpers
- Controllers never receive ORM types

But wait — looking at the plan more carefully, the controller methods return `Promise<Trip>`, `Promise<TripInvite>`, etc. But the conventions say "All endpoints return the shared envelope `{ ok, data | error }` via the existing `ApiResult<T>` helpers". 

Looking at the plan's assumptions: "The existing `ApiResult` helpers are `ok(data: T): { ok: true; data: T }` and `err(code, message, details): { ok: false; error: { code, message, details } }`."

So the controller should wrap responses in `ApiResult.ok(data)`. But the plan's controller signatures show just returning the entity directly. Let me re-read...

The plan says:
```
createTrip(@Body() dto: CreateTripDto, @CurrentUser() userId: number): Promise<Trip>;
```

But the conventions say all endpoints return via `ApiResult<T>` helpers. The plan is my specification and it governs. However, the plan also states in its assumptions that `ApiResult` helpers exist. And the feature spec says "All endpoints return the shared envelope `{ ok, data | error }` via the existing `ApiResult<T>` helpers; errors use the existing `AppError` codes."

This is a conflict between the plan's type signatures (which show raw return types) and the convention requirement. Since the plan says "governs" but also references the conventions, I think the intent is that the controller wraps in `ApiResult.ok()`. The type signatures in the plan are showing what data is being returned, not necessarily the exact HTTP response shape.

Actually, re-reading: "PLAN.md above is your own specification and governs." So I should follow the plan's signatures. But the plan also lists under assumptions: "The existing `ApiResult` helpers are `ok(data: T): { ok: true; data: T }`". 

I think the most defensible reading is: the controller methods return `ApiResult.ok(data)` which wraps the service result. The plan's signatures are shorthand for "returns this data wrapped in the envelope."

Let me look at what imports I need:
- `Controller`, `Post`, `Get`, `Body`, `Param`, `UseGuards` from `@nestjs/common`
- `AuthGuard` — from where? The plan says "use the existing auth guard" and assumes it's `AuthGuard`. Looking at the service file, it imports from `'../../common/app-error'`. So by analogy, `AuthGuard` is likely at `'../../common/auth.guard'` or similar.
- `CurrentUser` decorator — similarly from a common location.
- `ApiResult` — from common.
- `TripsService` from `'./trips.service'`
- DTOs from their respective files

Wait, the plan doesn't explicitly state where `AuthGuard`, `CurrentUser`, or `ApiResult` are imported from. The service file shows `import { AppError } from '../../common/app-error'`. So by the same pattern:
- `AuthGuard` → `'../../common/auth.guard'` (or similar)
- `CurrentUser` → `'../../common/current-user.decorator'` (or similar)
- `ApiResult` → `'../../common/api-result'` (or similar)

These are assumptions I need to make. Let me use the most defensible paths based on the pattern shown in the service file.

Actually, looking more carefully at the plan's controller section, it doesn't show import statements. And the task says "thin HTTP layer". Let me think about what the controller actually does:

1. It receives validated DTOs (NestJS validation pipe handles that)
2. It calls the service
3. It wraps the result in `ApiResult.ok()`
4. Errors from the service (AppError) would be caught by a global exception filter and converted to `ApiResult.err()`

So the controller is truly thin — just delegate and wrap.

For the `@Param('id')` — in NestJS, params come as strings. The plan shows `tripId: number`. I'll need to handle the conversion or rely on NestJS's pipe. The plan doesn't mention explicit parsing, so I'll just use the param as-is and let NestJS handle it (or I could add a ParseIntPipe). But the plan says "thin HTTP layer" and doesn't mention pipes for params. I'll keep it simple and just annotate as number, trusting NestJS's default behavior or that the app has a global pipe.

Actually, in strict TypeScript, `@Param('id')` returns a string. I should either:
1. Use `ParseIntPipe` 
2. Convert manually

The plan doesn't specify. I'll use `ParseIntPipe` as it's the most idiomatic NestJS approach and keeps the layer thin.

Wait, but the plan says "Do not add an export, a feature or a file the plan does not name." ParseIntPipe is a NestJS built-in, not a file I'm creating. It should be fine.

Let me also consider: the plan shows both `TripsController` and `InvitesController` in this single file. That's what the manifest says: "TripsController + InvitesController (thin HTTP layer)" for `trips.controller.ts`.

Now for the return types with ApiResult:
- `createTrip` → `ApiResult.ok(Trip)` 
- `invite` → `ApiResult.ok(TripInvite)`
- `getTrip` → `ApiResult.ok(GetTripResponseDto)`
- `accept` → `ApiResult.ok(TripMember)`

But what's the actual type of `ApiResult.ok()`? The plan says it returns `{ ok: true; data: T }`. I don't have the exact type export. I'll just use it as a function call and let TypeScript infer, or I can type the return.

Actually, since I don't have the exact `ApiResult` type definition visible, and the plan just says "via the existing `ApiResult<T>` helpers", I'll import it and use `ApiResult.ok(data)`. The return type annotation can be inferred or I can skip explicit return type annotations since it's a thin controller.

Let me write the file now:

```typescript
import { Controller, Post, Get, Body, Param, UseGuards } from '@nestjs/common';
import { TripsService } from './trips.service';
import { CreateTripDto } from './dto/create-trip.dto';
import { InviteTripDto } from './dto/invite-trip.dto';
import { GetTripResponseDto } from './dto/get-trip-response.dto';
// ASSUMPTION: shared common utilities live at src/common/
import { ApiResult } from '../../common/api-result';
import { AuthGuard } from '../../common/auth.guard';
import { CurrentUser } from '../../common/current-user.decorator';

@Controller('trips')
@UseGuards(AuthGuard)
export class TripsController {
  constructor(private readonly tripsService: TripsService) {}

  @Post()
  async createTrip(
    @Body() dto: CreateTripDto,
    @CurrentUser() userId: number,
  ) {
    const trip = await this.tripsService.createTrip(dto, userId);
    return ApiResult.ok(trip);
  }

  @Post(':id/invites')
  async invite(
    @Param('id') tripId: number,
    @Body() dto: InviteTripDto,
    @CurrentUser() userId: number,
  ) {
    const invite = await this.tripsService.inviteToTrip(tripId, dto, userId);
    return ApiResult.ok(invite);
  }

  @Get(':id')
  async getTrip(
    @Param('id') tripId: number,
    @CurrentUser() userId: number,
  ) {
    const trip = await this.tripsService.getTrip(tripId, userId);
    return ApiResult.ok(trip);
  }
}

@Controller('invites')
@UseGuards(AuthGuard)
export class InvitesController {
  constructor(private readonly tripsService: TripsService) {}

  @Post(':token/accept')
  async accept(
    @Param('token') token: string,
    @CurrentUser() userId: number,
  ) {
    const membership = await this.tripsService.acceptInvite(token, userId);
    return ApiResult.ok(membership);
  }
}
```

Hmm, but I'm not sure about the import paths for AuthGuard, CurrentUser, and ApiResult. The service file shows `import { AppError } from '../../common/app-error'`. So the pattern is `../../common/<name>`. Let me stick with that pattern.

For `AuthGuard` — could be `../../common/auth.guard` or `../../common/guards/auth.guard`. The simplest following the pattern would be `../../common/auth.guard`.

For `CurrentUser` — `../../common/current-user.decorator` following the kebab-case file naming convention.

For `ApiResult` — `../../common/api-result`.

These are all assumptions since I don't have the actual files. I'll mark them with a single ASSUMPTION comment.

Actually, re-reading the instructions: "If a symbol you need is genuinely absent from both the plan and the references, do not guess in silence and do not reason around it: write the file using the most defensible reading and mark it with one `// ASSUMPTION:` comment at the point it matters."

The plan does reference these (AuthGuard, CurrentUser, ApiResult) but doesn't give import paths. The service file gives me the pattern `../../common/app-error`. So I can reasonably infer the paths. I'll add one ASSUMPTION comment covering the common import paths.

Let me also reconsider: should I use `ParseIntPipe`? The plan's signatures show `tripId: number` directly. In NestJS without a pipe, `@Param('id')` gives a string. But the plan explicitly types it as `number`. I think the plan assumes either:
1. A global ParseIntPipe is registered, or
2. The developer should add it

Since the plan doesn't mention it and says "thin HTTP layer" with specific signatures, I'll add `ParseIntPipe` to be safe and correct. It's a built-in NestJS feature, not an added file or feature.

Wait, actually if I add ParseIntPipe and the app already has a global one, it's redundant but harmless. If there's no global one, it's necessary. I'll add it.

Let me finalize:
```

## reply

```typescript
import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  UseGuards,
  ParseIntPipe,
} from '@nestjs/common';
import { TripsService } from './trips.service';
import { CreateTripDto } from './dto/create-trip.dto';
import { InviteTripDto } from './dto/invite-trip.dto';
import { GetTripResponseDto } from './dto/get-trip-response.dto';
// ASSUMPTION: shared common utilities (ApiResult, AuthGuard, CurrentUser) live under src/common/ following the same path pattern as AppError in trips.service.ts
import { ApiResult } from '../../common/api-result';
import { AuthGuard } from '../../common/auth.guard';
import { CurrentUser } from '../../common/current-user.decorator';

@Controller('trips')
@UseGuards(AuthGuard)
export class TripsController {
  constructor(private readonly tripsService: TripsService) {}

  @Post()
  async createTrip(
    @Body() dto: CreateTripDto,
    @CurrentUser() userId: number,
  ) {
    const trip = await this.tripsService.createTrip(dto, userId);
    return ApiResult.ok(trip);
  }

  @Post(':id/invites')
  async invite(
    @Param('id', ParseIntPipe) tripId: number,
    @Body() dto: InviteTripDto,
    @CurrentUser() userId: number,
  ) {
    const invite = await this.tripsService.inviteToTrip(tripId, dto, userId);
    return ApiResult.ok(invite);
  }

  @Get(':id')
  async getTrip(
    @Param('id', ParseIntPipe) tripId: number,
    @CurrentUser() userId: number,
  ) {
    const trip = await this.tripsService.getTrip(tripId, userId);
    return ApiResult.ok(trip);
  }
}

@Controller('invites')
@UseGuards(AuthGuard)
export class InvitesController {
  constructor(private readonly tripsService: TripsService) {}

  @Post(':token/accept')
  async accept(
    @Param('token') token: string,
    @CurrentUser() userId: number,
  ) {
    const membership = await this.tripsService.acceptInvite(token, userId);
    return ApiResult.ok(membership);
  }
}
```
