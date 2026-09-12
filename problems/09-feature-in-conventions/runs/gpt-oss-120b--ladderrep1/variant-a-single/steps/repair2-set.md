# repair2-set

## reasoning

```
We need to add forbidden method to AppError? Probably AppError has notForbidden. Look at src/common/app-error.ts.We can't view, but likely has notFound only. Add static forbidden method. Implement in AppError file.
```

## reply

### src/common/app-error.ts
```ts
import { HttpException } from '@nestjs/common';

export class AppError extends HttpException {
  static notFound(message: string) {
    return new AppError({ error: { code: 'resource_not_found', message, details: {} } }, 404);
  }

  // Added missing forbidden error helper
  static forbidden(message: string) {
    return new AppError({ error: { code: 'forbidden', message, details: {} } }, 403);
  }
}
```
