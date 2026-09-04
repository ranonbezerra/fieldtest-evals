# repair2-methodology.controller.ts

## reasoning

```
Let me analyze the compiler errors that relate to `src/methodology/methodology.controller.ts`:

Looking through the error messages, I don't see any direct errors pointing to `src/methodology/methodology.controller.ts` itself. Let me re-read...

The errors are:
- `methodology/methodology.module.ts(9,38)` - can't find classification module
- `src/methodology/methodology.repository.ts(2,31)` - can't find prisma.service
- `src/methodology/methodology.repository.ts(31,43)` - implicit any for 'tx'
- `src/methodology/methodology.service.ts(8,39)` - can't find methodology.repository
- `src/methodology/methodology.service.ts(9,39)` - can't find classification.service
- `src/methodology/methodology.service.ts(10,49)` - needs .js extension for types import
- `src/product/...` various errors
- `src/profile/...` various errors
- `test/classification.spec.ts` various errors

None of these directly reference `src/methodology/methodology.controller.ts`. But the task says "Rewrite `src/methodology/methodology.controller.ts` complete, fixing what these messages require of this file."

So I need to write the controller file such that it compiles correctly given the project's conventions (ESM with explicit `.js` extensions, strict TypeScript, etc.).

From the plan:
- The controller has endpoints:
  - POST `/methodologies` — `{ version: number, name: string }` → `201 MethodologyVersion`
  - POST `/methodologies/:id/publish` — → `204` (triggers re-scoring)

- The controller validates input and calls the service. Zero business logic.
- File: `kebab-case.role.ts` → `methodology.controller.ts` ✓
- Class: PascalCase → `MethodologyController`

The file needs to:
1. Import from `@nestjs/common` (Controller, Post, Body, Param, HttpCode)
2. Import `MethodologyService` from `./methodology.service.js` (ESM requires .js extension)
3. Define the controller with the two endpoints

Let me write it:

```ts
import { Body, Controller, Param, Post, HttpCode } from '@nestjs/common';
import { MethodologyService } from './methodology.service.js';

@Controller('methodologies')
export class MethodologyController {
  constructor(private readonly methodologyService: MethodologyService) {}

  @Post()
  create(@Body() body: { version: number; name: string }) {
    return this.methodologyService.publish(body.version); // wait no...
  }
```

Wait, let me re-read the plan. The endpoints are:
- POST `/methodologies` — creates a methodology version `{ version: number, name: string }` → `201 MethodologyVersion`
- POST `/methodologies/:id/publish` — publishes (triggers re-scoring) → `204`

So I need a create method and a publish method. But looking at the service signatures in the plan:

```ts
class MethodologyService {
  publish(versionId: number): Promise<void>;   // triggers rescoreAll
}
```

The plan only shows `publish` on the service. But there's also a create endpoint. Let me look more carefully...

The plan says:
```
POST | `/methodologies` | `{ version: number, name: string }` | `201 MethodologyVersion`
POST | `/methodologies/:id/publish` | — | `204` (triggers re-scoring)
```

So the controller needs two methods. The service must have a way to create too, even though the plan's service signature only explicitly shows `publish`. But the repository has `create`:

```ts
class MethodologyRepository {
  create(data: { version: number; name: string }): Promise<MethodologyVersion>;
  publish(versionId: number): Promise<void>;
}
```

So the service likely has both `create` and `publish` methods, or the controller calls the repository directly... No, the layers say controller calls service. So the service must expose a create method too, even if not explicitly listed in the plan's service signatures (which might be incomplete).

Actually, looking again at the plan's service signature:
```ts
// methodology.service.ts
class MethodologyService {
  publish(versionId: number): Promise<void>;   // triggers rescoreAll
}
```

This only shows `publish`. But the controller needs a create endpoint. The plan might be showing only the key method. Since I'm only writing the controller, I'll assume the service has both `create` and `publish` methods (the repository clearly has `create`).

Now, for the ESM convention with `moduleResolution: node16` or `nodenext`, I need `.js` extensions on relative imports.

Let me write the controller:

```ts
import { Body, Controller, HttpCode, Param, Post } from '@nestjs/common';
import { MethodologyService } from './methodology.service.js';

@Controller('methodologies')
export class MethodologyController {
  constructor(private readonly methodologyService: MethodologyService) {}

  @Post()
  create(@Body() body: { version: number; name: string }) {
    return this.methodologyService.create(body.version, body.name);
  }

  @Post(':id/publish')
  @HttpCode(204)
  publish(@Param('id') id: string) {
    return this.methodologyService.publish(Number(id));
  }
}
```

Wait, I need to think about whether the service's `create` method signature is `(version: number, name: string)` or `(data: { version: number; name: string })`. The repository has `create(data: { version: number; name: string })`, so the service likely passes through or takes similar params.

Since I can't see the actual service file, and the task says "If a message refers to a shape you cannot see, say so in an `// ASSUMPTION:` line rather than guessing at it repeatedly", I should note this.

Actually, the task says to fix what the compiler messages require of THIS file. The compiler messages don't directly reference `methodology.controller.ts`. The errors that would be caused by this file are in `methodology.module.ts` which can't find the classification module (not the controller). 

Wait, let me re-read: "methodology/methodology.module.ts(9,38): error TS2307: Cannot find module '../classification/classification.module'"

This is the module file, not the controller. The controller isn't mentioned in any error. But the task explicitly asks me to rewrite it.

I think the intent is: the controller file is missing or has issues, and I need to write it correctly so that the overall workspace compiles (at least this file doesn't add new errors). The key constraints are:
1. ESM with `.js` extensions on relative imports
2. Strict TypeScript (no implicit any)
3. Follow the plan's endpoints

Let me write a clean, correct controller file. I'll assume the service has `create(version: number, name: string)` based on the repository pattern.

Actually, I realize I should be more careful. Let me just write it in a way that's consistent with the plan and ESM conventions, and add an assumption line if needed.
```

## reply

```ts
import { Body, Controller, HttpCode, Param, Post } from '@nestjs/common';
import { MethodologyService } from './methodology.service.js';

// ASSUMPTION: MethodologyService exposes create(version: number, name: string) in addition to publish(versionId: number), matching the repository's create(data) signature.

@Controller('methodologies')
export class MethodologyController {
  constructor(private readonly methodologyService: MethodologyService) {}

  @Post()
  create(@Body() body: { version: number; name: string }) {
    return this.methodologyService.create(body.version, body.name);
  }

  @Post(':id/publish')
  @HttpCode(204)
  async publish(@Param('id') id: string): Promise<void> {
    await this.methodologyService.publish(Number(id));
  }
}
```
