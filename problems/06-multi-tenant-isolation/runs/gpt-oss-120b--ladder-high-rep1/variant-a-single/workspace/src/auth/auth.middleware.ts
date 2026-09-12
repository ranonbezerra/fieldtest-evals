import { Injectable, NestMiddleware, UnauthorizedException } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

@Injectable()
export class MockAuthMiddleware implements NestMiddleware {
  async use(req: Request, res: Response, next: NextFunction) {
    // For this implementation we expect the org claim to be passed via a custom header.
    const orgHeader = req.headers['x-org'];
    if (!orgHeader || typeof orgHeader !== 'string') {
      throw new UnauthorizedException('Missing X-Org header');
    }
    (req as any).user = { org: orgHeader };
    next();
  }
}
