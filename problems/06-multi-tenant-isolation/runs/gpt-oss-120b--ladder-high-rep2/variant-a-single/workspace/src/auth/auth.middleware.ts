import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

@Injectable()
export class AuthMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    // Mock authentication: extract org ID from custom header X-Org-Id
    const orgIdHeader = req.headers['x-org-id'];
    if (typeof orgIdHeader === 'string') {
      (req as any).user = { org: orgIdHeader };
    }
    next();
  }
}
