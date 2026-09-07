# repair2-anchor.controller.ts

## reasoning

```
We need to create the file with correct imports. Likely other files missing but we just need to write controller that imports AnchorService from './anchor.service'. Since missing, we assume exists. Write minimal controller with NestJS decorator, method anchorDocument etc. Provide placeholder methods. Use appropriate DTOs? Just compile. We'll import AnchorService, use Controller('anchor'), define POST route.

Implement class AnchorController with constructor(private readonly anchorService: AnchorService). Provide methods: anchorDocument, verify maybe. Use @Post etc. Use DTOs definitions inline? Could import but not needed. Just use any.

Write file with proper imports and export.
```

## reply

```ts
// src/anchor/anchor.controller.ts

import { Controller, Post, Body, Get, Query } from '@nestjs/common';
import { AnchorService } from './anchor.service';

// ASSUMPTION: AnchorService exists and provides the methods
// `anchorDocument(documentId: string, version: number): Promise<any>`
// `verify(documentId: string, version: number, content: any): Promise<any>`
// The exact signatures are not defined in the task description, so `any` is used.

@Controller('anchor')
export class AnchorController {
  constructor(private readonly anchorService: AnchorService) {}

  /**
   * Initiates anchoring of a document version.
   * Expects a JSON body with `documentId` and `version`.
   */
  @Post('anchor-document')
  async anchorDocument(
    @Body('documentId') documentId: string,
    @Body('version') version: number,
  ): Promise<any> {
    return this.anchorService.anchorDocument(documentId, version);
  }

  /**
   * Verifies a document version against its anchored hash.
   * Expects query parameters `documentId` and `version`, and a JSON body `content`.
   */
  @Post('verify')
  async verify(
    @Query('documentId') documentId: string,
    @Query('version') version: number,
    @Body('content') content: any,
  ): Promise<any> {
    return this.anchorService.verify(documentId, version, content);
  }

  /**
   * Simple health check endpoint.
   */
  @Get('health')
  healthCheck(): { status: string } {
    return { status: 'ok' };
  }
}
```
