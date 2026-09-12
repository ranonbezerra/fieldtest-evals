# repair2-set

## reasoning

```
Let me analyze the errors:

1. `src/modules/trips/trips.service.ts(102,84): error TS2554: Expected 2-3 arguments, but got 4.`
2. `src/modules/trips/trips.service.ts(154,94): error TS2554: Expected 2-3 arguments, but got 4.`

These are both in `trips.service.ts`. Let me look at the reference code to understand what's at those lines.

Looking at the reference `trips.service.ts`:

Line 102 (approximately) - in `createInvite`:
```ts
throw new AppError(403, 'forbidden', 'only the trip owner can send invites', { tripId });
```

Line 154 (approximately) - in `getTrip`:
```ts
throw new AppError(403, 'forbidden', 'only members can view this trip', { tripId });
```

The error says "Expected 2-3 arguments, but got 4." So `AppError`'s constructor accepts 2-3 arguments, not 4.

Looking at other usages in the file:
- `AppError.notFound('user not found', { id: userId })` — 2 args
- `AppError.notFound('trip not found', { tripId })` — 2 args
- `AppError.notFound('invite not found')` — 1 arg
- `AppError.conflict('this invite has been declined')` — 1 arg

The 4-arg usages are:
- `new AppError(403, 'forbidden', 'only the trip owner can send invites', { tripId })` — 4 args
- `new AppError(403, 'forbidden', 'only members can view this trip', { tripId })` — 4 args

The `AppError` constructor likely takes `(statusCode, code, message?)` — that's 3 args max. Or maybe `(code, message?)` — 2 args.

Looking at the convention: errors use `snake_case` code and the envelope has `code`, `message`, `details`. The `AppError` class likely has a constructor like `(code: string, message: string, details?: object)` or `(statusCode: number, code: string, message?: string)`.

Given the static methods like `AppError.notFound(message, details)` and `AppError.conflict(message)`, the constructor probably takes `(statusCode: number, code: string, message?: string)` — that's 3 args max.

So the fix is to change:
- `new AppError(403, 'forbidden', 'only the trip owner can send invites', { tripId })` → `new AppError(403, 'forbidden', 'only the trip owner can send invites')`

Wait, but that drops the details. Let me think again.

Actually, looking more carefully at the error: "Expected 2-3 arguments, but got 4." This means the constructor signature is something like `(arg1, arg2?, arg3?)`. 

The static methods are:
- `AppError.notFound(message, details?)` 
- `AppError.conflict(message)`

These likely construct `AppError` internally. The pattern suggests the constructor is `(code: string, message: string, details?: object)` — that's 2-3 args. Or maybe `(statusCode: number, code: string, message?: string)`.

If it's `(statusCode: number, code: string, message?: string)` — 3 args max, then `new AppError(403, 'forbidden', 'only the trip owner can send invites', { tripId })` has 4 args which is too many.

The fix would be to use a static method or reduce to 3 args. But I don't see an `AppError.forbidden` static method in the reference. 

The simplest fix that matches the existing pattern: the constructor likely doesn't take details as a 4th param. Looking at the convention, the error envelope has `details` as an object. But the `AppError` constructor might be `(statusCode, code, message?)` where details are set differently, or it might be `(code, message, details?)`.

Given that `AppError.notFound('trip not found', { tripId })` works with 2 args (message + details), and the constructor takes 2-3 args, the most likely signature is:

`constructor(statusCode: number, code: string, message?: string)` — 2-3 args

So `new AppError(403, 'forbidden', 'only the trip owner can send invites', { tripId })` is wrong because it has 4 args.

The fix: remove the 4th argument (the details object). The message already conveys the context.

So:
- Line 102: `throw new AppError(403, 'forbidden', 'only the trip owner can send invites')`
- Line 154: `throw new AppError(403, 'forbidden', 'only members can view this trip')`

This is one distinct mistake (passing 4 args to a 2-3 arg constructor) repeated in two places.
```

## reply

### src/modules/trips/trips.service.ts
```ts
import { Injectable } from '@nestjs/common';
import { randomBytes, randomUUID } from 'node:crypto';
import type { CurrentUserPayload } from '../../auth/types.js';
import { AppError } from '../../common/app-error.js';
import type { TripInviteRow, TripMemberRow, TripRow, UserRow } from '../../../drizzle/schema.js';
import type { CreateInviteDto } from './dto/create-invite.dto.js';
import type { CreateTripDto } from './dto/create-trip.dto.js';
import type { PendingInvite, Trip, TripInvite, TripMember } from './entities/trip.entity.js';
import { TripsRepository } from './trips.repository.js';

@Injectable()
export class TripsService {
  constructor(private readonly repo: TripsRepository) {}

  /** Row -> entity. The only place the mapping lives. */
  private toMember(member: TripMemberRow, user: UserRow): TripMember {
    return {
      id: member.id,
      userId: member.userId,
      email: user.email,
      displayName: user.displayName,
      role: member.role as TripMember['role'],
      createdAt: member.createdAt.toISOString(),
    };
  }

  private toInvite(invite: TripInviteRow): TripInvite {
    return {
      id: invite.id,
      email: invite.email,
      token: invite.token,
      status: invite.status as TripInvite['status'],
      createdAt: invite.createdAt.toISOString(),
    };
  }

  private toPendingInvite(invite: TripInviteRow): PendingInvite {
    return {
      id: invite.id,
      email: invite.email,
      status: invite.status as PendingInvite['status'],
      createdAt: invite.createdAt.toISOString(),
    };
  }

  private toTrip(trip: TripRow, members: TripMember[], pendingInvites: PendingInvite[]): Trip {
    return {
      id: trip.id,
      name: trip.name,
      destination: trip.destination,
      startsAt: trip.startsAt.toISOString(),
      endsAt: trip.endsAt.toISOString(),
      createdAt: trip.createdAt.toISOString(),
      members,
      pendingInvites,
    };
  }

  /** The stub auth passes ids the database may not know; surface a 404 instead of an FK 500. */
  private async requireUserRow(userId: string): Promise<UserRow> {
    const user = await this.repo.findUserRow(userId);
    if (!user) throw AppError.notFound('user not found', { id: userId });
    return user;
  }

  private async assemble(trip: TripRow): Promise<Trip> {
    const [membersWithUsers, pendingInvites] = await Promise.all([
      this.repo.findMembersWithUsers(trip.id),
      this.repo.findPendingInvites(trip.id),
    ]);
    return this.toTrip(
      trip,
      membersWithUsers.map(({ member, user }) => this.toMember(member, user)),
      pendingInvites.map((invite) => this.toPendingInvite(invite)),
    );
  }

  async createTrip(dto: CreateTripDto, user: CurrentUserPayload): Promise<Trip> {
    const creator = await this.requireUserRow(user.id);
    const trip = await this.repo.insertTrip({
      id: randomUUID(),
      name: dto.name,
      destination: dto.destination,
      startsAt: dto.startsAt,
      endsAt: dto.endsAt,
    });
    await this.repo.insertMember({
      id: randomUUID(),
      tripId: trip.id,
      userId: creator.id,
      role: 'owner',
    });
    return this.assemble(trip);
  }

  async createInvite(tripId: string, dto: CreateInviteDto, user: CurrentUserPayload): Promise<TripInvite> {
    const trip = await this.repo.findById(tripId);
    if (!trip) throw AppError.notFound('trip not found', { tripId });

    const caller = await this.repo.findMember(tripId, user.id);
    if (!caller || caller.role !== 'owner') {
      throw new AppError(403, 'forbidden', 'only the trip owner can send invites');
    }

    const existing = await this.repo.findPendingInvite(tripId, dto.email);
    if (existing) return this.toInvite(existing);

    const invite = await this.repo.insertInvite({
      id: randomUUID(),
      tripId,
      email: dto.email,
      token: randomBytes(24).toString('hex'),
      status: 'pending',
    });
    return this.toInvite(invite);
  }

  async acceptInvite(token: string, user: CurrentUserPayload): Promise<TripMember> {
    const invite = await this.repo.findInviteByToken(token);
    if (!invite) throw AppError.notFound('invite not found');

    // ASSUMPTION: the token is the invite credential; the spec does not require
    // the caller's email to match the invite's, so it is not checked.
    const userRow = await this.requireUserRow(user.id);

    const existing = await this.repo.findMember(invite.tripId, user.id);
    if (existing) {
      // Already in: nothing changes; a still-pending invite just settles.
      if (invite.status === 'pending') await this.repo.markInviteAccepted(invite.id);
      return this.toMember(existing, userRow);
    }

    if (invite.status !== 'pending') {
      throw AppError.conflict(
        invite.status === 'declined' ? 'this invite has been declined' : 'this invite has already been accepted',
      );
    }

    await this.repo.markInviteAccepted(invite.id);
    const member = await this.repo.insertMember({
      id: randomUUID(),
      tripId: invite.tripId,
      userId: user.id,
      role: 'member',
    });
    return this.toMember(member, userRow);
  }

  async getTrip(tripId: string, user: CurrentUserPayload): Promise<Trip> {
    const trip = await this.repo.findById(tripId);
    if (!trip) throw AppError.notFound('trip not found', { tripId });

    const membership = await this.repo.findMember(tripId, user.id);
    if (!membership) throw new AppError(403, 'forbidden', 'only members can view this trip');

    return this.assemble(trip);
  }
}
```
