# 13-re-derivation.controller.ts

## reasoning

```
Let me analyze what I need to write for `src/re-derivation/re-derivation.controller.ts`.

From the PLAN.md:
- This is a NestJS controller for the re-derivation feature
- It handles `POST /operations/re-derive`
- It takes `ReDeriveInput` as body and returns `{ rows_rewritten: number }`
- It uses `ReDerivationService`

From the plan's types and signatures:
```ts
export class ReDerivationController {
  constructor(service: ReDerivationService) {}

  @Post("operations/re-derive")
  reDerive(@Body() input: ReDeriveInput): Promise<{ rows_rewritten: number }>;
}
```

The module structure from the layout convention is `src/<feature>/<feature>.controller.ts`.

Now let me think about what imports I need:
- `Controller`, `Post`, `Body` from `@nestjs/common`
- `ReDerivationService` from `./re-derivation.service`
- `ReDeriveInput` from `../operations/operations.types`

The controller is minimal - it validates input (well, the service does validation) and delegates to the service. Per the conventions: "controller validates input and calls the service. Zero business logic."

Wait, looking at the plan more carefully:
- The controller is declared by its module (`re-derivation.module.ts`)
- The endpoint is `POST /operations/re-derive`

Let me write a clean, minimal controller:

```ts
import { Body, Controller, Post } from "@nestjs/common";
import type { ReDeriveInput } from "../operations/operations.types";
import { ReDerivationService } from "./re-derivation.service";

@Controller()
export class ReDerivationController {
  constructor(private readonly service: ReDerivationService) {}

  @Post("operations/re-derive")
  reDerive(@Body() input: ReDeriveInput): Promise<{ rows_rewritten: number }> {
    return this.service.reDerive(input);
  }
}
```

Wait, should I use `@Controller()` with no path or `@Controller("operations")`? Looking at the plan, the route is `@Post("operations/re-derive")`. If I put `@Controller()` with empty path, then the full path would be `/operations/re-derive`. If I put `@Controller("operations")`, the full path would be `/operations/operations/re-derive`.

So I should use `@Controller()` (empty) and put the full path in the decorator: `@Post("operations/re-derive")`.

Actually, looking at the operations controller in the plan:
```ts
export class OperationsController {
  @Get("operations")
  @Post("operations/simulate-write")
  @Get("operations/totals/:companyId")
}
```

This suggests no base path on the controller, and full paths on each route. So for re-derivation:
```ts
@Controller()
export class ReDerivationController {
  @Post("operations/re-derive")
}
```

This gives us `POST /operations/re-derive`. Good.

Now, the convention says "controller validates input and calls the service." But looking at the plan's control flow for reDerive, validation (date_from < date_to) happens in the service. The controller just passes through. For a simple pass-through like this, there's not much validation the controller can do beyond what the framework does (body parsing). The service handles the `InvalidDateRangeError`.

I'll keep it minimal - just delegate to the service. The controller's role here is essentially just routing.

Let me also check: should I add `@Injectable()`? Controllers in NestJS don't typically need `@Injectable()`. They use `@Controller()` which implies injectability.

Final version:

```ts
import { Body, Controller, Post } from "@nestjs/common";
import type { ReDeriveInput } from "../operations/operations.types";
import { ReDerivationService } from "./re-derivation.service";

@Controller()
export class ReDerivationController {
  constructor(private readonly service: ReDerivationService) {}

  @Post("operations/re-derive")
  reDerive(@Body() input: ReDeriveInput): Promise<{ rows_rewritten: number }> {
    return this.service.reDerive(input);
  }
}
```

This is clean, minimal, follows the plan exactly, and doesn't add anything the plan doesn't specify.
```

## reply

```ts
import { Body, Controller, Post } from "@nestjs/common";
import type { ReDeriveInput } from "../operations/operations.types";
import { ReDerivationService } from "./re-derivation.service";

@Controller()
export class ReDerivationController {
  constructor(private readonly service: ReDerivationService) {}

  @Post("operations/re-derive")
  reDerive(@Body() input: ReDeriveInput): Promise<{ rows_rewritten: number }> {
    return this.service.reDerive(input);
  }
}
```
