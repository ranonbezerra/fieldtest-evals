# repair1-methodology.controller.ts

## reasoning

```
Let me analyze the compiler errors to understand what's happening:

1. `src/profiles/profile.repository.ts(37,39): error TS2339: Property 'profile' does not exist on type 'PrismaService'.`
2. `src/profiles/profile.repository.ts(45
```

## reply

Looking at the compiler errors, none of them reference `src/methodologies/methodology.controller.ts`. The errors are all in other files. However, the task asks me to rewrite the controller file. Let me reason about what it must contain based on the existing code and conventions.

From the references I can see:
- `MethodologyService` has `getActive()`, `getVersion()`, `publish()`, `rescoreAll()`
- `ClassificationService` has `classify()`, `retrieve()`
- Endpoints use kebab-case, plural
- Controller validates input, zero business logic
- Error envelope is handled by `AppError`/`Errors`

The controller likely calls into `MethodologyService` and/or `ClassificationService`. Since there are no compiler errors in this file itself, it must already exist and compile. The instruction says "fixing what these messages require of this file" — since no messages reference it, the fix is minimal or the file is fine as-is. But the task says to rewrite it complete.

Let me reconstruct it based on what the services expose and the API conventions (kebab-case plural endpoints):

- `GET /methodologies` or `GET /methodologies/active` — get active
- `GET /methodologies/:version` — get specific version
- `POST /methodologies/publish` — publish new version
- `POST /classifications/rescore` — trigger rescore
- `POST /classifications/:productId` — classify a product
- `GET /classifications/:productId` — retrieve stored

Actually, looking more carefully at the structure, `methodology.controller.ts` would handle methodology-related endpoints. Classification endpoints would be in `classification.controller.ts`. But the task only asks about the methodology controller.

Since no compiler errors point to this file, and I must not change anything the messages don't name, I'll write a clean controller that uses the services correctly without introducing new errors.

```typescript
import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { MethodologyService, RuleEntry } from './methodology.service.js';
import { Errors } from '../common/errors.js';

@Controller('methodologies')
export class MethodologyController {
  constructor(private readonly service: MethodologyService) {}

  @Get('active')
  async getActive() {
    const active = await this.service.getActive();
    if (!active) {
      throw Errors.notFound('Methodology version', { detail: 'no active version' });
    }
    return active;
  }

  @Get(':version')
  async getVersion(@Param('version') version: string) {
    return this.service.getVersion(version);
  }

  @Post('publish')
  async publish(
    @Body() body: { version: string; rules: RuleEntry[] },
  ) {
    if (!body?.version) {
      throw Errors.invalidInput('version is required.', { field: 'version' });
    }
    if (!Array.isArray(body.rules)) {
      throw Errors.invalidInput('rules must be an array.', { field: 'rules' });
    }
    for (const rule of body.rules) {
      if (!rule.ingredientId || !rule.severity || !rule.flag || !rule.source) {
        throw Errors.invalidInput(
          'Each rule requires ingredientId, severity, flag, and source.',
          { rule },
        );
      }
    }
    return this.service.publish(body.version, body.rules);
  }

  @Post('rescore')
  async rescore() {
    await this.service.rescoreAll();
    return { status: 'ok' };
  }
}
```
