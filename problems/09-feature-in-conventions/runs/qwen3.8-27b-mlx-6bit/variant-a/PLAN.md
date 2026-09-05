## 1. Assumptions

- The root module lives at `src/app.module.ts`; the single registration line is added there.
- The existing `AppError` class accepts `(code: string, message: string, details?: Record<string, unknown>)` and the existing `ApiResult` helpers are `ok(data: T): { ok: true; data: T }` and `err(code, message, details): { ok: false; error: { code, message, details } }`.
- The existing auth guard is `AuthGuard` and the current-user decorator is `@CurrentUser() userId: number`.
- Drizzle migrations are plain SQL files in `drizzle/` (e.g. `0001_create_trips.sql`).
- The trips-specific error codes added to the existing `AppError` code set are: `trip_not_found`, `invite_not_found`, `not_a_member`, `not_the_owner`, `invalid_email`.
- Date range is stored as two `TIMESTAMPTZ` columns (`start_date`, `end_date`).
- The invite token is a 32-char hex string generated with `crypto.randomBytes(16).toString('hex')`.
- The `users` table (already present) has at minimum `id SERIAL PK`, `email TEXT UNIQUE`.

## 2. Data model

**trips**
| column | type | notes |
|---|---|---|
| id | SERIAL PK | |
| name | TEXT NOT NULL | |
| destination | TEXT NOT NULL | |
| start_date | TIMESTAMPTZ NOT NULL | |
| end_date | TIMESTAMPTZ NOT NULL | |
| created_at | TIMESTAMPTZ NOT NULL DEFAULT now() | |
| updated_at | TIMESTAMPTZ NOT NULL DEFAULT now() | |

**trip_members**
| column | type | notes |
|---|---|---|
| id | SERIAL PK | |
| trip_id | INT NOT NULL FK → trips.id ON DELETE CASCADE | |
| user_id | INT NOT NULL FK → users.id | |
| role | TEXT NOT NULL CHECK IN ('owner','member') | |
| created_at | TIMESTAMPTZ NOT NULL DEFAULT now() | |
| updated_at | TIMESTAMPTZ NOT NULL DEFAULT now() | |
| UNIQUE (trip_id, user_id) | | |

**trip_invites**
| column | type | notes |
|---|---|---|
| id | SERIAL PK | |
| trip_id | INT NOT NULL FK → trips.id ON DELETE CASCADE | |
| email | TEXT NOT NULL | |
| token | TEXT(64) NOT NULL UNIQUE | |
| status | TEXT NOT NULL DEFAULT 'pending' CHECK IN ('pending','accepted','declined') | |
| invited_by | INT NOT NULL FK → users.id | |
| created_at | TIMESTAMPTZ NOT NULL DEFAULT now() | |
| updated_at | TIMESTAMPTZ NOT NULL DEFAULT now() | |

## 3. Types and signatures

### `src/modules/trips/entities/trip.entity.ts`
```ts
export interface Trip {
  id: number;
  name: string;
  destination: string;
  startDate: Date;
  endDate: Date;
  createdAt: Date;
  updatedAt: Date;
}
```

### `src/modules/trips/entities/trip-member.entity.ts`
```ts
export type MemberRole = 'owner' | 'member';

export interface TripMember {
  id: number;
  tripId: number;
  userId: number;
  role: MemberRole;
  createdAt: Date;
  updatedAt: Date;
}
```

### `src/modules/trips/entities/trip-invite.entity.ts`
```ts
export type InviteStatus = 'pending' | 'accepted' | 'declined';

export interface TripInvite {
  id: number;
  tripId: number;
  email: string;
  token: string;
  status: InviteStatus;
  invitedBy: number;
  createdAt: Date;
  updatedAt: Date;
}
```

### `src/modules/trips/dto/create-trip.dto.ts`
```ts
export class CreateTripDto {
  name: string;       // @IsString, @IsNotEmpty
  destination: string;// @IsString, @IsNotEmpty
  startDate: string;  // @IsDateString
  endDate: string;    // @IsDateString
}
```

### `src/modules/trips/dto/invite-trip.dto.ts`
```ts
export class InviteTripDto {
  email: string; // @IsEmail
}
```

### `src/modules/trips/dto/get-trip-response.dto.ts`
```ts
export interface MemberView {
  userId: number;
  role: MemberRole;
}

export interface PendingInviteView {
  email: string;
  token: string;
}

export class GetTripResponseDto {
  id: number;
  name: string;
  destination: string;
  startDate: string;   // ISO
  endDate: string;     // ISO
  members: MemberView[];
  pendingInvites: PendingInviteView[];
}
```

### `src/modules/trips/trips.repository.ts` — interface + implementation

```ts
export interface TripsRepository {
  create(data: { name: string; destination: string; startDate: Date; endDate: Date }): Promise<Trip>;
  findById(id: number): Promise<Trip | null>;
  addMember(tripId: number, userId: number, role: MemberRole): Promise<TripMember>;
  isMember(tripId: number, userId: number): Promise<boolean>;
  getMembers(tripId: number): Promise<TripMember[]>;
  findPendingInviteByTripAndEmail(tripId: number, email: string): Promise<TripInvite | null>;
  createInvite(tripId: number, email: string, token: string, invitedBy: number): Promise<TripInvite>;
  findInviteByToken(token: string): Promise<TripInvite | null>;
  updateInviteStatus(id: number, status: InviteStatus): Promise<TripInvite>;
  getPendingInvites(tripId: number): Promise<TripInvite[]>;
}

@Injectable()
export class TripsRepository implements TripsRepository { /* Drizzle impl */ }
```

### `src/modules/trips/trips.service.ts`

```ts
@Injectable()
export class TripsService {
  constructor(repo: TripsRepository) {}

  createTrip(dto: CreateTripDto, creatorId: number): Promise<Trip>;
  inviteToTrip(tripId: number, dto: InviteTripDto, ownerId: number): Promise<TripInvite>;
  acceptInvite(token: string, userId: number): Promise<TripMember>;
  getTrip(tripId: number, requesterId: number): Promise<GetTripResponseDto>;
}
```

**Errors raised:**

| Operation | Condition | Error code |
|---|---|---|
| createTrip | startDate ≥ endDate | `invalid_email` → **no**, use a new code `invalid_date_range` |
| inviteToTrip | trip not found | `trip_not_found` |
| inviteToTrip | caller is not the owner | `not_the_owner` |
| acceptInvite | no invite with that token | `invite_not_found` |
| acceptInvite | invite status is not `pending` (already accepted/declined) | no-op, returns membership |
| getTrip | trip not found | `trip_not_found` |
| getTrip | requester is not a member | `not_a_member` |

### `src/modules/trips/trips.controller.ts`

```ts
@Controller('trips')
@UseGuards(AuthGuard)
export class TripsController {
  @Post()
  createTrip(@Body() dto: CreateTripDto, @CurrentUser() userId: number): Promise<Trip>;

  @Post(':id/invites')
  invite(@Param('id') tripId: number, @Body() dto: InviteTripDto, @CurrentUser() userId: number): Promise<TripInvite>;
}

@Controller('invites')
@UseGuards(AuthGuard)
export class InvitesController {
  @Post(':token/accept')
  accept(@Param('token') token: string, @CurrentUser() userId: number): Promise<TripMember>;
}

// GET route lives on TripsController:
@Get(':id')
getTrip(@Param('id') tripId: number, @CurrentUser() userId: number): Promise<GetTripResponseDto>;
```

### `src/modules/trips/trips.module.ts`

```ts
@Module({
  controllers: [TripsController, InvitesController],
  providers: [TripsService, TripsRepository],
})
export class TripsModule {}
```

### Ordering rules

- `inviteToTrip`: check trip existence **before** checking owner role (so a non-existent trip always yields `trip_not_found`, not `not_the_owner`).
- `acceptInvite`: if the invite is already `accepted`, the service must first verify the current user is already a member of that trip, then return the existing membership row. If the current user is **not** the invitee (email mismatch), raise `invite_not_found`.
- `createTrip`: validate date range **before** any DB write.

## 4. Control flow

**POST /trips**
1. Controller validates DTO shape, passes to service with `creatorId` from guard.
2. Service validates `startDate < endDate`; on failure raises `invalid_date_range`.
3. Service opens a **single transaction**: insert trip row → insert owner membership row → commit.
4. Return `ApiResult.ok(trip)`.

**POST /trips/:id/invites**
1. Controller validates DTO, extracts `tripId`, passes to service with `ownerId`.
2. Service: fetch trip; if null → `trip_not_found`.
3. Service: fetch members, verify `ownerId` has role `owner`; if not → `not_the_owner`.
4. Service: check for existing pending invite with same `(tripId, email)`; if found → return it (idempotent).
5. Service: generate token, insert invite row, return it.

**POST /invites/:token/accept**
1. Controller passes token + `userId` to service.
2. Service: find invite by token; if null → `invite_not_found`.
3. Service: look up the user row by email (via repository `findUserByEmail` — added to interface). If no matching user → `invite_not_found`.
4. Service: if invite status is already `accepted` → fetch membership for `(tripId, userId)`; if it exists return it (no-op); if not (shouldn't happen) raise `invite_not_found`.
5. Service: if status is `pending` → open **single transaction**: set invite status to `accepted` → insert membership row (role `member`) → commit.
6. Return the membership row.

**GET /trips/:id**
1. Controller passes `tripId` + `requesterId` to service.
2. Service: fetch trip; if null → `trip_not_found`.
3. Service: check membership; if not a member → `not_a_member`.
4. Service: fetch members list + pending invites; assemble `GetTripResponseDto`.
5. Return `ApiResult.ok(dto)`.

**Transaction boundaries:** Each write operation that touches more than one table (createTrip, acceptInvite) wraps its writes in a single Drizzle transaction. Single-row operations (invite creation, membership check) do not require an explicit transaction.

## 5. Tests

`src/modules/trips/trips.service.spec.ts` — repository faked with a hand-written object implementing `TripsRepository`.

| # | Test name (proves) |
|---|---|
| 1 | `createTrip` returns the trip and inserts an owner membership for the creator. |
| 2 | `createTrip` raises `invalid_date_range` when startDate equals endDate. |
| 3 | `inviteToTrip` on a non-existent trip raises `trip_not_found`. |
| 4 | `inviteToTrip` by a non-owner raises `not_the_owner`. |
| 5 | `inviteToTrip` by the owner creates a pending invite with a token. |
| 6 | `inviteToTrip` with the same email twice returns the existing pending invite (no second row). |
| 7 | `acceptInvite` with an unknown token raises `invite_not_found`. |
| 8 | `acceptInvite` for a valid pending invite marks it accepted and inserts a member row. |
| 9 | `acceptInvite` for an already-accepted invite is a no-op returning the existing membership. |
| 10 | `acceptInvite` by a user whose email does not match the invite raises `invite_not_found`. |
| 11 | `getTrip` for a non-member raises `not_a_member`. |
| 12 | `getTrip` for a member returns trip fields, members array, and only pending invites. |
| 13 | `getTrip` for a non-existent trip raises `trip_not_found`. |

## 6. Manifest

<!-- manifest
drizzle/0001_create_trips.sql | reads: - | DDL for trips, trip_members, trip_invites tables
src/modules/trips/entities/trip.entity.ts | reads: - | Trip interface
src/modules/trips/entities/trip-member.entity.ts | reads: - | TripMember interface + MemberRole type
src/modules/trips/entities/trip-invite.entity.ts | reads: - | TripInvite interface + InviteStatus type
src/modules/trips/dto/create-trip.dto.ts | reads: - | CreateTripDto class
src/modules/trips/dto/invite-trip.dto.ts | reads: - | InviteTripDto class
src/modules/trips/dto/get-trip-response.dto.ts | reads: src/modules/trips/entities/trip-member.entity.ts,src/modules/trips/entities/trip-invite.entity.ts | GetTripResponseDto + view interfaces
src/modules/trips/trips.repository.ts | reads: src/modules/trips/entities/trip.entity.ts,src/modules/trips/entities/trip-member.entity.ts,src/modules/trips/entities/trip-invite.entity.ts | TripsRepository interface + TripsRepository Drizzle implementation
src/modules/trips/trips.service.ts | reads: src/modules/trips/trips.repository.ts,src/modules/trips/dto/create-trip.dto.ts,src/modules/trips/dto/invite-trip.dto.ts,src/modules/trips/dto/get-trip-response.dto.ts,src/modules/trips/entities/trip.entity.ts,src/modules/trips/entities/trip-member.entity.ts,src/modules/trips/entities/trip-invite.entity.ts | TripsService with all business logic
src/modules/trips/trips.controller.ts | reads: src/modules/trips/trips.service.ts,src/modules/trips/dto/create-trip.dto.ts,src/modules/trips/dto/invite-trip.dto.ts,src/modules/trips/dto/get-trip-response.dto.ts | TripsController + InvitesController (thin HTTP layer)
src/modules/trips/trips.module.ts | reads: src/modules/trips/trips.controller.ts,src/modules/trips/trips.service.ts,src/modules/trips/trips.repository.ts | TripsModule wiring
src/modules/trips/trips.service.spec.ts | reads: src/modules/trips/trips.service.ts,src/modules/trips/trips.repository.ts,src/modules/trips/dto/create-trip.dto.ts,src/modules/trips/dto/invite-trip.dto.ts | Unit tests for TripsService with faked repository
-->
