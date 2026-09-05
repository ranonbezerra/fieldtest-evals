# 12-trips.service.spec.ts-cases

## reasoning

```
The user wants me to list test cases for `src/modules/trips/trips.service.spec.ts` based on the PLAN.md and the implementation files provided. I need to look at what the plan specifies and what the implementation actually does, then enumerate the test cases with the specific format requested.

Let me analyze the service methods and their branches:

**createTrip:**
1. Valid case: returns trip, creates owner membership (the repo.create is called with creatorId)
2. startDate >= endDate: throws invalid_date_range
3. Boundary: startDate === endDate (should fail)

**inviteToTrip:**
1. Trip not found → trip_not_found
2. Caller is not owner → not_the_owner
3. Valid owner creates invite with token
4. Same email twice returns existing pending invite (idempotent)
5. What about: an already-declined or already-accepted invite with same email? The repo method is `findPendingInviteByTripAndEmail` so it only finds pending ones. If the invite was accepted/declined, a new pending invite would be created. Is that intended? The spec says "inviting the same email twice returns the existing pending invite" — so only pending ones are deduplicated.

**acceptInvite:**
1. Unknown token → invite_not_found
2. User email doesn't match invite email → invite_not_found (the code does `findUserByEmail` and checks `user.id !== userId`)
3. Valid pending invite → marks accepted, adds member
4. Already-accepted invite → no-op, returns existing membership
5. Already-accepted but user is not a member (shouldn't happen) → invite_not_found
6. What about declined invite? The code checks `invite.status !== 'pending'` — so a declined invite would go into the "already accepted" branch, look for membership, not find one, and throw invite_not_found. That's an interesting edge case.

**getTrip:**
1. Non-existent trip → trip_not_found
2. Non-member requests → not_a_member
3. Member requests → returns trip with members and pending invites only

Now let me think about what's awkward or could be wrong on its own:

- The `acceptInvite` method looks up the user by email and checks if `user.id !== userId`. This means it's matching the invitee's email to the requesting user. If the user doesn't exist at all, `user` is null → throws. If the user exists but has a different id than expected... wait, actually `findUserByEmail` returns the user whose email matches. Then it checks if that user's id equals the requesting userId. So if the requesting user's email is different from the invite's email, `findUserByEmail(invite.email)` returns a different user (or null), and the check fails. This is correct behavior but subtle.

- The `inviteToTrip` checks ownership by fetching ALL members and checking if any have the ownerId with role 'owner'. This is correct but worth testing.

- The `createTrip` method: the repo.create takes a `creatorId` parameter. Looking at the implementation, the repo handles creating both the trip and the owner membership in a transaction. So the test should verify that `repo.create` is called with the correct `creatorId`.

- For `acceptInvite` already-accepted: the service fetches members and finds the one matching userId. What if there are multiple memberships? The UNIQUE(trip_id, user_id) constraint prevents that, so it's fine. But the test should verify it returns the correct one.

- What about the `declined` status? The spec only mentions `pending/accepted/declined`. Accepting a declined invite: the code would go to the `invite.status !== 'pending'` branch, look for membership, not find one (since declining doesn't add membership), and throw `invite_not_found`. Is that the right behavior? The plan says "accepting twice is a no-op returning the membership" — but that's for already-accepted. A declined invite being "accepted" is arguably an error. The code handles it by throwing invite_not_found, which is a bit misleading but matches the plan's error table.

Let me now structure the list:

1. createTrip happy path
2. createTrip date validation (start > end)
3. createTrip boundary (start === end)
4. inviteToTrip trip not found
5. inviteToTrip non-owner
6. inviteToTrip owner creates new invite
7. inviteToTrip duplicate pending invite (idempotent)
8. acceptInvite unknown token
9. acceptInvite email mismatch (user exists but different person)
10. acceptInvite user doesn't exist at all
11. acceptInvite valid pending → creates membership
12. acceptInvite already accepted → no-op returns membership
13. acceptInvite already declined → invite_not_found (awkward: looks like success path but isn't)
14. getTrip trip not found
15. getTrip non-member
16. getTrip member returns correct shape with only pending invites

Wait, let me reconsider #10. The code does:
```ts
const user = await this.repo.findUserByEmail(invite.email);
if (!user || user.id !== userId) {
  throw new AppError('invite_not_found', 'Invite not found', { token });
}
```

So if the invite email doesn't correspond to any user, `user` is null → throws. If it corresponds to a different user (different id) → throws. These are two distinct branches worth separate tests.

Actually, wait. Let me re-read the code more carefully:

```ts
const user = await this.repo.findUserByEmail(invite.email);
if (!user || user.id !== userId) {
```

This looks up the user by the INVITE's email, then checks if that user is the one making the request. So:
- If no user has the invite's email → user is null → throw
- If a user has the invite's email but their id ≠ requesting userId → throw (different person trying to accept)
- If the user matches → proceed

These are two distinct failure modes. Worth separate tests.

For the "what would have to be broken" part, let me think carefully:

1. `createTrip` happy path — fails if: the service doesn't call repo.create, calls it with wrong creatorId, or doesn't return the trip.
2. `createTrip` start > end — fails if: the validation is missing, uses wrong comparison (>, >=, <, etc.), or throws a different error code.
3. `createTrip` start === end — fails if: the boundary is wrong (e.g., uses > instead of >=).
4. `inviteToTrip` trip not found — fails if: the service doesn't check for null trip, or checks after other validations.
5. `inviteToTrip` non-owner — fails if: the ownership check is missing, or checks membership instead of role.
6. `inviteToTrip` owner creates invite — fails if: token isn't generated, repo.createInvite isn't called with correct params.
7. `inviteToTrip` duplicate — fails if: the dedup check is missing, or it doesn't return the existing invite.
8. `acceptInvite` unknown token — fails if: null check on findInviteByToken is missing.
9. `acceptInvite` email mismatch — fails if: the user lookup or id comparison is missing/wrong.
10. `acceptInvite` no user for email — fails if: null check on findUserByEmail result is missing.
11. `acceptInvite` valid pending — fails if: status update or member insert doesn't happen, or wrong role.
12. `acceptInvite` already accepted no-op — fails if: it tries to re-insert membership, or doesn't return the existing one.
13. `acceptInvite` declined — fails if: it treats declined same as accepted (tries to find membership).
14. `getTrip` not found — fails if: null check missing.
15. `getTrip` non-member — fails if: isMember check missing or inverted.
16. `getTrip` member shape — fails if: pending invites include non-pending ones, or members are missing fields.

Let me also think about whether I should separate the "owner check happens before dedup check" ordering. The plan says: "check trip existence before checking owner role". And the code does: findById → getMembers+owner check → findPendingInviteByTripAndEmail. So if the trip doesn't exist, you get trip_not_found even if you're not the owner. That's covered by test 4 (non-existent trip). But what about: trip exists, caller is not owner, AND there's already a pending invite for that email? The code would throw not_the_owner before reaching the dedup check. That's an ordering concern but it's implicitly tested by test 5 (non-owner always throws regardless of other state).

I think the list is solid. Let me format it properly.
```

## reply

- `createTrip returns the trip and passes creatorId to the repository` — proves the service hands the creator's id through to `repo.create` so an owner membership row is written; fails if the service drops `creatorId`, passes a hard-coded id, or returns something other than the repo's result.
- `createTrip rejects when startDate is after endDate` — proves the date-range guard fires and throws code `invalid_date_range`; fails if the comparison is inverted (`<` instead of `>=`), the guard is absent, or a different error code is raised.
- `createTrip rejects when startDate equals endDate (boundary)` — proves the boundary uses `>=` not `>`; fails only if someone "fixes" the comparison to strict inequality, letting an instant-duration trip through.
- `inviteToTrip on a non-existent trip throws trip_not_found` — proves the existence check runs before any other logic; fails if the service skips `findById`, or checks ownership first and throws `not_the_owner` for a trip that doesn't exist.
- `inviteToTrip by a non-owner throws not_the_owner` — proves the role check inspects `role === 'owner'` rather than mere membership; fails if the service treats any member as allowed, or checks only that the user appears in `getMembers` without inspecting role.
- `inviteToTrip by the owner with a new email creates a pending invite with a non-empty token` — proves the happy path generates a token and calls `repo.createInvite` with the correct trip, email, and inviter; fails if the token is empty/undefined, `invitedBy` is omitted, or the returned invite's status isn't `'pending'`.
- `inviteToTrip with an already-pending email returns the existing invite without creating a second row` — proves idempotency: `repo.createInvite` is never called and the existing invite object is returned; fails if the dedup query is skipped, matches on wrong columns (e.g. ignores `status = 'pending'`), or the service still generates a new token.
- `inviteToTrip after an invite was declined creates a fresh pending invite` — proves only *pending* invites are deduplicated; a declined (or accepted) prior invite does not block a new one; fails if `findPendingInviteByTripAndEmail` is broadened to match any status, or the service short-circuits on a non-pending row.
- `acceptInvite with an unknown token throws invite_not_found` — proves the null guard on `findInviteByToken`; fails if the service dereferences the invite without checking, or throws a different code.
- `acceptInvite when the inviting email has no registered user throws invite_not_found` — proves the `!user` branch of the lookup; fails if the service skips the user-existence check and proceeds to membership logic with a null id.
- `acceptInvite by a user whose id differs from the invitee's user throws invite_not_found` — proves the `user.id !== userId` guard; fails if the service matches only on email and ignores the requesting user's identity (e.g. a second account with the same email, or a token intercepted by another user).
- `acceptInvite on a valid pending invite marks it accepted and returns the new member row with role 'member'` — proves both side-effects (status update + membership insert) and the returned object; fails if `updateInviteStatus` is never called, `addMember` uses role `'owner'`, or the returned object is the invite rather than the membership.
- `acceptInvite on an already-accepted invite is a no-op returning the existing membership` — proves idempotency: no second `addMember` call, no status re-write; the existing row from `getMembers` is returned; fails if the service re-inserts (relying on a unique constraint to silently swallow), or returns `undefined`/the invite instead of the membership.
- `acceptInvite on a declined invite throws invite_not_found (does not create membership)` — proves the non-pending branch doesn't blindly assume membership exists; a declined invite has no member row, so the lookup fails and the guard fires; fails if the service treats any non-pending status as "just look up membership" and throws a 500 on the missing row, or worse, creates a member from a declined invite.
- `getTrip on a non-existent trip throws trip_not_found` — proves the existence check precedes the membership check; fails if the service calls `isMember` first (which would return false for a missing trip) and throws `not_a_member` instead.
- `getTrip by a non-member throws not_a_member` — proves the `isMember` guard; fails if the check is inverted, or if membership is determined by invite status rather than the `trip_members` table.
- `getTrip by a member returns trip fields, all members, and only pending invites` — proves the response shape: `startDate`/`endDate` are ISO strings, `members` contains `{userId, role}` for every member (including the owner), and `pendingInvites` excludes accepted/declined rows; fails if non-pending invites leak into the response, dates are `Date` objects rather than ISO strings, or the owner is missing from `members`.

**Not testing:** transactional atomicity of `createTrip` (trip inserted but membership not), because the repository is faked at the interface level and the service delegates both writes to a single `repo.create` call — atomicity is a repository-implementation concern. Similarly, token uniqueness/collision probability and Drizzle query correctness are out of scope for a service unit test with a faked repository.
