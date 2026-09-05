# 11-trips.module.ts

## reasoning

```
The task is to write exactly one file: `src/modules/trips/trips.module.ts`.

Looking at the PLAN.md, the module wiring is specified as:

```ts
@Module({
  controllers: [TripsController, InvitesController],
  providers: [TripsService, TripsRepository],
})
export class TripsModule {}
```

The manifest says:
`src/modules/trips/trips.module.ts | reads: src/modules/trips/trips.controller.ts,src/modules/trips/trips.service.ts,src/modules/trips/trips.repository.ts | TripsModule wiring`

So I need to import:
- `TripsController`, `InvitesController` from `./trips.controller`
- `TripsService` from `./trips.service`
- `TripsRepository` from `./trips.repository`

The repository uses `@Inject(TRIPS_DRIZZLE)` which means the DI token needs to be provided somewhere. But the plan doesn't mention any custom provider for the Drizzle database instance in the module. The plan's module spec just lists `providers: [TripsService, TripsRepository]`.

Wait, looking more carefully at the repository, it uses `@Inject(TRIPS_DRIZZLE)` where `TRIPS_DRIZZLE` is a Symbol defined in the repository file. For this to work at runtime, there would need to be a provider that supplies this token. However, the plan explicitly states the module only has `providers: [TripsService, TripsRepository]` and doesn't mention any additional provider for the Drizzle instance.

The plan says: "Do not add an export, a feature or a file the plan does not name." So I should stick to exactly what the plan specifies.

The plan's section 3 shows:
```ts
@Module({
  controllers: [TripsController, InvitesController],
  providers: [TripsService, TripsRepository],
})
export class TripsModule {}
```

This is the complete specification. I'll write exactly this with the proper imports. The `TRIPS_DRIZZLE` symbol is defined and exported from the repository file, but providing a value for it at the module level isn't specified in the plan. I'll follow the plan exactly.

Let me write the file:
```

## reply

```ts
import { Module } from '@nestjs/common';
import { TripsController, InvitesController } from './trips.controller';
import { TripsService } from './trips.service';
import { TripsRepository } from './trips.repository';

@Module({
  controllers: [TripsController, InvitesController],
  providers: [TripsService, TripsRepository],
})
export class TripsModule {}
```
