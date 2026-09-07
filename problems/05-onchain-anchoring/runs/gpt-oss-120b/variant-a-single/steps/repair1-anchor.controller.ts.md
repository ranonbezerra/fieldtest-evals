# repair1-anchor.controller.ts

## reasoning

```
We need to create controller that imports AnchorService etc. Since files missing, we assume their paths. Implement basic NestJS controller with endpoint for anchorDocument, verify maybe. Use decorators. Provide class with methods calling service. No compile errors. Assume AnchorService exported class with methods anchorDocument(documentId:string, version:string), verify(...). Also import appropriate DTOs? Simplify.

Implement:

import { Controller, Post, Body, Get, Query } from '@nestjs/common';
import { AnchorService } from './anchor.service';

Define DTO interfaces inline.

Return appropriate. Use async.

Provide export class AnchorController.

Let's write.
```

## reply

```typescript
import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { AnchorService } from './anchor.service';

// ASSUMPTION: AnchorService is a class exported from './anchor.service' with
// async methods `anchorDocument(documentId: string, version: string): Promise<any>`
// and `verify(documentId: string, version: string, content: unknown): Promise<any>`.

interface AnchorDocumentDto {
  documentId: string;
  version: string;
}

interface VerifyDto {
  documentId: string;
  version: string;
  content: unknown;
}

@Controller('anchor')
export class AnchorController {
  constructor(private readonly anchorService: AnchorService) {}

  /**
   * Initiates anchoring of a document version.
   * Body must contain `documentId` and `version`.
   */
  @Post('document')
  async anchorDocument(@Body() dto: AnchorDocumentDto) {
    const { documentId, version } = dto;
    return await this.anchorService.anchorDocument(documentId, version);
  }

  /**
   * Verifies a document version against its on‑chain anchor.
   * Body must contain `documentId`, `version` and the raw `content` to hash.
   */
  @Post('verify')
  async verify(@Body() dto: VerifyDto) {
    const { documentId, version, content } = dto;
    return await this.anchorService.verify(documentId, version, content);
  }

  /**
   * Optional GET endpoint for quick health‑check.
   */
  @Get('health')
  health() {
    return { status: 'ok' };
  }
}
```
