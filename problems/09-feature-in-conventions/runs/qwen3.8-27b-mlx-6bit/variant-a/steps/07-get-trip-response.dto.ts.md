# 07-get-trip-response.dto.ts

## reasoning

```
Looking at the plan for `src/modules/trips/dto/get-trip-response.dto.ts`:

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

It reads from `src/modules/trips/entities/trip-member.entity.ts` (for `MemberRole`) and `src/modules/trips/entities/trip-invite.entity.ts`.

Looking at the references, `MemberRole` is defined in `trip-member.entity.ts`:
```ts
export type MemberRole = 'owner' | 'member';
```

I need to import `MemberRole` from the entity file. The plan says this file reads from both entity files, but looking at the actual content, only `MemberRole` is needed from the entities (the `PendingInviteView` uses `email` and `token` as plain strings, not the `InviteStatus` type).

Wait, let me re-check. The plan says "reads: src/modules/trips/entities/trip-member.entity.ts,src/modules/trips/entities/trip-invite.entity.ts". But looking at the actual types needed:
- `MemberView` needs `MemberRole` from trip-member.entity.ts
- `PendingInviteView` just has `email: string` and `token: string` — no type from trip-invite.entity.ts is actually needed

But the plan says it reads from both. Maybe I should import something from trip-invite.entity.ts? Looking at the spec again... No, `PendingInviteView` only has `email` and `token`, both strings. I'll just import `MemberRole` from trip-member.entity.ts. The "reads" in the manifest might be aspirational or include the file that's logically related even if not directly imported.

Actually, let me be precise. The plan shows the exact code for this file. I'll implement it exactly as specified, importing `MemberRole` from the entity.

The project uses ESM with `"type": "module"`. So imports should use the standard ES module syntax.

Let me write the file:
```

## reply

```ts
import { MemberRole } from '../entities/trip-member.entity';

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
  startDate: string;
  endDate: string;
  members: MemberView[];
  pendingInvites: PendingInviteView[];
}
```
