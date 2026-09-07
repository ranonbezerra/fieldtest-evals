# repair1-profile.controller.ts

## reasoning

```
Let me analyze the compiler errors carefully. The task asks me to rewrite `src/profiles/profile.controller.ts` to fix what the compiler messages require of this file.

Let me look at the errors:

1. `src/profiles/profile.repository.ts(37,39): error TS2339
```

## reply

```typescript
import { Body, Controller, Get, Param, Post, UsePipes, ValidationPipe } from '@nestjs/common';
import { ProfilesService } from './profile.service.js';

@Controller('profiles')
@UsePipes(new ValidationPipe({ whitelist: true }))
export class ProfilesController {
  constructor(private readonly profilesService: ProfilesService) {}

  @Post()
  async create(@Body() body: { name: string }) {
    return this.profilesService.create(body.name);
  }

  @Get()
  async list() {
    return this.profilesService.list();
  }

  @Get(':id')
  async getById(@Param('id') id: string) {
    return this.profilesService.getById(id);
  }

  @Post(':id/modifiers')
  async addModifier(
    @Param('id') id: string,
    @Body() body: { canonicalName: string; severity: string; flag: string; source: string },
  ) {
    return this.profilesService.addModifier(id, body);
  }
}
```
