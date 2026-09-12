# repair1-set

## reasoning

```
Let me analyze the errors as a whole to identify distinct mistakes:

1. **Missing file extensions in relative imports (TS2835)** — The project uses `"moduleResolution": "node16"` or `"nodenext"`, which requires explicit `.js` extensions in relative imports. The errors show:
   - `src/common/error-envelope.filter.ts(11,26)`: `./app-error` → `./app-error.js`
   - `src/payout/payout.repository.ts(4,40)`: `../common/app-error` → `../common/app-error.js`
   - `src/payout/payout.service.ts(4,39)`: `../common/app-error` → `../common/app-error.js`

   But wait — many other relative imports also fail with TS2307 "Cannot find module". Let me look more carefully.

   Actually, TS2307 "Cannot find module" for relative paths like `./payout.module`, `./prisma/prisma.module`, etc. — these could be because:
   - The files don't exist (missing files)
   - OR because of the same extension issue but TypeScript reports it differently

   Wait, looking more carefully: TS2835 is specifically "Relative import paths need explicit file extensions" — this is the error TypeScript gives when it CAN find the file but the extension is missing. TS2307 "Cannot find module" is when it can't find the file at all.

   So for the TS2307 errors on relative imports, the files must be missing from the workspace. But looking at the reference files provided, they ARE there:
   - `src/app.module.ts` imports `./common/error-envelope.filter`, `./payout/payout.module`, `./prisma/prisma.module`
   - `src/payout/payout.module.ts` imports `./payout.controller`, `./payout.repository`, `./payout.service`, `./payout.worker`, `./transfer.provider`
   - etc.

   Wait — the reference files show these files exist. But the compiler says "Cannot find module". This means the files might not actually exist in the workspace, OR the issue is that with `node16`/`nodenext` module resolution, you need `.js` extensions AND the files must exist.

   Actually, let me reconsider. In `node16`/`nodenext` mode:
   - If you write `import './foo'` and `foo.ts` exists, TypeScript reports TS2835 (needs extension)
   - If you write `import './foo'` and no `foo.ts` exists, TypeScript reports TS2307 (cannot find module)

   So the TS2307 errors mean the files genuinely don't exist in the workspace. But the reference shows them... Let me look at which files have TS2307 for relative imports:

   - `src/app.module.ts(3,37)`: `./common/error-envelope.filter` — but `src/common/error-envelope.filter.ts` IS shown in the reference
   - `src/app.module.ts(4,30)`: `./payout/payout.module` — `src/payout/payout.module.ts` IS shown
   - `src/app.module.ts(5,30)`: `./prisma/prisma.module` — `src/prisma/prisma.module.ts` IS shown

   Hmm, but the reference files are "read-only reference" material. They show what the files SHOULD contain. The actual workspace might be missing some files, or the files exist but the import paths are wrong.

   Wait, I think I'm overcomplicating this. Let me re-read the error patterns:

   Looking at `src/common/error-envelope.filter.ts(11,26)`: `Cannot find module './app-error'` — this is TS2835, meaning the file `./app-error.ts` exists but needs `.js` extension.

   But `src/app.module.ts(3,37)`: `Cannot find module './common/error-envelope.filter'` — this is TS2307. This could mean:
   - The file `src/common/error-envelope.filter.ts` doesn't exist, OR
   - With node16 resolution, you need the `.js` extension and without it, TypeScript can't resolve it

   Actually wait — in `node16` mode, if you import `./common/error-envelope.filter` without extension, TypeScript will look for:
   - `./common/error-envelope.filter.ts` (if the extension matches the expected output)
   
   Hmm, actually in node16 mode, relative imports MUST have an explicit extension. Without it, TypeScript reports the error. The specific error code depends on whether the file exists:
   - If the file exists: TS2835
   - If the file doesn't exist: TS2307

   So for `src/app.module.ts` importing `./common/error-envelope.filter` — if `src/common/error-envelope.filter.ts` exists, it should be TS2835, not TS2307. The fact that it's TS2307 suggests the file doesn't exist.

   But wait — the reference shows `src/common/error-envelope.filter.ts` exists! Unless the reference is showing what the file should contain but it's not actually in the workspace...

   Actually, I think the reference files ARE the workspace files. They're shown as "read-only reference" meaning I can read them but they represent the actual state of the workspace. So the files DO exist.

   Let me reconsider. Maybe in `node16`/`nodenext` mode, ALL relative imports without extensions get TS2307, not TS2835? Let me check: the TS2835 error says "Relative import paths need explicit file extensions in ECMAScript imports when '--moduleResolution' is 'node16' or 'nodenext'. Did you mean './app-error.js'?"

   So TS2835 is specifically for when TypeScript CAN figure out what you meant (the file exists) but you're missing the extension. TS2307 is for when it truly can't find the module.

   Hmm, but then why would `./common/error-envelope.filter` be TS2307 when `src/common/error-envelope.filter.ts` exists?

   OH WAIT. I think I understand now. The issue might be that `error-envelope.filter.ts` has a dot in its name. With node16 resolution, `./common/error-envelope.filter` might be interpreted as trying to import a file called `error-envelope.filter` with no extension, and TypeScript might not be able to resolve it because it's ambiguous (is `.filter` the extension?).

   Actually no, that's not how it works. Let me think again...

   Actually, I think the simplest explanation is: with `node16`/`nodenext` module resolution, ALL relative imports need explicit `.js` extensions. The error code might vary:
   - TS2835 when TypeScript can suggest the fix (file exists with a known extension)
   - TS2307 when it's a more complex resolution failure

   But regardless, the fix is the same: add `.js` to all relative imports.

   Let me just look at ALL the errors and categorize them:

   **Category 1: Missing `.js` extension on relative imports**
   These are all relative imports that need `.js` added:
   - `src/app.module.ts`: `./common/error-envelope.filter` → `./common/error-envelope.filter.js`
   - `src/app.module.ts`: `./payout/payout.module` → `./payout/payout.module.js`
   - `src/app.module.ts`: `./prisma/prisma.module` → `./prisma/prisma.module.js`
   - `src/main.ts`: `./app.module` → `./app.module.js`
   - `src/payout/payout.controller.ts`: `./payout.dto` → `./payout.dto.js`
   - `src/payout/payout.controller.ts`: `./payout.service` → `./payout.service.js`
   - `src/payout/payout.module.ts`: `./payout.controller` → `./payout.controller.js`
   - `src/payout/payout.module.ts`: `./payout.repository` → `./payout.repository.js`
   - `src/payout/payout.module.ts`: `./payout.service` → `./payout.service.js`
   - `src/payout/payout.module.ts`: `./payout.worker` → `./payout.worker.js`
   - `src/payout/payout.repository.ts`: `../common/app-error` → `../common/app-error.js`
   - `src/payout/payout.repository.ts`: `../prisma/prisma.service` → `../prisma/prisma.service.js`
   - `src/payout/payout.service.ts`: `../common/app-error` → `../common/app-error.js`
   - `src/payout/payout.service.ts`: `./payout.dto` → `./payout.dto.js`
   - `src/payout/payout.service.ts`: `./payout.repository` → `./payout.repository.js`
   - `src/payout/payout.service.ts`: `./transfer.provider` → `./transfer.provider.js`
   - `src/payout/payout.worker.ts`: `./payout.service` → `./payout.service.js`
   - `src/prisma/prisma.module.ts`: `./prisma.service` → `./prisma.service.js`
   - `src/common/error-envelope.filter.ts`: `./app-error` → `./app-error.js`
   - `test/payout.spec.ts`: `../src/app.module` → `../src/app.module.js`
   - `test/payout.spec.ts`: `../src/prisma/prisma.service` → `../src/prisma/prisma.service.js`
   - `test/payout.spec.ts`: `../src/payout/payout.service` → `../src/payout/payout.service.js`
   - `test/payout.spec.ts`: `../src/payout/payout.worker` → `../src/payout/payout.worker.js`
   - `test/payout.spec.ts`: `../src/payout/transfer.provider` → `../src/payout/transfer.provider.js`

   **Category 2: Missing type declarations for external packages (TS2307)**
   - `src/common/error-envelope.filter.ts`: `express` — needs `@types/express`
   - `src/payout/payout.controller.ts`: `express` — needs `@types/express`
   - `src/payout/payout.dto.ts`: `class-validator` — needs the package installed (it ships its own types)
   - `test/payout.spec.ts`: `supertest` — needs `@types/supertest`
   - `test/payout.spec.ts`: `@nestjs/testing` — needs the package installed

   Wait, but the instructions say "Change exactly what the compiler requires." If the packages aren't installed, I can't fix that by editing source files. Unless there's a `package.json` I should modify? But the instructions say "Do not add features" and "Return only the files you changed."

   Hmm, but actually — if `class-validator` isn't found, maybe the issue is that the types need to be referenced differently. Let me think...

   Actually, `class-validator` ships its own TypeScript types. If it's not found, it means the package isn't installed. Same for `@nestjs/testing`, `supertest`, `express`.

   But wait — the task says "Fix all of them in one reply" and the format says to return changed files. If the issue is missing packages, I can't fix that by editing source files. Unless...

   Actually, looking more carefully at the error list, I think the primary issue is the missing `.js` extensions. The "Cannot find module" errors for external packages (`express`, `class-validator`, `supertest`, `@nestjs/testing`) are a separate issue that would require installing packages, not editing files.

   But the instructions say to fix ALL errors. Let me re-read: "Fix all of them in one reply."

   Hmm, but I can only return file contents. I can't run `npm install`. So maybe the external package errors are expected to be resolved by the package.json already having those dependencies, and the real issue is just the TypeScript configuration or the imports.

   Wait, actually — if `express` types are missing, maybe the import should use `import type { Response } from 'express'` which would still fail if the types aren't installed. Or maybe the project uses a different HTTP framework.

   Actually, looking at the reference code, it uses `import type { Response } from 'express'` — this is standard NestJS. The types for express come from `@types/express`. If they're not installed, that's a dependency issue.

   Let me focus on what I CAN fix by editing files:
   1. Add `.js` extensions to all relative imports
   2. Fix the `ValidationException` import (TS2305)
   3. Fix the `unknown` type errors (TS18046)
   4. Fix the implicit `any` type errors (TS7006)

   For the missing package errors (express, class-validator, supertest, @nestjs/testing), I'll assume these are installed but their types aren't being picked up. Actually, if they're truly not installed, no file edit will fix that. Let me just focus on what I can fix.

   Actually wait — let me reconsider. The problem says "The typecheck failed" and lists all errors. Maybe the package.json already has these dependencies and the issue is just the TypeScript config. But I'm told to fix the errors in the files. If the packages are installed but TypeScript can't find them, maybe there's a `tsconfig.json` issue. But I'm not asked to change tsconfig.

   Let me just fix what I can in the source files:

   **Fix 1: Add `.js` to all relative imports**

   **Fix 2: `ValidationException` is not exported from `@nestjs/common`**
   Looking at `src/common/error-envelope.filter.ts`:
   ```ts
   import { ValidationException } from '@nestjs/common';
   ```
   In newer versions of NestJS, `ValidationException` is not a class in `@nestjs/common`. The validation errors from `class-validator` pipe throw `BadRequestException` or `HttpException` with status 400. Actually, looking at NestJS source, there IS no `ValidationException` class exported from `@nestjs/common`. The `ValidationPipe` throws a `BadRequestException`.

   So the fix is to remove `ValidationException` from the import and handle validation errors differently. Looking at the code:
   ```ts
   if (exception instanceof ValidationException) {
   ```
   This should probably be replaced with checking for `HttpException` with status 400, or checking for the specific response shape.

   Actually, in NestJS, when `ValidationPipe` fails, it throws a `BadRequestException`. So the check should be:
   ```ts
   if (exception instanceof HttpException && exception.getStatus() === HttpStatus.BAD_REQUEST) {
   ```
   
   But wait, that would conflict with the generic `HttpException` handler below. Let me look at the structure:

   ```ts
   private envelopeOf(exception: unknown): { code: string; message: string; details: Record<string, unknown> } {
     if (exception instanceof AppError) { ... }
     if (exception instanceof ValidationException) { ... }  // THIS
     if (exception instanceof HttpException) { ... }
     return { code: 'internal_error', ... };
   }
   ```

   The fix: remove `ValidationException` from the import, and replace the `instanceof ValidationException` check with a check for `HttpException` with status 400 that has a specific response shape (the class-validator response has a `message` that's an array).

   Actually, let me look at what `ValidationPipe` actually throws. In NestJS, `ValidationPipe` extends `HttpException` and when validation fails, it creates a `BadRequestException` with the validation errors. The response object looks like:
   ```json
   {
     "statusCode": 400,
     "message": ["field must be a string", ...],
     "error": "Bad Request"
   }
   ```

   So the check should be:
   ```ts
   if (exception instanceof HttpException && exception.getStatus() === 400) {
     const response = exception.getResponse();
     const raw = response && typeof response === 'object' ? (response as { message?: unknown }).message : undefined;
     const issues: unknown[] = Array.isArray(raw) ? raw : [exception.message];
     return { code: 'validation_error', message: 'The request body failed validation', details: { issues } };
   }
   ```

   But wait, this would also catch other 400 errors. Hmm. Actually, looking at the test:
   ```ts
   expect(invalid.status).toBe(400);
   expect(invalid.body.error.code).toBe('validation_error');
   ```

   So the test expects `validation_error` code for validation failures. The simplest fix that maintains the behavior is to check if it's an `HttpException` with status 400 and the response has an array `message` (which is the class-validator signature).

   Actually, let me simplify. The cleanest fix:
   - Remove `ValidationException` from the import
   - Change the check to detect validation errors by checking if it's a 400 HttpException with array message

   ```ts
   if (exception instanceof HttpException && exception.getStatus() === HttpStatus.BAD_REQUEST) {
     const response = exception.getResponse();
     const raw = response && typeof response === 'object' ? (response as { message?: unknown }).message : undefined;
     const issues: unknown[] = Array.isArray(raw) ? raw : [exception.message];
     return {
       code: 'validation_error',
       message: 'The request body failed validation',
       details: { issues },
     };
   }
   ```

   This goes BEFORE the general `HttpException` check.

   **Fix 3: `express` module not found**
   `import type { Response } from 'express'` — this needs `@types/express`. I can't install packages. But maybe I can use a different approach... Actually, in NestJS, you can get the response type from `@nestjs/common`'s `ArgumentsHost`. But the simplest fix is to just use `any` or a minimal type. But that changes the code structure.

   Actually wait — if `@types/express` is not installed, no import of express will work. The fix would be to not import from express. In NestJS, `@Res()` gives you the Express response, but you can type it without importing express directly.

   Hmm, but the instruction says "Change exactly what the compiler requires." If the module isn't found, I need to either:
   1. Install the package (can't do via file edits)
   2. Remove the import and use a different type

   For `src/common/error-envelope.filter.ts`, the `Response` type is used in:
   ```ts
   const response = host.switchToHttp().getResponse<Response>();
   ```
   
   I can change this to:
   ```ts
   const response = host.switchToHttp().getResponse();
   ```
   and then the type would be inferred. But `response.status()` and `response.json()` would need to be typed.

   Actually, the simplest approach: since I can't install packages, let me use a minimal type assertion or just remove the explicit type parameter:
   ```ts
   const response = host.switchToHttp().getResponse() as { status(code: number): any; json(body: any): any };
   ```
   
   Hmm, that's ugly. Let me think of another approach.

   Actually, you know what — I think the real issue might be that `@types/express` IS installed but TypeScript can't find it due to some config issue. But I'm told to fix the files, not the config. Let me just remove the `express` import and use a structural type.

   For `src/common/error-envelope.filter.ts`:
   ```ts
   // Remove: import type { Response } from 'express';
   // Change: const response = host.switchToHttp().getResponse<Response>();
   // To:      const response = host.switchToHttp().getResponse() as any;
   ```
   
   No, that's too hacky. Let me use:
   ```ts
   type HttpResponse = {
     status(code: number): HttpResponse;
     json(body: unknown): void;
   };
   ```
   
   Actually, the cleanest minimal fix: just remove the `Response` type import and cast:
   ```ts
   const response = host.switchToHttp().getResponse() as {
     status(code: number): unknown;
     json(body: unknown): void;
   };
   ```

   For `src/payout/payout.controller.ts`:
   ```ts
   import type { Response } from 'express';
   ```
   This is used in `@Res({ passthrough: true }) res: Response`. I can change the type annotation:
   ```ts
   @Res({ passthrough: true }) res: { status(code: number): unknown }
   ```

   **Fix 4: `class-validator` not found**
   `src/payout/payout.dto.ts` imports from `class-validator`. This package ships its own types. If it's not found, the package isn't installed. I can't fix this by editing the file unless I inline the decorators... which would be a major change.

   Hmm, this is tricky. Let me think about what's actually happening. The problem statement says "The typecheck failed" — implying the project was working before and something went wrong. The most likely cause of ALL these errors is a single root issue.

   Wait! Let me re-read the errors more carefully. The TS2307 errors for `express`, `class-validator`, `supertest`, `@nestjs/testing` — what if these packages ARE installed but the `node_modules` types aren't being resolved because of the `moduleResolution` setting?

   In `node16`/`nodenext` mode, package imports are resolved differently. But bare package imports (like `import 'express'`) should still work the same way — they look in `node_modules`.

   Actually, I just realized: maybe the issue is that `node_modules` simply isn't installed, or the `package.json` is missing these dependencies. But I can't fix that by editing source files.

   Let me re-read the instructions: "Fix all of them in one reply." and "Return only the files you changed."

   I think the pragmatic approach is:
   1. Fix all the `.js` extension issues (clearly a file-edit fix)
   2. Fix the `ValidationException` issue (file-edit fix)
   3. Fix the `unknown` type errors (file-edit fix)
   4. Fix the implicit `any` errors (file-edit fix)
   5. For missing packages, I'll have to work around them in the source files

   For `express`: I'll remove the import and use inline types.
   For `class-validator`: This is harder. The DTO file uses `@IsString()`, `@IsUUID()`, `@Matches()`, `@MaxLength()`, `@MinLength()` decorators and `registerDecorator`, `ValidatorConstraint`, `ValidatorConstraintInterface`. If the package isn't available, I'd need to stub these out... but that would be a massive change.

   Actually, wait. Let me reconsider the whole situation. The problem says these are the errors from the typechecker. In a real project, if `class-validator` isn't installed, you'd get this error. The fix would be to install it. But since I can only edit files...

   You know what, I think I'm overthinking this. Let me look at this from a different angle. The instructions say "Fix all of them in one reply" and the format is to return changed files. If some errors can only be fixed by installing packages, maybe I should still return the files with all the OTHER fixes applied, and the package installation is implied/assumed to happen separately.

   Actually, re-reading the prompt: "Change exactly what the compiler requires." — this means I should make the source code correct such that IF the packages are installed, the typecheck passes. The missing package errors are environment issues, not code issues.

   So my plan:
   1. Add `.js` extensions to ALL relative imports
   2. Fix `ValidationException` → use `HttpException` with status check
   3. Remove `import type { Response } from 'express'` and use inline types (since `@types/express` might not be available, but actually if it's a NestJS project, it should be... let me just remove the explicit type and let it be inferred)
   4. Fix `unknown` type errors in `error-envelope.filter.ts`
   5. Fix implicit `any` errors in `payout.repository.ts` and `test/payout.spec.ts`

   Wait, for `express` — if the package IS installed (which it must be for a NestJS project to work at runtime), then the types should be available. The error might be a red herring caused by the same root issue (maybe `node_modules` isn't installed). Let me just leave the express imports as-is and assume they'll resolve once dependencies are installed.

   Actually no — the instructions say "Fix all of them." Let me just fix what I can in the source files and leave the external package imports as they are (since they're correct code that just needs the packages installed).

   Hmm, but then I'm not fixing ALL errors. Let me re-read the instructions one more time...

   "Fix all of them in one reply." — I think this means: produce the corrected versions of all files that have errors, fixing whatever you can fix in the source code. The external dependency issues (missing `node_modules`) are not something I can fix by editing source files.

   OK let me just focus on the fixable errors:

   **Distinct mistakes:**

   1. **Missing `.js` extensions on relative imports** — affects many files
   2. **`ValidationException` doesn't exist in `@nestjs/common`** — affects `error-envelope.filter.ts`
   3. **`exception` is `unknown` and needs narrowing before property access** — affects `error-envelope.filter.ts` (the `statusOf` and `envelopeOf` methods access properties on `unknown` without narrowing)
   4. **Implicit `any` on `tx` parameter in `$transaction` callbacks** — affects `payout.repository.ts`
   5. **Implicit `any` on `r` parameter** — affects `payout.repository.ts` (line 319) and `test/payout.spec.ts` (multiple lines)

   Wait, for #4: `this.prisma.$transaction(async (tx) => { ... })` — the `tx` parameter should be typed by Prisma. If `@prisma/client` types are available, `tx` would be typed as `Prisma.TransactionClient`. The fact that it's `any` suggests `@prisma/client` types aren't being resolved. This is the same class of issue as the missing packages.

   For #5: In `test/payout.spec.ts`, the `.map((r) => ...)` and `.sort((a, b) => ...)` callbacks — if `supertest` types aren't available, the response type would be `any` and the callbacks would be implicitly `any`. Again, a missing package issue.

   So really, the ONLY things I can fix in source files are:
   1. Add `.js` extensions to relative imports
   2. Fix `ValidationException` usage
   3. Fix `unknown` type narrowing in `error-envelope.filter.ts`

   For #3, let me look at the specific errors:
   - Line 27: `this.statusOf(exception)` — wait, `exception` is the parameter of `catch()`. In `statusOf`, the parameter is `unknown`, and it does `exception instanceof AppError` which narrows it. Let me look at the actual code:

   ```ts
   private statusOf(exception: unknown): number {
     if (exception instanceof AppError) return exception.httpStatus;
     if (exception instanceof HttpException) return exception.getStatus();
     return HttpStatus.INTERNAL_SERVER_ERROR;
   }
   ```

   Wait, this should be fine — `instanceof` narrows `unknown`. Unless... the error is on a different line. Let me re-read:

   ```
   src/common/error-envelope.filter.ts(27,47): error TS18046: 'exception' is of type 'unknown'.
   src/common/error-envelope.filter.ts(34,22): error TS18046: 'exception' is of type 'unknown'.
   src/common/error-envelope.filter.ts(34,47): error TS18046: 'exception' is of type 'unknown'.
   src/common/error-envelope.filter.ts(34,75): error TS18046: 'exception' is of type 'unknown'.
   src/common/error-envelope.filter.ts(37,24): error TS18046: 'exception' is of type 'unknown'.
   src/common/error-envelope.filter.ts(40,61): error TS18046: 'exception' is of type 'unknown'.
   ```

   Line 27 column 47, line 34 (multiple), line 37, line 40. Let me count lines in the file:

   ```ts
   1: import {
   2:   ArgumentsHost,
   3:   Catch,
   4:   ExceptionFilter,
   5:   HttpException,
   6:   HttpStatus,
   7:   Logger,
   8:   ValidationException,
   9: } from '@nestjs/common';
   10: import type { Response } from 'express';
   11: import { AppError } from './app-error';
   12: (blank)
   13: @Catch()
   14: export class ErrorEnvelopeFilter implements ExceptionFilter {
   15:   private readonly logger = new Logger(ErrorEnvelopeFilter.name);
   16: (blank)
   17:   catch(exception: unknown, host: ArgumentsHost): void {
   18:     const response = host.switchToHttp().getResponse<Response>();
   19:     const status = this.statusOf(exception);
   20:     if (status >= 500) {
   21:       this.logger.error(exception instanceof Error ? exception.stack ?? exception.message : String(exception));
   22:     }
   23:     response.status(status).json({ error: this.envelopeOf(exception) });
   24:   }
   25: (blank)
   26:   private statusOf(exception: unknown): number {
   27:     if (exception instanceof AppError) return exception.httpStatus;
   28:     if (exception instanceof HttpException) return exception.getStatus();
   29:     return HttpStatus.INTERNAL_SERVER_ERROR;
   30:   }
   31: (blank)
   32:   private envelopeOf(exception: unknown): { code: string; message: string; details: Record<string, unknown> } {
   33:     if (exception instanceof AppError) {
   34:       return { code: exception.code, message: exception.message, details: exception.details };
   35:     }
   36:     if (exception instanceof ValidationException) {
   37:       const response = exception.getResponse();
   38:       const raw =
   39:         response && typeof response === 'object' ? (response as { message?: unknown }).message : undefined;
   40:       const issues: unknown[] = Array.isArray(raw) ? raw : [exception.message];
   41:       return {
   42:         code: 'validation_error',
   43:         message: 'The request body failed validation',
   44:         details: { issues },
   45:       };
   46:     }
   47:     if (exception instanceof HttpException) {
   48:       const response = exception.getResponse();
   49:       const message =
   50:         typeof response === 'string' ? response : String((response as { message?: unknown }).message ?? exception.message);
   51:       const code = exception.getStatus() === HttpStatus.NOT_FOUND ? 'resource_not_found' : 'bad_request';
   52:       const details =
   53:         response && typeof response === 'object' && !Array.isArray(response)
   54:           ? (response as Record<string, unknown>)
   55:           : {};
   56:       return { code, message, details };
   57:     }
   58:     return { code: 'internal_error', message: 'An unexpected error occurred', details: {} };
   59:   }
   60: }
   ```

   Wait, the line numbers in the errors don't quite match my counting. Let me recount with the actual file content from the reference:

   ```
   1:  import {
   2:    ArgumentsHost,
   3:    Catch,
   4:    ExceptionFilter,
   5:    HttpException,
   6:    HttpStatus,
   7:    Logger,
   8:    ValidationException,
   9:  } from '@nestjs/common';
   10: import type { Response } from 'express';
   11: import { AppError } from './app-error';
   12: 
   13: @Catch()
   14: export class ErrorEnvelopeFilter implements ExceptionFilter {
   15:   private readonly logger = new Logger(ErrorEnvelopeFilter.name);
   16: 
   17:   catch(exception: unknown, host: ArgumentsHost): void {
   18:     const response = host.switchToHttp().getResponse<Response>();
   19:     const status = this.statusOf(exception);
   20:     if (status >= 500) {
   21:       this.logger.error(exception instanceof Error ? exception.stack ?? exception.message : String(exception));
   22:     }
   23:     response.status(status).json({ error: this.envelopeOf(exception) });
   24:   }
   25: 
   26:   private statusOf(exception: unknown): number {
   27:     if (exception instanceof AppError) return exception.httpStatus;
   28:     if (exception instanceof HttpException) return exception.getStatus();
   29:     return HttpStatus.INTERNAL_SERVER_ERROR;
   30:   }
   31: 
   32:   private envelopeOf(exception: unknown): { code: string; message: string; details: Record<string, unknown> } {
   33:     if (exception instanceof AppError) {
   34:       return { code: exception.code, message: exception.message, details: exception.details };
   35:     }
   36:     if (exception instanceof ValidationException) {
   37:       const response = exception.getResponse();
   38:       const raw =
   39:         response && typeof response === 'object' ? (response as { message?: unknown }).message : undefined;
   40:       const issues: unknown[] = Array.isArray(raw) ? raw : [exception.message];
   41:       return {
   42:         code: 'validation_error',
   43:         message: 'The request body failed validation',
   44:         details: { issues },
   45:       };
   46:     }
   47:     if (exception instanceof HttpException) {
   48:       const response = exception.getResponse();
   49:       const message =
   50:         typeof response === 'string' ? response : String((response as { message?: unknown }).message ?? exception.message);
   51:       const code = exception.getStatus() === HttpStatus.NOT_FOUND ? 'resource_not_found' : 'bad_request';
   52:       const details =
   53:         response && typeof response === 'object' && !Array.isArray(response)
   54:           ? (response as Record<string, unknown>)
   55:           : {};
   56:       return { code, message, details };
   57:     }
   58:     return { code: 'internal_error', message: 'An unexpected error occurred', details: {} };
   59:   }
   60: }
   ```

   Error at line 27, col 47: `if (exception instanceof AppError) return exception.httpStatus;`
   Column 47 would be around `exception.httpStatus`. The issue: if `AppError` is not properly typed (because `./app-error` module isn't resolved due to missing `.js` extension), then `instanceof AppError` won't narrow `exception` from `unknown` to `AppError`. That's it!

   So the `unknown` errors are actually a CONSEQUENCE of the missing `.js` extension on `./app-error`. If `AppError` can't be resolved, TypeScript can't use it for narrowing.

   Similarly, `ValidationException` at line 8 — if it's not a valid export, the `instanceof` check won't narrow.

   And the `HttpException` checks — those should work fine since `HttpException` is a valid export from `@nestjs/common`.

   So actually, the `unknown` errors (TS18046) are caused by:
   1. `./app-error` not resolving (missing `.js` extension) → `AppError` is effectively `any` or unresolved → `instanceof` doesn't narrow
   2. `ValidationException` not being a valid export → `instanceof` doesn't narrow

   Wait, if `AppError` is unresolved, would `instanceof AppError` even compile? Actually, if the import fails, `AppError` would be of type `any` (with a TS2307 error), and `instanceof` with an `any` operand... hmm, actually TypeScript might still allow it but not narrow.

   Actually, I think when an import fails with TS2307, the imported name gets type `any`. Then `exception instanceof AppError` where `AppError` is `any` — TypeScript won't narrow because `any` isn't a constructor type it can reason about.

   So fixing the `.js` extension on `./app-error` should fix the `AppError`-related `unknown` errors.

   For `ValidationException` — since it's not a valid export, I need to remove it and use a different approach.

   Let me now also check: line 34 has THREE errors (cols 22, 47, 75):
   ```ts
   return { code: exception.code, message: exception.message, details: exception.details };
   ```
   This is inside `if (exception instanceof AppError)`. If `AppError` resolves properly (after adding `.js`), this should narrow correctly.

   Line 37: `const response = exception.getResponse();` — inside `if (exception instanceof ValidationException)`. Since `ValidationException` is invalid, this won't narrow. I need to restructure this.

   Line 40: `const issues: unknown[] = Array.isArray(raw) ? raw : [exception.message];` — same block, `exception` not narrowed.

   OK so my plan for `error-envelope.filter.ts`:
   1. Remove `ValidationException` from import
   2. Add `.js` to `./app-error` import
   3. Remove `import type { Response } from 'express'` and handle the response type differently
   4. Replace the `ValidationException` block with a check for `HttpException` with status 400

   For the `express` import: In the `catch` method, `host.switchToHttp().getResponse<Response>()` — I can change to `host.switchToHttp().getResponse()` and cast the result. Or I can just use `as any`. Actually, the cleanest approach in a NestJS project where express types might not be available:

   ```ts
   const response = host.switchToHttp().getResponse() as {
     status(code: number): unknown;
     json(body: unknown): void;
   };
   ```

   Actually, you know what, let me just remove the generic parameter:
   ```ts
   const response = host.switchToHttp().getResponse() as any;
   ```
   
   No, that's bad practice. Let me define a minimal interface:

   Actually, the simplest fix that the compiler requires: just remove the `Response` type parameter and cast. Or better, since this is a NestJS project, I can use the `IResponse` from `@nestjs/common`... but I'm not sure that's exported.

   Let me just do:
   ```ts
   const response = host.switchToHttp().getResponse() as {
     status(code: number): unknown;
     json(body: unknown): void;
   };
   ```

   This is clean and doesn't require express types.

   Now for `payout.controller.ts`:
   ```ts
   import type { Response } from 'express';
   ...
   @Res({ passthrough: true }) res: Response
   ```
   
   I'll change to:
   ```ts
   @Res({ passthrough: true }) res: { status(code: number): unknown }
   ```

   Now let me plan all the files I need to change:

   1. **`src/app.module.ts`** — add `.js` to 3 imports
   2. **`src/main.ts`** — add `.js` to 1 import
   3. **`src/common/error-envelope.filter.ts`** — remove `ValidationException`, remove `express` import, add `.js` to `./app-error`, fix the validation check
   4. **`src/payout/payout.controller.ts`** — remove `express` import, add `.js` to 2 imports
   5. **`src/payout/payout.module.ts`** — add `.js` to 5 imports
   6. **`src/payout/payout.repository.ts`** — add `.js` to 2 imports
   7. **`src/payout/payout.service.ts`** — add `.js` to 4 imports
   8. **`src/payout/payout.worker.ts`** — add `.js` to 1 import
   9. **`src/prisma/prisma.module.ts`** — add `.js` to 1 import
   10. **`test/payout.spec.ts`** — add `.js` to 5 imports

   Files I do NOT need to change:
   - `src/payout/payout.dto.ts` — the only error is `class-validator` not found, which is a package issue
   - `src/payout/payout.worker.ts` — wait, it has an error: `Cannot find module './payout.service'` → needs `.js`

   Let me double-check `payout.dto.ts`: the only error is `src/payout/payout.dto.ts(10,8): error TS2307: Cannot find module 'class-validator'`. This is a bare package import, not a relative import. I can't fix this by adding an extension. The package needs to be installed. I'll leave this file unchanged.

   Wait, but the instructions say "Fix all of them." If I can't fix the `class-validator` error, should I still return the file? No — the instructions say "Return only the files you changed." If I'm not changing it, I don't return it.

   Similarly for `supertest`, `@nestjs/testing`, `@types/express` — these are package issues I can't fix via source edits.

   But wait — for `test/payout.spec.ts`, I AM changing it (adding `.js` to relative imports). So I'll return it with those fixes, even though the `supertest` and `@nestjs/testing` errors will remain.

   OK let me now write out each file:

   **1. `src/app.module.ts`:**
   ```ts
   import { Module } from '@nestjs/common';
   import { APP_FILTER } from '@nestjs/core';
   import { ErrorEnvelopeFilter } from './common/error-envelope.filter.js';
   import { PayoutModule } from './payout/payout.module.js';
   import { PrismaModule } from './prisma/prisma.module.js';

   @Module({
     imports: [PrismaModule, PayoutModule],
     providers: [{ provide: APP_FILTER, useClass: ErrorEnvelopeFilter }],
   })
   export class AppModule {}
   ```

   **2. `src/main.ts`:**
   ```ts
   import { ValidationPipe } from '@nestjs/common';
   import { NestFactory } from '@nestjs/core';
   import { AppModule } from './app.module.js';

   async function bootstrap(): Promise<void> {
     const app = await NestFactory.create(AppModule);
     app.useGlobalPipes(
       new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
     );
     await app.listen(Number(process.env.PORT ?? 3000));
   }

   void bootstrap();
   ```

   **3. `src/common/error-envelope.filter.ts`:**
   Need to:
   - Remove `ValidationException` from import
   - Remove `import type { Response } from 'express'`
   - Add `.js` to `./app-error`
   - Replace `ValidationException` check with `HttpException` + status 400 check
   - Fix the response type

   ```ts
   import {
     ArgumentsHost,
     Catch,
     ExceptionFilter,
     HttpException,
     HttpStatus,
     Logger,
   } from '@nestjs/common';
   import { AppError } from './app-error.js';

   @Catch()
   export class ErrorEnvelopeFilter implements ExceptionFilter {
     private readonly logger = new Logger(ErrorEnvelopeFilter.name);

     catch(exception: unknown, host: ArgumentsHost): void {
       const response = host.switchToHttp().getResponse() as {
         status(code: number): unknown;
         json(body: unknown): void;
       };
       const status = this.statusOf(exception);
       if (status >= 500) {
         this.logger.error(exception instanceof Error ? exception.stack ?? exception.message : String(exception));
       }
       response.status(status).json({ error: this.envelopeOf(exception) });
     }

     private statusOf(exception: unknown): number {
       if (exception instanceof AppError) return exception.httpStatus;
       if (exception instanceof HttpException) return exception.getStatus();
       return HttpStatus.INTERNAL_SERVER_ERROR;
     }

     private envelopeOf(exception: unknown): { code: string; message: string; details: Record<string, unknown> } {
       if (exception instanceof AppError) {
         return { code: exception.code, message: exception.message, details: exception.details };
       }
       if (exception instanceof HttpException && exception.getStatus() === HttpStatus.BAD_REQUEST) {
         const response = exception.getResponse();
         const raw =
           response && typeof response === 'object' ? (response as { message?: unknown }).message : undefined;
         const issues: unknown[] = Array.isArray(raw) ? raw : [exception.message];
         return {
           code: 'validation_error',
           message: 'The request body failed validation',
           details: { issues },
         };
       }
       if (exception instanceof HttpException) {
         const response = exception.getResponse();
         const message =
           typeof response === 'string' ? response : String((response as { message?: unknown }).message ?? exception.message);
         const code = exception.getStatus() === HttpStatus.NOT_FOUND ? 'resource_not_found' : 'bad_request';
         const details =
           response && typeof response === 'object' && !Array.isArray(response)
             ? (response as Record<string, unknown>)
             : {};
         return { code, message, details };
       }
       return { code: 'internal_error', message: 'An unexpected error occurred', details: {} };
     }
   }
   ```

   Wait, but the test expects:
   ```ts
   const invalid = await request(app.getHttpServer()).post('/payouts').send({...});
   expect(invalid.status).toBe(400);
   expect(invalid.body.error.code).toBe('validation_error');
   ```

   With my change, when `ValidationPipe` throws a `BadRequestException` (which extends `HttpException` with status 400), it will hit the `exception instanceof HttpException && exception.getStatus() === HttpStatus.BAD_REQUEST` check and return `validation_error`. 

   But what about other 400 errors? In this app, the only 400 should come from validation. So this is fine.

   Actually wait — there's a subtlety. The original code had `ValidationException` as a separate check BEFORE the general `HttpException` check. My replacement puts the 400 check also before the general `HttpException` check. The behavior is the same for the test cases.

   **4. `src/payout/payout.controller.ts`:**
   ```ts
   import { Body, Controller, HttpStatus, Post, Res } from '@nestjs/common';
   import type { Payout } from '@prisma/client';
   import { CreatePayoutDto } from './payout.dto.js';
   import { PayoutService } from './payout.service.js';

   function serializePayout(payout: Payout) {
     return {
       id: payout.id,
       accountId: payout.accountId,
       amount: payout.amountMinor.toString(),
       destinationAddress: payout.destinationAddress,
       idempotencyKey: payout.idempotencyKey,
       status: payout.status,
       txHash: payout.txHash,
       error: payout.error,
       createdAt: payout.createdAt,
       sentAt: payout.sentAt,
       completedAt: payout.completedAt,
     };
   }

   @Controller('payouts')
   export class PayoutController {
     constructor(private readonly payouts: PayoutService) {}

     @Post()
     async create(@Body() dto: CreatePayoutDto, @Res({ passthrough: true }) res: { status(code: number): unknown }) {
       const { payout, duplicate } = await this.payouts.createPayout(dto);
       if (duplicate) {
         res.status(HttpStatus.OK);
       }
       return { ...serializePayout(payout), duplicate };
     }
   }
   ```

   **5. `src/payout/payout.module.ts`:**
   ```ts
   import { Module } from '@nestjs/common';
   import { PayoutController } from './payout.controller.js';
   import { PayoutRepository } from './payout.repository.js';
   import { PayoutService } from './payout.service.js';
   import { PAYOUT_WORKER_OPTIONS, PayoutWorker, payoutWorkerOptionsFromEnv } from './payout.worker.js';
   import { InMemoryTransferProvider, TRANSFER_PROVIDER } from './transfer.provider.js';

   @Module({
     controllers: [PayoutController],
     providers: [
       PayoutService,
       PayoutRepository,
       PayoutWorker,
       { provide: TRANSFER_PROVIDER, useClass: InMemoryTransferProvider },
       { provide: PAYOUT_WORKER_OPTIONS, useFactory: payoutWorkerOptionsFromEnv },
     ],
   })
   export class PayoutModule {}
   ```

   **6. `src/payout/payout.repository.ts`:**
   Just add `.js` to the two relative imports:
   - `../common/app-error` → `../common/app-error.js`
   - `../prisma/prisma.service` → `../prisma/prisma.service.js`

   The full file:
   ```ts
   import { Injectable } from '@nestjs/common';
   import { PayoutStatus } from '@prisma/client';
   import type { Account, Payout } from '@prisma/client';
   import { InsufficientFundsError } from '../common/app-error.js';
   import { PrismaService } from '../prisma/prisma.service.js';
   // ... rest unchanged
   ```

   **7. `src/payout/payout.service.ts`:**
   Add `.js` to:
   - `../common/app-error` → `../common/app-error.js`
   - `./payout.dto` → `./payout.dto.js`
   - `./payout.repository` → `./payout.repository.js`
   - `./transfer.provider` → `./transfer.provider.js`

   **8. `src/payout/payout.worker.ts`:**
   Add `.js` to:
   - `./payout.service` → `./payout.service.js`

   **9. `src/prisma/prisma.module.ts`:**
   Add `.js` to:
   - `./prisma.service` → `./prisma.service.js`

   **10. `test/payout.spec.ts`:**
   Add `.js` to:
   - `../src/app.module` → `../src/app.module.js`
   - `../src/prisma/prisma.service` → `../src/prisma/prisma.service.js`
   - `../src/payout/payout.service` → `../src/payout/payout.service.js`
   - `../src/payout/payout.worker` → `../src/payout/payout.worker.js`
   - `../src/payout/transfer.provider` → `../src/payout/transfer.provider.js` (appears twice)

   Now let me also check: are there any other errors I'm missing?

   Looking at `src/payout/payout.repository.ts` errors:
   - Line 56, 144, 199: `Parameter 'tx' implicitly has an 'any' type` — this is in `$transaction(async (tx) => ...)` callbacks. If `@prisma/client` types are properly resolved, `tx` would be typed. This is a package resolution issue, not something I can fix in the source.
   - Line 319: `Parameter 'r' implicitly has an 'any' type` — this is in `.then((r) => r.count)`. If `PrismaService` types resolve, `r` would be typed. Also a package issue.

   And `test/payout.spec.ts` errors:
   - Lines 103, 104, 108, 157, 158, 269, 297: implicit `any` — these are in callbacks like `.map((r) => ...)` and `.sort((a, b) => ...)`. If `supertest` types resolve, the response type would be known. Package issue.

   So I'll fix the relative import extensions in these files but the implicit `any` errors will remain (they'll be resolved once packages are properly installed).

   Let me now write out all the files completely.

   Actually, wait. Let me reconsider the `express` situation. In a NestJS project, `@types/express` is typically a dependency (either direct or transitive via `@nestjs/platform-express`). If the project uses NestJS, express types should be available. The fact that the compiler says "Cannot find module 'express'" suggests either:
   1. `@types/express` isn't installed
   2. The `node_modules` directory is missing

   In either case, I can't fix it by editing source files. But I can avoid the import by using inline types. I'll do that.

   Actually, hold on. Let me reconsider whether I should really remove the `express` import. The instructions say "Change exactly what the compiler requires." If the compiler can't find `express`, the fix is either:
   a) Install `@types/express` (not a file edit)
   b) Remove the import and use a different approach (file edit)

   Since I can only do file edits, I'll go with (b).

   But actually, I want to be careful. If I remove the `express` import and the package IS actually installed (just not resolved due to some other issue), my change is unnecessary but not harmful. If the package is NOT installed, my change is necessary. Either way, removing the import and using inline types is safe.

   OK, let me finalize my file list and write them out.

   Wait, one more thought on `payout.dto.ts`. The error is:
   ```
   src/payout/payout.dto.ts(10,8): error TS2307: Cannot find module 'class-validator' or its corresponding type declarations.
   ```

   `class-validator` is a bare package import. I can't fix this by adding an extension. The package needs to be installed. I'll leave this file unchanged.

   Let me also check if there are any other files with errors that I haven't accounted for:
   - `src/app.module.ts` ✓
   - `src/common/error-envelope.filter.ts` ✓
   - `src/main.ts` ✓
   - `src/payout/payout.controller.ts` ✓
   - `src/payout/payout.dto.ts` — only `class-validator` error, can't fix
   - `src/payout/payout.module.ts` ✓
   - `src/payout/payout.repository.ts` ✓
   - `src/payout/payout.service.ts` ✓
   - `src/payout/payout.worker.ts` ✓
   - `src/prisma/prisma.module.ts` ✓
   - `test/payout.spec.ts` ✓

   That's 10 files to change (excluding `payout.dto.ts`).

   Now let me write the complete content for each file. I need to be careful to preserve all the existing code and only change the imports (and the `error-envelope.filter.ts` structural changes).
```

## reply

Looking at the errors as a whole, I identify **three distinct mistakes**:

1. **Missing `.js` extensions on relative imports** — the project uses `node16`/`nodenext` module resolution which requires explicit extensions. This is the dominant error, repeated across 10 files.
2. **`ValidationException` is not an export of `@nestjs/common`** — this one bad name in `error-envelope.filter.ts` also causes the downstream `unknown` narrowing failures (TS18046) because `instanceof` against an unresolved/invalid type doesn't narrow.
3. **`import type { Response } from 'express'`** — the `@types/express` module isn't resolvable; replace with a structural type.

The `class-validator`, `supertest`, `@nestjs/testing`, and `@prisma/client` "Cannot find module" errors are package-resolution issues (missing `node_modules`), not source-code errors I can fix by editing files. The implicit-`any` errors in `payout.repository.ts` and `test/payout.spec.ts` are downstream of those same unresolvable package types.

### src/app.module.ts
```ts
import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { ErrorEnvelopeFilter } from './common/error-envelope.filter.js';
import { PayoutModule } from './payout/payout.module.js';
import { PrismaModule } from './prisma/prisma.module.js';

@Module({
  imports: [PrismaModule, PayoutModule],
  providers: [{ provide: APP_FILTER, useClass: ErrorEnvelopeFilter }],
})
export class AppModule {}
```

### src/main.ts
```ts
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  await app.listen(Number(process.env.PORT ?? 3000));
}

void bootstrap();
```

### src/common/error-envelope.filter.ts
```ts
import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { AppError } from './app-error.js';

@Catch()
export class ErrorEnvelopeFilter implements ExceptionFilter {
  private readonly logger = new Logger(ErrorEnvelopeFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse() as {
      status(code: number): unknown;
      json(body: unknown): void;
    };
    const status = this.statusOf(exception);
    if (status >= 500) {
      this.logger.error(exception instanceof Error ? exception.stack ?? exception.message : String(exception));
    }
    response.status(status).json({ error: this.envelopeOf(exception) });
  }

  private statusOf(exception: unknown): number {
    if (exception instanceof AppError) return exception.httpStatus;
    if (exception instanceof HttpException) return exception.getStatus();
    return HttpStatus.INTERNAL_SERVER_ERROR;
  }

  private envelopeOf(exception: unknown): { code: string; message: string; details: Record<string, unknown> } {
    if (exception instanceof AppError) {
      return { code: exception.code, message: exception.message, details: exception.details };
    }
    if (exception instanceof HttpException && exception.getStatus() === HttpStatus.BAD_REQUEST) {
      const response = exception.getResponse();
      const raw =
        response && typeof response === 'object' ? (response as { message?: unknown }).message : undefined;
      const issues: unknown[] = Array.isArray(raw) ? raw : [exception.message];
      return {
        code: 'validation_error',
        message: 'The request body failed validation',
        details: { issues },
      };
    }
    if (exception instanceof HttpException) {
      const response = exception.getResponse();
      const message =
        typeof response === 'string' ? response : String((response as { message?: unknown }).message ?? exception.message);
      const code = exception.getStatus() === HttpStatus.NOT_FOUND ? 'resource_not_found' : 'bad_request';
      const details =
        response && typeof response === 'object' && !Array.isArray(response)
          ? (response as Record<string, unknown>)
          : {};
      return { code, message, details };
    }
    return { code: 'internal_error', message: 'An unexpected error occurred', details: {} };
  }
}
```

### src/payout/payout.controller.ts
```ts
import { Body, Controller, HttpStatus, Post, Res } from '@nestjs/common';
import type { Payout } from '@prisma/client';
import { CreatePayoutDto } from './payout.dto.js';
import { PayoutService } from './payout.service.js';

function serializePayout(payout: Payout) {
  return {
    id: payout.id,
    accountId: payout.accountId,
    amount: payout.amountMinor.toString(),
    destinationAddress: payout.destinationAddress,
    idempotencyKey: payout.idempotencyKey,
    status: payout.status,
    txHash: payout.txHash,
    error: payout.error,
    createdAt: payout.createdAt,
    sentAt: payout.sentAt,
    completedAt: payout.completedAt,
  };
}

@Controller('payouts')
export class PayoutController {
  constructor(private readonly payouts: PayoutService) {}

  @Post()
  async create(@Body() dto: CreatePayoutDto, @Res({ passthrough: true }) res: { status(code: number): unknown }) {
    const { payout, duplicate } = await this.payouts.createPayout(dto);
    if (duplicate) {
      // idempotent replay of an existing payout: not a new resource
      res.status(HttpStatus.OK);
    }
    return { ...serializePayout(payout), duplicate };
  }
}
```

### src/payout/payout.module.ts
```ts
import { Module } from '@nestjs/common';
import { PayoutController } from './payout.controller.js';
import { PayoutRepository } from './payout.repository.js';
import { PayoutService } from './payout.service.js';
import { PAYOUT_WORKER_OPTIONS, PayoutWorker, payoutWorkerOptionsFromEnv } from './payout.worker.js';
import { InMemoryTransferProvider, TRANSFER_PROVIDER } from './transfer.provider.js';

@Module({
  controllers: [PayoutController],
  providers: [
    PayoutService,
    PayoutRepository,
    PayoutWorker,
    { provide: TRANSFER_PROVIDER, useClass: InMemoryTransferProvider },
    { provide: PAYOUT_WORKER_OPTIONS, useFactory: payoutWorkerOptionsFromEnv },
  ],
})
export class PayoutModule {}
```

### src/payout/payout.repository.ts
```ts
import { Injectable } from '@nestjs/common';
import { PayoutStatus } from '@prisma/client';
import type { Account, Payout } from '@prisma/client';
import { InsufficientFundsError } from '../common/app-error.js';
import { PrismaService } from '../prisma/prisma.service.js';

export interface CreatePayoutInput {
  accountId: string;
  amountMinor: bigint;
  destinationAddress: string;
  idempotencyKey: string;
}

export interface DueMessage {
  id: string;
  payoutId: string;
  attempts: number;
}

/**
 * The only layer that touches the database. Every payout state change is a
 * guarded UPDATE (WHERE status = expected) so that at-least-once message
 * delivery can never apply a transition twice.
 */
@Injectable()
export class PayoutRepository {
  constructor(private readonly prisma: PrismaService) {}

  findAccount(id: string): Promise<Account | null> {
    return this.prisma.account.findUnique({ where: { id } });
  }

  findPayoutByIdempotencyKey(idempotencyKey: string): Promise<Payout | null> {
    return this.prisma.payout.findUnique({ where: { idempotencyKey } });
  }

  async findPayoutForMessage(messageId: string): Promise<Payout | null> {
    const message = await this.prisma.payoutMessage.findUnique({
      where: { id: messageId },
      include: { payout: true },
    });
    return message ? message.payout : null;
  }

  /**
   * Creates the payout, atomically reserves its amount, posts the balanced
   * reserve entries and enqueues the outbox message — all or nothing.
   *
   * The payout row is inserted first, so a duplicate idempotency key aborts
   * the transaction (unique constraint) before any funds are touched.
   * The reserve is a single conditional UPDATE: concurrent requests are
   * serialized on the account row and the WHERE clause is re-evaluated
   * against the latest committed value, so the account cannot be overdrawn.
   */
  async createPayoutWithReserve(input: CreatePayoutInput): Promise<Payout> {
    return this.prisma.$transaction(async (tx) => {
      const payout = await tx.payout.create({
        data: {
          accountId: input.accountId,
          amountMinor: input.amountMinor,
          destinationAddress: input.destinationAddress,
          idempotencyKey: input.idempotencyKey,
          status: PayoutStatus.CREATED,
        },
      });

      const reserved = await tx.$queryRaw<Array<{ settled_minor: bigint; held_minor: bigint }>>`
        UPDATE "accounts"
        SET "held_minor" = "held_minor" + ${input.amountMinor},
            "updated_at" = now()
        WHERE "id" = ${input.accountId}
          AND "settled_minor" - "held_minor" >= ${input.amountMinor}
        RETURNING "settled_minor", "held_minor"
      `;

      if (reserved.length === 0) {
        const account = await tx.account.findUnique({ where: { id: input.accountId } });
        const availableMinor = account ? account.settledMinor - account.heldMinor : 0n;
        throw new InsufficientFundsError(input.accountId, input.amountMinor, availableMinor);
      }

      await tx.ledgerEntry.createMany({
        data: [
          {
            payoutId: payout.id,
            action: 'RESERVE',
            account: `settled:${input.accountId}`,
            debitMinor: input.amountMinor,
            creditMinor: 0n,
            memo: 'funds reserved for payout',
          },
          {
            payoutId: payout.id,
            action: 'RESERVE',
            account: `held:${input.accountId}`,
            debitMinor: 0n,
            creditMinor: input.amountMinor,
            memo: 'funds on hold for payout',
          },
        ],
      });

      await tx.payoutMessage.create({
        data: {
          payoutId: payout.id,
          payload: { payoutId: payout.id },
          nextAttemptAt: new Date(),
        },
      });

      return payout;
    });
  }

  // ---- payout transitions (guarded => idempotent under redelivery) ----

  async startPayoutProcessing(payoutId: string): Promise<boolean> {
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
      UPDATE "payouts"
      SET "status" = 'PROCESSING', "updated_at" = now()
      WHERE "id" = ${payoutId} AND "status" = 'CREATED'
      RETURNING "id"
    `;
    return rows.length > 0;
  }

  async markPayoutSent(payoutId: string, txHash: string): Promise<boolean> {
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
      UPDATE "payouts"
      SET "status" = 'SENT', "tx_hash" = ${txHash}, "sent_at" = now(), "updated_at" = now()
      WHERE "id" = ${payoutId} AND "status" = 'PROCESSING'
      RETURNING "id"
    `;
    return rows.length > 0;
  }

  /**
   * SENT -> COMPLETED. Settles the account (settled and held both decrease by
   * the amount) and posts the balanced complete entries in one transaction.
   * Returns false when the payout is not in SENT, so duplicate delivery
   * cannot settle twice.
   */
  async finalizePayout(payoutId: string): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const payout = await tx.payout.findUnique({ where: { id: payoutId } });
      if (!payout || payout.status !== 'SENT') return false;

      const rows = await tx.$queryRaw<Array<{ id: string }>>`
        UPDATE "payouts"
        SET "status" = 'COMPLETED', "completed_at" = now(), "updated_at" = now()
        WHERE "id" = ${payoutId} AND "status" = 'SENT'
        RETURNING "id"
      `;
      if (rows.length === 0) return false;

      const settled = await tx.$queryRaw<Array<{ id: string }>>`
        UPDATE "accounts"
        SET "settled_minor" = "settled_minor" - ${payout.amountMinor},
            "held_minor" = "held_minor" - ${payout.amountMinor},
            "updated_at" = now()
        WHERE "id" = ${payout.accountId} AND "held_minor" >= ${payout.amountMinor}
        RETURNING "id"
      `;
      if (settled.length === 0) {
        throw new Error(`cannot settle payout ${payoutId}: expected hold is missing on the account`);
      }

      await tx.ledgerEntry.createMany({
        data: [
          {
            payoutId,
            action: 'COMPLETE',
            account: `held:${payout.accountId}`,
            debitMinor: payout.amountMinor,
            creditMinor: 0n,
            memo: 'provider confirmed the transfer; hold settled',
          },
          {
            payoutId,
            action: 'COMPLETE',
            account: 'transfers_out',
            debitMinor: 0n,
            creditMinor: payout.amountMinor,
            memo: 'funds left the platform via the provider',
          },
        ],
      });

      return true;
    });
  }

  /**
   * CREATED/PROCESSING -> FAILED. Releases the hold back to the available
   * balance and posts the balanced release entries (definitive provider
   * rejection: the transfer did not happen).
   */
  async failPayout(payoutId: string, reason: string): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const payout = await tx.payout.findUnique({ where: { id: payoutId } });
      if (!payout || (payout.status !== 'CREATED' && payout.status !== 'PROCESSING')) return false;

      const rows = await tx.$queryRaw<Array<{ id: string }>>`
        UPDATE "payouts"
        SET "status" = 'FAILED', "error" = ${reason}, "updated_at" = now()
        WHERE "id" = ${payoutId} AND "status" IN ('CREATED', 'PROCESSING')
        RETURNING "id"
      `;
      if (rows.length === 0) return false;

      const released = await tx.$queryRaw<Array<{ id: string }>>`
        UPDATE "accounts"
        SET "held_minor" = "held_minor" - ${payout.amountMinor}, "updated_at" = now()
        WHERE "id" = ${payout.accountId} AND "held_minor" >= ${payout.amountMinor}
        RETURNING "id"
      `;
      if (released.length === 0) {
        throw new Error(`cannot fail payout ${payoutId}: expected hold is missing on the account`);
      }

      await tx.ledgerEntry.createMany({
        data: [
          {
            payoutId,
            action: 'RELEASE',
            account: `held:${payout.accountId}`,
            debitMinor: payout.amountMinor,
            creditMinor: 0n,
            memo: 'definitive provider rejection; hold released',
          },
          {
            payoutId,
            action: 'RELEASE',
            account: `settled:${payout.accountId}`,
            debitMinor: 0n,
            creditMinor: payout.amountMinor,
            memo: 'funds returned to the available balance',
          },
        ],
      });

      return true;
    });
  }

  /**
   * CREATED/PROCESSING -> NEEDS_REVIEW. Retries were exhausted without a
   * definitive outcome. The hold is deliberately kept: the transfer may have
   * happened (a timeout is not a failure), and only manual on-chain
   * reconciliation may settle or release it.
   */
  async escalatePayout(payoutId: string, reason: string): Promise<boolean> {
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
      UPDATE "payouts"
      SET "status" = 'NEEDS_REVIEW', "error" = ${reason}, "updated_at" = now()
      WHERE "id" = ${payoutId} AND "status" IN ('CREATED', 'PROCESSING')
      RETURNING "id"
    `;
    return rows.length > 0;
  }

  // ---- outbox (message) operations ----

  takeDueMessages(limit: number): Promise<DueMessage[]> {
    return this.prisma.payoutMessage.findMany({
      where: { status: 'PENDING', nextAttemptAt: { lte: new Date() } },
      orderBy: { createdAt: 'asc' },
      take: limit,
      select: { id: true, payoutId: true, attempts: true },
    });
  }

  async claimMessage(messageId: string): Promise<boolean> {
    const result = await this.prisma.payoutMessage.updateMany({
      where: { id: messageId, status: 'PENDING' },
      data: { status: 'PROCESSING', attempts: { increment: 1 }, claimedAt: new Date() },
    });
    return result.count > 0;
  }

  markMessageProcessed(messageId: string): Promise<void> {
    return this.prisma.payoutMessage
      .updateMany({
        where: { id: messageId, status: 'PROCESSING' },
        data: { status: 'PROCESSED', processedAt: new Date(), lastError: null },
      })
      .then(() => undefined);
  }

  scheduleMessageRetry(messageId: string, nextAttemptAt: Date, lastError: string): Promise<void> {
    return this.prisma.payoutMessage
      .updateMany({
        where: { id: messageId, status: 'PROCESSING' },
        data: { status: 'PENDING', nextAttemptAt, lastError },
      })
      .then(() => undefined);
  }

  markMessageDead(messageId: string, lastError: string): Promise<void> {
    return this.prisma.payoutMessage
      .updateMany({
        where: { id: messageId, status: 'PROCESSING' },
        data: { status: 'DEAD', processedAt: new Date(), lastError },
      })
      .then(() => undefined);
  }

  /**
   * Re-queues messages stuck in PROCESSING (for example after a worker
   * crash). This is what makes delivery at-least-once; consumers must
   * therefore be idempotent (they are, via the guarded transitions).
   */
  recoverStaleMessages(cutoff: Date): Promise<number> {
    return this.prisma.payoutMessage
      .updateMany({
        where: { status: 'PROCESSING', claimedAt: { lt: cutoff } },
        data: { status: 'PENDING', claimedAt: null },
      })
      .then((r) => r.count);
  }
}
```

### src/payout/payout.service.ts
```ts
import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Payout } from '@prisma/client';
import { ResourceNotFoundError } from '../common/app-error.js';
import { CreatePayoutDto } from './payout.dto.js';
import { PayoutRepository } from './payout.repository.js';
import { DefinitiveTransferError, TRANSFER_PROVIDER, TransferProvider } from './transfer.provider.js';

export interface CreatePayoutResult {
  payout: Payout;
  duplicate: boolean;
}

export interface RetryPolicy {
  maxAttempts: number;
  backoffBaseMs: number;
  backoffMaxMs: number;
}

@Injectable()
export class PayoutService {
  constructor(
    private readonly repo: PayoutRepository,
    @Inject(TRANSFER_PROVIDER) private readonly provider: TransferProvider,
  ) {}

  /**
   * Creates a payout with an atomic reserve, or replays the existing payout
   * when the idempotency key was already used (no second payout, no second
   * reserve).
   */
  async createPayout(dto: CreatePayoutDto): Promise<CreatePayoutResult> {
    const account = await this.repo.findAccount(dto.accountId);
    if (!account) throw new ResourceNotFoundError('account', dto.accountId);

    const amountMinor = BigInt(dto.amount);

    try {
      const payout = await this.repo.createPayoutWithReserve({
        accountId: dto.accountId,
        amountMinor,
        destinationAddress: dto.destinationAddress,
        idempotencyKey: dto.idempotencyKey,
      });
      return { payout, duplicate: false };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const existing = await this.repo.findPayoutByIdempotencyKey(dto.idempotencyKey);
        if (existing) return { payout: existing, duplicate: true };
      }
      throw error;
    }
  }

  // ---- operations used by the polling worker ----

  findPayoutForMessage(messageId: string): Promise<Payout | null> {
    return this.repo.findPayoutForMessage(messageId);
  }

  takeDueMessages(limit: number) {
    return this.repo.takeDueMessages(limit);
  }

  claimMessage(messageId: string): Promise<boolean> {
    return this.repo.claimMessage(messageId);
  }

  markMessageProcessed(messageId: string): Promise<void> {
    return this.repo.markMessageProcessed(messageId);
  }

  scheduleMessageRetry(messageId: string, nextAttemptAt: Date, lastError: string): Promise<void> {
    return this.repo.scheduleMessageRetry(messageId, nextAttemptAt, lastError);
  }

  markMessageDead(messageId: string, lastError: string): Promise<void> {
    return this.repo.markMessageDead(messageId, lastError);
  }

  recoverStaleMessages(cutoff: Date): Promise<number> {
    return this.repo.recoverStaleMessages(cutoff);
  }

  /**
   * Drives one claimed message to a terminal (or retryable) state. Safe
   * under at-least-once delivery: every transition it applies is guarded by
   * the payout's current status, so a redelivered message is a no-op.
   */
  async processMessage(
    messageId: string,
    attemptNo: number,
    retry: RetryPolicy,
  ): Promise<'completed' | 'failed' | 'needs_review' | 'retry' | 'skipped'> {
    const payout = await this.repo.findPayoutForMessage(messageId);
    if (!payout) {
      await this.repo.markMessageDead(messageId, 'payout not found for message');
      return 'skipped';
    }

    switch (payout.status) {
      case 'COMPLETED':
      case 'FAILED':
        // already resolved by an earlier delivery
        await this.repo.markMessageProcessed(messageId);
        return 'skipped';
      case 'NEEDS_REVIEW':
        // deliberately never retried automatically
        await this.repo.markMessageDead(messageId, 'payout already escalated to manual review');
        return 'skipped';
      case 'SENT': {
        // crash recovery: the provider confirmed the transfer (txHash stored)
        // but settlement never ran. Finalizing is idempotent.
        await this.repo.finalizePayout(payout.id);
        await this.repo.markMessageProcessed(messageId);
        return 'completed';
      }
      case 'CREATED': {
        const started = await this.repo.startPayoutProcessing(payout.id);
        if (!started) {
          // a concurrent pass (redelivery) already advanced the payout;
          // leave the message for that pass / stale recovery
          return 'skipped';
        }
        // fall through: attempt the transfer
      }
      case 'PROCESSING': {
        try {
          const { txHash } = await this.provider.transfer({
            to: payout.destinationAddress,
            amount: payout.amountMinor,
          });
          await this.repo.markPayoutSent(payout.id, txHash);
          // the settled balance changes only here, on provider confirmation
          await this.repo.finalizePayout(payout.id);
          await this.repo.markMessageProcessed(messageId);
          return 'completed';
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          if (error instanceof DefinitiveTransferError) {
            // definitive: the transfer did not happen — fail and release the hold
            await this.repo.failPayout(payout.id, reason);
            await this.repo.markMessageProcessed(messageId);
            return 'failed';
          }
          if (attemptNo >= retry.maxAttempts) {
            // unknown outcome, retries exhausted: keep the hold and escalate.
            // A timeout is not a failure — the transfer may have landed — so
            // releasing the funds here could double-spend the customer.
            await this.repo.escalatePayout(
              payout.id,
              `retries exhausted without a definitive outcome: ${reason}`,
            );
            await this.repo.markMessageDead(messageId, reason);
            return 'needs_review';
          }
          const backoffMs = Math.min(retry.backoffMaxMs, retry.backoffBaseMs * 2 ** (attemptNo - 1));
          await this.repo.scheduleMessageRetry(messageId, new Date(Date.now() + backoffMs), reason);
          return 'retry';
        }
      }
      default:
        throw new Error(`unexpected payout status ${(payout as Payout).status} for message ${messageId}`);
    }
  }
}
```

### src/payout/payout.worker.ts
```ts
import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PayoutService } from './payout.service.js';

export interface PayoutWorkerOptions {
  /** start the polling interval when the module initializes (tests disable it) */
  autostart: boolean;
  /** poll every N milliseconds */
  intervalMs: number;
  /** maximum messages handled per poll */
  batchLimit: number;
  /** maximum transfer attempts before the payout is escalated to needs_review */
  maxAttempts: number;
  /** exponential backoff base, in milliseconds */
  backoffBaseMs: number;
  /** exponential backoff cap, in milliseconds */
  backoffMaxMs: number;
  /** a PROCESSING message older than this is assumed crashed and re-queued */
  staleProcessingMs: number;
}

export const PAYOUT_WORKER_OPTIONS = 'PAYOUT_WORKER_OPTIONS';

export function payoutWorkerOptionsFromEnv(): PayoutWorkerOptions {
  return {
    autostart: process.env.PAYOUT_WORKER_AUTOSTART !== 'false',
    intervalMs: Number(process.env.PAYOUT_WORKER_INTERVAL_MS ?? 5_000),
    batchLimit: Number(process.env.PAYOUT_WORKER_BATCH_LIMIT ?? 20),
    maxAttempts: Number(process.env.PAYOUT_MAX_ATTEMPTS ?? 3),
    backoffBaseMs: Number(process.env.PAYOUT_RETRY_BACKOFF_BASE_MS ?? 2_000),
    backoffMaxMs: Number(process.env.PAYOUT_RETRY_BACKOFF_MAX_MS ?? 30_000),
    staleProcessingMs: Number(process.env.PAYOUT_STALE_PROCESSING_MS ?? 60_000),
  };
}

/**
 * Polling worker: every `intervalMs` it reclaims crashed work and processes
 * every due outbox message. Delivery is at-least-once; the service applies
 * guarded transitions so redelivery is harmless.
 */
@Injectable()
export class PayoutWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PayoutWorker.name);
  private timer?: ReturnType<typeof setInterval>;

  constructor(
    private readonly payouts: PayoutService,
    @Inject(PAYOUT_WORKER_OPTIONS) private readonly options: PayoutWorkerOptions,
  ) {}

  onModuleInit(): void {
    if (!this.options.autostart) return;
    this.timer = setInterval(() => {
      this.processMessages().catch((error: unknown) => {
        this.logger.error(`processMessages failed: ${error instanceof Error ? error.message : String(error)}`);
      });
    }, this.options.intervalMs);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** One poll: reclaim stale work, then process every due message. */
  async processMessages(): Promise<number> {
    const staleCutoff = new Date(Date.now() - this.options.staleProcessingMs);
    await this.payouts.recoverStaleMessages(staleCutoff);

    const due = await this.payouts.takeDueMessages(this.options.batchLimit);
    let handled = 0;
    for (const message of due) {
      const claimed = await this.payouts.claimMessage(message.id);
      if (!claimed) continue; // another worker beat us to it
      try {
        await this.payouts.processMessage(message.id, message.attempts + 1, {
          maxAttempts: this.options.maxAttempts,
          backoffBaseMs: this.options.backoffBaseMs,
          backoffMaxMs: this.options.backoffMaxMs,
        });
      } catch (error) {
        // The message stays PROCESSING; stale recovery will re-queue it and
        // the payout is in a safe state (no partial transition is committed).
        this.logger.error(
          `failed to process message ${message.id}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      handled += 1;
    }
    return handled;
  }
}
```

### src/prisma/prisma.module.ts
```ts
import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service.js';

@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
```

### test/payout.spec.ts
```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { ValidationPipe } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { PayoutService } from '../src/payout/payout.service.js';
import { PAYOUT_WORKER_OPTIONS, PayoutWorker } from '../src/payout/payout.worker.js';
import { DefinitiveTransferError, TRANSFER_PROVIDER } from '../src/payout/transfer.provider.js';
import type { TransferProvider } from '../src/payout/transfer.provider.js';

class FakeProvider implements TransferProvider {
  calls: Array<{ to: string; amount: bigint }> = [];
  handler: (args: { to: string; amount: bigint }, callIndex: number) => { txHash: string } = () => ({
    txHash: '0xfake',
  });

  async transfer(args: { to: string; amount: bigint }): Promise<{ txHash: string }> {
    const callIndex = this.calls.length;
    this.calls.push(args);
    return this.handler(args, callIndex);
  }
}

describe('payouts', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let service: PayoutService;
  let worker: PayoutWorker;
  let provider: FakeProvider;

  const accountRow = async (accountId: string) => {
    const [row] = await prisma.$queryRaw<Array<{ settled_minor: bigint; held_minor: bigint }>>`
      SELECT "settled_minor", "held_minor" FROM "accounts" WHERE "id" = ${accountId}
    `;
    return row;
  };

  const ledgerTotals = async () => {
    const [row] = await prisma.$queryRaw<Array<{ total_debit: bigint; total_credit: bigint }>>`
      SELECT COALESCE(SUM("debit_minor"), 0)::bigint AS "total_debit",
             COALESCE(SUM("credit_minor"), 0)::bigint AS "total_credit"
      FROM "ledger_entries"
    `;
    return row;
  };

  const seedAccount = async (settledMinor: bigint) =>
    prisma.account.create({ data: { settledMinor, heldMinor: 0n } });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(TRANSFER_PROVIDER)
      .useValue(new FakeProvider())
      .overrideProvider(PAYOUT_WORKER_OPTIONS)
      .useValue({
        autostart: false,
        intervalMs: 10_000,
        batchLimit: 20,
        maxAttempts: 3,
        backoffBaseMs: 1,
        backoffMaxMs: 5,
        staleProcessingMs: 60_000,
      })
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();

    prisma = app.get(PrismaService);
    service = app.get(PayoutService);
    worker = app.get(PayoutWorker);
    provider = app.get(TRANSFER_PROVIDER) as FakeProvider;
  }, 30_000);

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE "ledger_entries", "payout_messages", "payouts", "accounts" CASCADE',
    );
    provider.calls = [];
    provider.handler = () => ({ txHash: '0xfake' });
  }, 30_000);

  it('never overdraws an account under concurrent payout requests', async () => {
    const account = await seedAccount(100_000n);
    const responses = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        request(app.getHttpServer()).post('/payouts').send({
          accountId: account.id,
          amount: '40000',
          destinationAddress: `destination-${String(i).padStart(2, '0')}`,
          idempotencyKey: `concurrency-${i}`,
        }),
      ),
    );

    const created = responses.filter((r) => r.status === 201);
    const rejected = responses.filter((r) => r.status === 409);
    expect(created).toHaveLength(2);
    expect(rejected).toHaveLength(6);
    expect(created[0].body).toMatchObject({ status: 'CREATED', amount: '40000', duplicate: false });
    expect(new Set(created.map((r) => r.body.id)).size).toBe(2);
    expect(rejected[0].body.error.code).toBe('insufficient_funds');
    expect(rejected[0].body.error.details).toEqual(
      expect.objectContaining({ accountId: account.id, requestedMinor: '40000' }),
    );

    const row = await accountRow(account.id);
    expect(row.settled_minor).toBe(100_000n); // settled balance changes only on confirmation
    expect(row.held_minor).toBe(80_000n); // exactly the two reserves, never more
  }, 20_000);

  it('replays the same idempotency key without a second payout or reserve', async () => {
    const account = await seedAccount(10_000n);
    const body = {
      accountId: account.id,
      amount: '3000',
      destinationAddress: 'destination-01',
      idempotencyKey: 'replay-key',
    };

    const first = await request(app.getHttpServer()).post('/payouts').send(body);
    const second = await request(app.getHttpServer()).post('/payouts').send(body);

    expect(first.status).toBe(201);
    expect(first.body.duplicate).toBe(false);
    expect(second.status).toBe(200);
    expect(second.body.duplicate).toBe(true);
    expect(second.body.id).toBe(first.body.id);

    expect(await prisma.payout.count({ where: { idempotencyKey: 'replay-key' } })).toBe(1);
    const row = await accountRow(account.id);
    expect(row.held_minor).toBe(3000n);
    expect(row.settled_minor).toBe(10_000n);
    const totals = await ledgerTotals();
    expect(totals.total_debit).toBe(totals.total_credit);
  });

  it('creates exactly one payout when the same idempotency key is raced', async () => {
    const account = await seedAccount(10_000n);
    const body = {
      accountId: account.id,
      amount: '3000',
      destinationAddress: 'destination-02',
      idempotencyKey: 'race-key',
    };
    const responses = await Promise.all(
      Array.from({ length: 4 }, () => request(app.getHttpServer()).post('/payouts').send(body)),
    );

    expect(responses.map((r) => r.status).sort((a, b) => a - b)).toEqual([200, 200, 200, 201]);
    expect(new Set(responses.map((r) => r.body.id)).size).toBe(1);
    expect(await prisma.payout.count({ where: { idempotencyKey: 'race-key' } })).toBe(1);
    expect((await accountRow(account.id)).held_minor).toBe(3000n);
  }, 20_000);

  it('settles a payout once even when its message is delivered twice', async () => {
    const account = await seedAccount(10_000n);
    const { payout } = await service.createPayout({
      accountId: account.id,
      amount: '2500',
      destinationAddress: 'destination-03',
      idempotencyKey: 'worker-once',
    });

    await worker.processMessages();

    let done = await prisma.payout.findUnique({ where: { id: payout.id } });
    expect(done?.status).toBe('COMPLETED');
    expect(done?.txHash).toBe('0xfake');
    expect(provider.calls).toHaveLength(1);
    expect((await accountRow(account.id)).settled_minor).toBe(7_500n);
    expect((await accountRow(account.id)).held_minor).toBe(0n);
    expect(await prisma.ledgerEntry.count()).toBe(4); // reserve(2) + complete(2)
    let totals = await ledgerTotals();
    expect(totals.total_debit).toBe(totals.total_credit);

    // duplicate delivery of the same message
    await prisma.payoutMessage.updateMany({
      where: { payoutId: payout.id },
      data: { status: 'PENDING', processedAt: null, lastError: null },
    });
    await worker.processMessages();

    done = await prisma.payout.findUnique({ where: { id: payout.id } });
    expect(done?.status).toBe('COMPLETED');
    expect(provider.calls).toHaveLength(1); // no second transfer
    expect((await accountRow(account.id)).settled_minor).toBe(7_500n);
    expect((await accountRow(account.id)).held_minor).toBe(0n);
    expect(await prisma.ledgerEntry.count()).toBe(4); // no double settlement
    totals = await ledgerTotals();
    expect(totals.total_debit).toBe(totals.total_credit);
    const message = await prisma.payoutMessage.findUnique({ where: { payoutId: payout.id } });
    expect(message?.status).toBe('PROCESSED');
  });

  it('recovers a payout left in SENT after a crash and settles it exactly once', async () => {
    const account = await seedAccount(10_000n);
    const { payout } = await service.createPayout({
      accountId: account.id,
      amount: '2500',
      destinationAddress: 'destination-04',
      idempotencyKey: 'crash-1',
    });

    // simulate a crash right after the txHash was recorded, before settlement;
    // the stale claim is then reclaimed by the worker
    await prisma.payout.update({
      where: { id: payout.id },
      data: { status: 'SENT', txHash: '0xcrash', sentAt: new Date() },
    });
    await prisma.payoutMessage.update({
      where: { payoutId: payout.id },
      data: { status: 'PROCESSING', claimedAt: new Date(Date.now() - 120_000) },
    });

    await worker.processMessages();

    const done = await prisma.payout.findUnique({ where: { id: payout.id } });
    expect(done?.status).toBe('COMPLETED');
    expect(done?.txHash).toBe('0xcrash');
    expect(provider.calls).toHaveLength(0); // no second transfer is attempted
    expect((await accountRow(account.id)).settled_minor).toBe(7_500n);
    expect((await accountRow(account.id)).held_minor).toBe(0n);
    expect(await prisma.ledgerEntry.count()).toBe(4);
    const message = await prisma.payoutMessage.findUnique({ where: { payoutId: payout.id } });
    expect(message?.status).toBe('PROCESSED');
  });

  it('exhausts bounded retries, keeps funds held and escalates to needs_review', async () => {
    const account = await seedAccount(10_000n);
    provider.handler = () => {
      throw new Error('provider timeout');
    };
    const { payout } = await service.createPayout({
      accountId: account.id,
      amount: '4000',
      destinationAddress: 'destination-05',
      idempotencyKey: 'retry-1',
    });

    let message = await prisma.payoutMessage.findUnique({ where: { payoutId: payout.id } });
    for (let i = 0; i < 8 && message?.status !== 'DEAD'; i++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      await worker.processMessages();
      message = await prisma.payoutMessage.findUnique({ where: { payoutId: payout.id } });
    }

    expect(message?.status).toBe('DEAD');
    expect(message?.attempts).toBe(3);
    expect(message?.lastError).toContain('provider timeout');

    const done = await prisma.payout.findUnique({ where: { id: payout.id } });
    expect(done?.status).toBe('NEEDS_REVIEW');
    expect(done?.error).toContain('provider timeout');

    // the safe choice: the hold is kept, the settled balance is untouched,
    // and nothing is settled or released in the ledger
    expect((await accountRow(account.id)).settled_minor).toBe(10_000n);
    expect((await accountRow(account.id)).held_minor).toBe(4000n);
    const actions = (
      await prisma.ledgerEntry.findMany({ where: { payoutId: payout.id }, select: { action: true } })
    ).map((e) => e.action);
    expect(actions).toEqual(['RESERVE', 'RESERVE']);
    expect(provider.calls).toHaveLength(3);
  }, 20_000);

  it('fails the payout and releases the hold on a definitive provider rejection', async () => {
    const account = await seedAccount(10_000n);
    provider.handler = () => {
      throw new DefinitiveTransferError('invalid destination address');
    };
    const { payout } = await service.createPayout({
      accountId: account.id,
      amount: '4000',
      destinationAddress: 'destination-06',
      idempotencyKey: 'definitive-1',
    });

    await worker.processMessages();

    const done = await prisma.payout.findUnique({ where: { id: payout.id } });
    expect(done?.status).toBe('FAILED');
    expect(done?.error).toContain('invalid destination');
    expect((await accountRow(account.id)).settled_minor).toBe(10_000n);
    expect((await accountRow(account.id)).held_minor).toBe(0n); // hold released back to available

    const actions = (
      await prisma.ledgerEntry.findMany({ where: { payoutId: payout.id }, select: { action: true } })
    )
      .map((e) => e.action)
      .sort();
    expect(actions).toEqual(['RELEASE', 'RESERVE']);
    const totals = await ledgerTotals();
    expect(totals.total_debit).toBe(totals.total_credit);

    const message = await prisma.payoutMessage.findUnique({ where: { payoutId: payout.id } });
    expect(message?.status).toBe('PROCESSED');
    expect(provider.calls).toHaveLength(1); // a definitive rejection is never retried
  });

  it('answers unknown accounts and invalid bodies with the error envelope', async () => {
    const missingAccount = '00000000-0000-4000-8000-000000000000';

    const notFound = await request(app.getHttpServer()).post('/payouts').send({
      accountId: missingAccount,
      amount: '100',
      destinationAddress: 'destination-07',
      idempotencyKey: 'envelope-1',
    });
    expect(notFound.status).toBe(404);
    expect(notFound.body.error.code).toBe('resource_not_found');
    expect(typeof notFound.body.error.message).toBe('string');
    expect(notFound.body.error.details).toEqual({ account: missingAccount });

    const invalid = await request(app.getHttpServer()).post('/payouts').send({
      accountId: 'not-a-uuid',
      amount: -5,
      destinationAddress: 'short',
      idempotencyKey: '',
    });
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.code).toBe('validation_error');
    expect(Array.isArray(invalid.body.error.details.issues)).toBe(true);
    expect(invalid.body.error.details.issues.length).toBeGreaterThanOrEqual(3);
  });
});
```
