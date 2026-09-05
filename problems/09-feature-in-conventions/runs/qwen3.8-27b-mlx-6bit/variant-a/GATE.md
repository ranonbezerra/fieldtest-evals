$ pnpm install -> 0
Lockfile is up to date, resolution step is skipped
Progress: resolved 1, reused 0, downloaded 0, added 0
Packages: +201
++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
Progress: resolved 201, reused 201, downloaded 0, added 201, done

dependencies:
+ @nestjs/common 10.4.22
+ @nestjs/core 10.4.22
+ @nestjs/platform-express 10.4.22
+ drizzle-orm 0.33.0
+ pg 8.23.0
+ reflect-metadata 0.2.2
+ rxjs 7.8.2
+ zod 3.25.76

devDependencies:
+ @types/express 4.17.25
+ @types/node 22.20.1
+ @types/pg 8.23.1
+ drizzle-kit 0.24.2
+ typescript 5.9.3
+ vitest 2.1.9

Done in 1s using pnpm v10.28.2


$ tsc --noEmit (attempt 0) -> 2
src/modules/trips/dto/create-trip.dto.ts(1,52): error TS2307: Cannot find module 'class-validator' or its corresponding type declarations.
src/modules/trips/dto/get-trip-response.dto.ts(1,28): error TS2307: Cannot find module '../entities/trip-member.entity' or its corresponding type declarations.
src/modules/trips/dto/invite-trip.dto.ts(1,25): error TS2307: Cannot find module 'class-validator' or its corresponding type declarations.
src/modules/trips/trips.controller.ts(10,30): error TS2307: Cannot find module './trips.service' or its corresponding type declarations.
src/modules/trips/trips.controller.ts(11,31): error TS2307: Cannot find module './dto/create-trip.dto' or its corresponding type declarations.
src/modules/trips/trips.controller.ts(12,31): error TS2307: Cannot find module './dto/invite-trip.dto' or its corresponding type declarations.
src/modules/trips/trips.controller.ts(13,36): error TS2307: Cannot find module './dto/get-trip-response.dto' or its corresponding type declarations.
src/modules/trips/trips.controller.ts(15,27): error TS2835: Relative import paths need explicit file extensions in ECMAScript imports when '--moduleResolution' is 'node16' or 'nodenext'. Did you mean '../../common/api-result.js'?
src/modules/trips/trips.controller.ts(16,27): error TS2307: Cannot find module '../../common/auth.guard' or its corresponding type declarations.
src/modules/trips/trips.controller.ts(17,29): error TS2307: Cannot find module '../../common/current-user.decorator' or its corresponding type declarations.
src/modules/trips/trips.module.ts(2,52): error TS2307: Cannot find module './trips.controller' or its corresponding type declarations.
src/modules/trips/trips.module.ts(3,30): error TS2307: Cannot find module './trips.service' or its corresponding type declarations.
src/modules/trips/trips.module.ts(4,33): error TS2307: Cannot find module './trips.repository' or its corresponding type declarations.
src/modules/trips/trips.repository.ts(5,22): error TS2307: Cannot find module './entities/trip.entity' or its corresponding type declarations.
src/modules/trips/trips.repository.ts(6,40): error TS2307: Cannot find module './entities/trip-member.entity' or its corresponding type declarations.
src/modules/trips/trips.repository.ts(7,42): error TS2307: Cannot find module './entities/trip-invite.entity' or its corresponding type declarations.
src/modules/trips/trips.service.spec.ts(2,30): error TS2307: Cannot find module './trips.service' or its corresponding type declarations.
src/modules/trips/trips.service.spec.ts(3,38): error TS2307: Cannot find module './trips.repository' or its corresponding type declarations.
src/modules/trips/trips.service.spec.ts(4,31): error TS2307: Cannot find module './dto/create-trip.dto' or its corresponding type declarations.
src/modules/trips/trips.service.spec.ts(5,31): error TS2307: Cannot find module './dto/invite-trip.dto' or its corresponding type declarations.
src/modules/trips/trips.service.spec.ts(6,27): error TS2307: Cannot find module './entities/trip.entity' or its corresponding type declarations.
src/modules/trips/trips.service.spec.ts(7,45): error TS2307: Cannot find module './entities/trip-member.entity' or its corresponding type declarations.
src/modules/trips/trips.service.spec.ts(8,47): error TS2307: Cannot find module './entities/trip-invite.entity' or its corresponding type declarations.
src/modules/trips/trips.service.spec.ts(10,28): error TS2503: Cannot find namespace 'vi'.
src/modules/trips/trips.service.spec.ts(23,19): error TS2503: Cannot find namespace 'vi'.
src/modules/trips/trips.service.spec.ts(66,13): error TS2503: Cannot find namespace 'vi'.
src/modules/trips/trips.service.spec.ts(69,3): error TS2304: Cannot find name 'beforeEach'.
src/modules/trips/trips.service.ts(3,33): error TS2307: Cannot find module './trips.repository' or its corresponding type declarations.
src/modules/trips/trips.service.ts(4,31): error TS2307: Cannot find module './dto/create-trip.dto' or its corresponding type declarations.
src/modules/trips/trips.service.ts(5,31): error TS2307: Cannot find module './dto/invite-trip.dto' or its corresponding type declarations.
src/modules/trips/trips.service.ts(10,8): error TS2307: Cannot find module './dto/get-trip-response.dto' or its corresponding type declarations.
src/modules/trips/trips.service.ts(11,22): error TS2307: Cannot find module './entities/trip.entity' or its corresponding type declarations.
src/modules/trips/trips.service.ts(12,28): error TS2307: Cannot find module './entities/trip-member.entity' or its corresponding type declarations.
src/modules/trips/trips.service.ts(13,28): error TS2307: Cannot find module './entities/trip-invite.entity' or its corresponding type declarations.
src/modules/trips/trips.service.ts(15,26): error TS2835: Relative import paths need explicit file extensions in ECMAScript imports when '--moduleResolution' is 'node16' or 'nodenext'. Did you mean '../../common/app-error.js'?
src/modules/trips/trips.service.ts(54,8): error TS7006: Parameter 'm' implicitly has an 'any' type.
src/modules/trips/trips.service.ts(89,40): error TS7006: Parameter 'm' implicitly has an 'any' type.
src/modules/trips/trips.service.ts(123,52): error TS7006: Parameter 'm' implicitly has an 'any' type.
src/modules/trips/trips.service.ts(129,8): error TS7006: Parameter 'inv' implicitly has an 'any' type.


$ tsc --noEmit (attempt 1) -> 2
src/modules/trips/dto/create-trip.dto.ts(1,52): error TS2307: Cannot find module 'class-validator' or its corresponding type declarations.
src/modules/trips/dto/invite-trip.dto.ts(1,25): error TS2307: Cannot find module 'class-validator' or its corresponding type declarations.
src/modules/trips/trips.controller.ts(4,27): error TS2307: Cannot find module '../../common/auth.guard.js' or its corresponding type declarations.
src/modules/trips/trips.controller.ts(5,29): error TS2307: Cannot find module '../../common/current-user.decorator.js' or its corresponding type declarations.
src/modules/trips/trips.repository.ts(10,32): error TS2307: Cannot find module '../../common/drizzle.service.js' or its corresponding type declarations.
src/modules/trips/trips.repository.ts(34,3): error TS2345: Argument of type '(table: { id: ExtraConfigColumn<ColumnBaseConfig<ColumnDataType, string>>; tripId: ExtraConfigColumn<ColumnBaseConfig<ColumnDataType, string>>; userId: ExtraConfigColumn<...>; role: ExtraConfigColumn<...>; createdAt: ExtraConfigColumn<...>; updatedAt: ExtraConfigColumn<...>; }) => IndexBuilder[]' is not assignable to parameter of type '(self: { id: ExtraConfigColumn<ColumnBaseConfig<ColumnDataType, string>>; tripId: ExtraConfigColumn<ColumnBaseConfig<ColumnDataType, string>>; userId: ExtraConfigColumn<...>; role: ExtraConfigColumn<...>; createdAt: ExtraConfigColumn<...>; updatedAt: ExtraConfigColumn<...>; }) => PgTableExtraConfig'.
  Type 'IndexBuilder[]' is not assignable to type 'PgTableExtraConfig'.
    Index signature for type 'string' is missing in type 'IndexBuilder[]'.
src/modules/trips/trips.repository.ts(41,26): error TS2353: Object literal may only specify known properties, and 'length' does not exist in type 'PgTextConfig<readonly [string, ...string[]] | [string, ...string[]]>'.
src/modules/trips/trips.repository.ts(185,51): error TS7006: Parameter 'tx' implicitly has an 'any' type.
src/modules/trips/trips.service.ts(20,26): error TS2345: Argument of type '"invalid_date_range"' is not assignable to parameter of type 'AppErrorCode'.
src/modules/trips/trips.service.ts(38,26): error TS2345: Argument of type '"trip_not_found"' is not assignable to parameter of type 'AppErrorCode'.
src/modules/trips/trips.service.ts(44,26): error TS2345: Argument of type '"not_the_owner"' is not assignable to parameter of type 'AppErrorCode'.
src/modules/trips/trips.service.ts(52,26): error TS2339: Property 'randomBytes' does not exist on type 'Crypto'.
src/modules/trips/trips.service.ts(60,26): error TS2345: Argument of type '"invite_not_found"' is not assignable to parameter of type 'AppErrorCode'.
src/modules/trips/trips.service.ts(65,26): error TS2345: Argument of type '"invite_not_found"' is not assignable to parameter of type 'AppErrorCode'.
src/modules/trips/trips.service.ts(71,28): error TS2345: Argument of type '"invite_not_found"' is not assignable to parameter of type 'AppErrorCode'.
src/modules/trips/trips.service.ts(76,28): error TS2345: Argument of type '"invite_not_found"' is not assignable to parameter of type 'AppErrorCode'.
src/modules/trips/trips.service.ts(82,26): error TS2345: Argument of type '"invite_not_found"' is not assignable to parameter of type 'AppErrorCode'.
src/modules/trips/trips.service.ts(92,26): error TS2345: Argument of type '"trip_not_found"' is not assignable to parameter of type 'AppErrorCode'.
src/modules/trips/trips.service.ts(97,26): error TS2345: Argument of type '"not_a_member"' is not assignable to parameter of type 'AppErrorCode'.


$ tsc --noEmit (attempt 2) -> 2
src/modules/trips/trips.controller.ts(2,27): error TS2307: Cannot find module '../../common/auth.guard' or its corresponding type declarations.
src/modules/trips/trips.controller.ts(4,29): error TS2307: Cannot find module '../../common/current-user.decorator' or its corresponding type declarations.
src/modules/trips/trips.controller.ts(5,30): error TS2307: Cannot find module './trips.service' or its corresponding type declarations.
src/modules/trips/trips.controller.ts(6,31): error TS2307: Cannot find module './dto/create-trip.dto' or its corresponding type declarations.
src/modules/trips/trips.controller.ts(7,31): error TS2307: Cannot find module './dto/invite-trip.dto' or its corresponding type declarations.
src/modules/trips/trips.controller.ts(8,36): error TS2307: Cannot find module './dto/get-trip-response.dto' or its corresponding type declarations.
src/modules/trips/trips.controller.ts(9,22): error TS2307: Cannot find module './entities/trip.entity' or its corresponding type declarations.
src/modules/trips/trips.controller.ts(10,28): error TS2307: Cannot find module './entities/trip-member.entity' or its corresponding type declarations.
src/modules/trips/trips.controller.ts(11,28): error TS2307: Cannot find module './entities/trip-invite.entity' or its corresponding type declarations.
src/modules/trips/trips.repository.ts(3,32): error TS2307: Cannot find module '../../common/drizzle.service.js' or its corresponding type declarations.
src/modules/trips/trips.repository.ts(129,11): error TS2488: Type '{ id: number; createdAt: Date; updatedAt: Date; name: string; destination: string; startDate: Date; endDate: Date; }' must have a '[Symbol.iterator]()' method that returns an iterator.
src/modules/trips/trips.service.ts(24,34): error TS2554: Expected 2 arguments, but got 1.


$ vitest run -> 1
e_owner 0ms
     → expected Error: Only the owner can invite members { …(3) } to match object { code: 'not_the_owner' }
(2 matching properties omitted from actual)
   × TripsService > acceptInvite with an unknown token raises invite_not_found 0ms
     → expected Error: Invite not found { …(3) } to match object { code: 'invite_not_found' }
(2 matching properties omitted from actual)
   × TripsService > acceptInvite by a user whose email does not match the invite raises invite_not_found 0ms
     → expected Error: Invite not found { …(3) } to match object { code: 'invite_not_found' }
(2 matching properties omitted from actual)
   × TripsService > getTrip for a non-member raises not_a_member 0ms
     → expected Error: You are not a member of this trip { …(3) } to match object { code: 'not_a_member' }
(2 matching properties omitted from actual)
   × TripsService > getTrip for a non-existent trip raises trip_not_found 0ms
     → expected Error: Trip not found { …(3) } to match object { code: 'trip_not_found' }
(2 matching properties omitted from actual)

 Test Files  1 failed | 1 passed (2)
      Tests  7 failed | 9 passed (16)
   Start at  03:13:22
   Duration  654ms (transform 786ms, setup 0ms, collect 988ms, tests 10ms, environment 0ms, prepare 60ms)

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 7 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  src/modules/trips/trips.service.spec.ts > TripsService > createTrip raises invalid_date_range when startDate equals endDate
AssertionError: expected Error: startDate must be before endDate { …(3) } to match object { code: 'invalid_date_range' }
(2 matching properties omitted from actual)

- Expected
+ Received

- Object {
-   "code": "invalid_date_range",
+ AppError {
+   "code": "validation_failed",
  }

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/7]⎯

 FAIL  src/modules/trips/trips.service.spec.ts > TripsService > inviteToTrip on a non-existent trip raises trip_not_found
AssertionError: expected Error: Trip not found { …(3) } to match object { code: 'trip_not_found' }
(2 matching properties omitted from actual)

- Expected
+ Received

- Object {
-   "code": "trip_not_found",
+ AppError {
+   "code": "not_found",
  }

 ❯ src/modules/trips/trips.service.spec.ts:111:5
    109|     repo.findById.mockResolvedValue(null);
    110| 
    111|     await expect(service.inviteToTrip(99, dto, 1)).rejects.toMatchObje…
       |     ^
    112|     expect(repo.createInvite).not.toHaveBeenCalled();
    113|   });

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[2/7]⎯

 FAIL  src/modules/trips/trips.service.spec.ts > TripsService > inviteToTrip by a non-owner raises not_the_owner
AssertionError: expected Error: Only the owner can invite members { …(3) } to match object { code: 'not_the_owner' }
(2 matching properties omitted from actual)

- Expected
+ Received

- Object {
-   "code": "not_the_owner",
+ AppError {
+   "code": "forbidden",
  }

 ❯ src/modules/trips/trips.service.spec.ts:120:5
    118|     repo.getMembers.mockResolvedValue([makeMember({ userId: 1, role: '…
    119| 
    120|     await expect(service.inviteToTrip(1, dto, 2)).rejects.toMatchObjec…
       |     ^
    121|     expect(repo.createInvite).not.toHaveBeenCalled();
    122|   });

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[3/7]⎯

 FAIL  src/modules/trips/trips.service.spec.ts > TripsService > acceptInvite with an unknown token raises invite_not_found
AssertionError: expected Error: Invite not found { …(3) } to match object { code: 'invite_not_found' }
(2 matching properties omitted from actual)

- Expected
+ Received

- Object {
-   "code": "invite_not_found",
+ AppError {
+   "code": "not_found",
  }

 ❯ src/modules/trips/trips.service.spec.ts:162:5
    160|     repo.findInviteByToken.mockResolvedValue(null);
    161| 
    162|     await expect(service.acceptInvite('unknown-token', 42)).rejects.to…
       |     ^
    163|     expect(repo.addMember).not.toHaveBeenCalled();
    164|   });

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[4/7]⎯

 FAIL  src/modules/trips/trips.service.spec.ts > TripsService > acceptInvite by a user whose email does not match the invite raises invite_not_found
AssertionError: expected Error: Invite not found { …(3) } to match object { code: 'invite_not_found' }
(2 matching properties omitted from actual)

- Expected
+ Received

- Object {
-   "code": "invite_not_found",
+ AppError {
+   "code": "not_found",
  }

 ❯ src/modules/trips/trips.service.spec.ts:202:5
    200|     repo.findUserByEmail.mockResolvedValue({ id: 99, email: 'a@b.com' …
    201| 
    202|     await expect(service.acceptInvite('tok123', 42)).rejects.toMatchOb…
       |     ^
    203|     expect(repo.updateInviteStatus).not.toHaveBeenCalled();
    204|     expect(repo.addMember).not.toHaveBeenCalled();

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[5/7]⎯

 FAIL  src/modules/trips/trips.service.spec.ts > TripsService > getTrip for a non-member raises not_a_member
AssertionError: expected Error: You are not a member of this trip { …(3) } to match object { code: 'not_a_member' }
(2 matching properties omitted from actual)

- Expected
+ Received

- Object {
-   "code": "not_a_member",
+ AppError {
+   "code": "forbidden",
  }

 ❯ src/modules/trips/trips.service.spec.ts:213:5
    211|     repo.isMember.mockResolvedValue(false);
    212| 
    213|     await expect(service.getTrip(1, 42)).rejects.toMatchObject({ code:…
       |     ^
    214|   });
    215| 

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[6/7]⎯

 FAIL  src/modules/trips/trips.service.spec.ts > TripsService > getTrip for a non-existent trip raises trip_not_found
AssertionError: expected Error: Trip not found { …(3) } to match object { code: 'trip_not_found' }
(2 matching properties omitted from actual)

- Expected
+ Received

- Object {
-   "code": "trip_not_found",
+ AppError {
+   "code": "not_found",
  }

 ❯ src/modules/trips/trips.service.spec.ts:247:5
    245|     repo.findById.mockResolvedValue(null);
    246| 
    247|     await expect(service.getTrip(99, 42)).rejects.toMatchObject({ code…
       |     ^
    248|     expect(repo.isMember).not.toHaveBeenCalled();
    249|   });

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[7/7]⎯


