# 03-trip-member.entity.ts

## reasoning

```
The task asks me to write exactly one file: `src/modules/trips/entities/trip-member.entity.ts`.

From the PLAN.md, section 3, the specification for this file is:

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

The file description says: "TripMember interface + MemberRole type"

This is straightforward. I'll write exactly what the plan specifies, nothing more, nothing less.
```

## reply

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
