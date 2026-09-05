# 04-trip-invite.entity.ts

## reasoning

```
The user wants me to write exactly one file: `src/modules/trips/entities/trip-invite.entity.ts`

From the plan, this file should contain:
- `InviteStatus` type: `'pending' | 'accepted' | 'declined'`
- `TripInvite` interface with fields: id, tripId, email, token, status, invitedBy, createdAt, updatedAt

Let me write this exactly as specified in the plan.
```

## reply

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
