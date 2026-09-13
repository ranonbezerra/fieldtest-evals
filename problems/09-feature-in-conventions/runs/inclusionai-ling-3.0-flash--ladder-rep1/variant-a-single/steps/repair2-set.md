# repair2-set

## reasoning

```
The error is: `Property 'unauthorized' does not exist on type 'typeof AppError'`. I need to look at the `AppError` class to see what methods it has, and then fix the call in `trips.service.ts`.

Let me check the AppError definition to understand what codes/methods are available. But I don't have that file in the error list. The error says `unauthorized` doesn't exist on `AppError`. I need to find what the correct method name is.

Looking at the conventions, the error envelope uses codes like `resource_not_found`. The AppError likely has methods like `notFound` (which is used in the same file at line ~80). So I need to figure out what the correct method is for unauthorized access.

Common patterns: `forbidden`, `unauthorized`. Since the error says `unauthorized` doesn't exist, I need to check what does exist. Let me look at the AppError file. But it's not in the error list, so it's presumably correct.

Let me search for what AppError methods are available. Since I don't have the file, I need to infer from context. The convention says errors use existing `AppError` codes. The method `notFound` exists (used in the same file). The likely correct method for unauthorized could be `forbidden` since "only owners can invite" is more of a forbidden/authorization issue.

Wait, let me think about this more carefully. The task says "Fix all of them in one reply" and "Change exactly what the compiler requires." I need to find the AppError definition to know what methods exist.

Since the error is specifically about `unauthorized` not existing, and I need to check the AppError class, let me look for it. It's referenced as `../../common/app-error.js` from the trips service.

I don't have the AppError file, but based on common patterns and the fact that the task says to fix what the compiler requires, I should:
1. Check what method names exist on AppError
2. Use the correct one

Since I can't see the AppError file directly, let me reason about it. The service uses `AppError.notFound` already (lowercase, camelCase). The error says `unauthorized` doesn't exist. Common alternatives: `forbidden`, `unauthorized` → maybe it's named differently.

Let me look at the import path: `../../common/app-error.js`. Let me check if there's a common module with AppError.

Actually, I need to just figure out the right method name. Given the context "only owners can invite", this is a forbidden/authorization error. Let me check if `forbidden` exists as a method.

Since I can't see the AppError file, I'll need to make an educated guess based on common NestJS patterns and the conventions. The most likely candidates are:
- `AppError.forbidden` - for forbidden access
- `AppError.unauthorized` - doesn't exist per the error

Wait, but actually I should look at the AppError file. Let me think about what's in the repo.

The reference shows `AppError.notFound` being used. Given the convention about error codes being `snake_case`, maybe the method names are different. Let me check if there's a method like `forbidden` or maybe it takes a different form.

Since I need to fix this and I can't find the AppError file, let me look for it. The path is `src/common/app-error.ts` or similar. Let me check if it's in the error list... no, it's not. So it's presumably correct.

Given that:
1. `AppError.notFound` exists and works
2. `AppError.unauthorized` doesn't exist
3. The common alternative is `AppError.forbidden`

I'll change `AppError.unauthorized` to `AppError.forbidden`.

Wait, but I should double-check. Let me think about what methods AppError likely has:
- `notFound` (confirmed working)
- `badRequest` (likely)
- `forbidden` (likely) or `unauthorized` (doesn't exist)

The most common pattern in NestJS is to have `forbidden` for 403 and `unauthorized` for 401. Since `unauthorized` doesn't exist, `forbidden` is the likely replacement.

Actually, let me re-read the error more carefully. It says "Property 'unauthorized' does not exist on type 'typeof AppError'". This means I need to use whatever method DOES exist. Let me just change it to `forbidden` since that's the most logical alternative for an authorization failure.

But wait - I should really check the AppError file. Let me think about what I know:
- The import is `../../common/app-error.js`
- It has `notFound` method
- It doesn't have `unauthorized`

The most likely method names on AppError would follow a pattern. Let me just go with `forbidden` as it's the standard HTTP 403 equivalent.

So the fix is simple: change `AppError.unauthorized('only owners can invite', { tripId })` to `AppError.forbidden('only owners can invite', { tripId })`.

That's the only error listed. Let me just fix the one file.
```

## reply

### src/modules/trips/trips.service.ts
```ts
import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type {
  InviteRow,
  NewInviteRow,
  NewTripMemberRow,
  NewTripRow,
  TripMemberRow,
  TripRow,
} from '../../../drizzle/schema.js';
import { AppError } from '../../common/app-error.js';
import type { CreateTripDto } from './dto/create-trip.dto.js';
import type { InviteDto } from './dto/invite.dto.js';
import type { Trip, TripDetail } from './entities/trip.entity.js';
import type { Invite } from './entities/invite.entity.js';
import type { TripMember } from './entities/trip-member.entity.js';
import { TripsRepository } from './trips.repository.js';

@Injectable()
export class TripsService {
  constructor(private readonly repo: TripsRepository) {}

  private toTripEntity(row: TripRow): Trip {
    return {
      id: row.id,
      name: row.name,
      destination: row.destination,
      startsAt: row.startsAt.toISOString(),
      endsAt: row.endsAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
    };
  }

  private toMemberEntity(row: TripMemberRow): TripMember {
    return {
      id: row.id,
      tripId: row.tripId,
      userId: row.userId,
      role: row.role as 'owner' | 'member',
      createdAt: row.createdAt.toISOString(),
    };
  }

  private toInviteEntity(row: InviteRow): Invite {
    return {
      id: row.id,
      tripId: row.tripId,
      email: row.email,
      token: row.token,
      status: row.status as 'pending' | 'accepted' | 'declined',
      createdAt: row.createdAt.toISOString(),
    };
  }

  async create(dto: CreateTripDto, creatorId: string): Promise<Trip> {
    const trip = await this.repo.insertTrip({
      id: randomUUID(),
      name: dto.name,
      destination: dto.destination,
      startsAt: new Date(dto.startsAt),
      endsAt: new Date(dto.endsAt),
    });
    await this.repo.insertMember({
      id: randomUUID(),
      tripId: trip.id,
      userId: creatorId,
      role: 'owner',
    });
    return this.toTripEntity(trip);
  }

  async getById(tripId: string, userId: string): Promise<TripDetail> {
    const trip = await this.repo.findTripById(tripId);
    if (!trip) {
      throw AppError.notFound('trip not found', { id: tripId });
    }

    const members = await this.repo.findMembersByTripId(tripId);
    const isMember = members.some((m) => m.userId === userId);
    if (!isMember) {
      throw AppError.notFound('trip not found', { id: tripId });
    }

    const pendingInvites = await this.repo.findPendingInvitesByTripId(tripId);

    return {
      ...this.toTripEntity(trip),
      members: members.map((m) => this.toMemberEntity(m)),
      pendingInvites: pendingInvites.map((i) => this.toInviteEntity(i)),
    };
  }

  async invite(tripId: string, inviterId: string, email: string): Promise<Invite> {
    const trip = await this.repo.findTripById(tripId);
    if (!trip) {
      throw AppError.notFound('trip not found', { id: tripId });
    }

    const membership = await this.repo.findMember(tripId, inviterId);
    if (!membership || membership.role !== 'owner') {
      throw AppError.forbidden('only owners can invite', { tripId });
    }

    const existing = await this.repo.findPendingInvite(tripId, email);
    if (existing) {
      return this.toInviteEntity(existing);
    }

    const invite = await this.repo.insertInvite({
      id: randomUUID(),
      tripId,
      email,
      token: randomUUID(),
      status: 'pending',
    });
    return this.toInviteEntity(invite);
  }

  async acceptInvite(token: string, userId: string): Promise<TripMember> {
    const invite = await this.repo.findInviteByToken(token);
    if (!invite) {
      throw AppError.notFound('invite not found', { token });
    }

    const existing = await this.repo.findMember(invite.tripId, userId);
    if (existing) {
      return this.toMemberEntity(existing);
    }

    const member = await this.repo.insertMember({
      id: randomUUID(),
      tripId: invite.tripId,
      userId,
      role: 'member',
    });

    await this.repo.updateInviteStatus(invite.id, 'accepted');

    return this.toMemberEntity(member);
  }
}
```
