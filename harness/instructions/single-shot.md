Build the whole solution in one reply.

The task is above. Everything you can know is above: you have no tools, no shell and
no filesystem, and there will be no second request.

If files are given above the task, they are the existing codebase and they are real.
Work against them as they are written — their names, their types, their conventions.
Do not restate a file you are not changing, and do not invent a replacement for one
you were shown.

- Deliver every file the solution needs, complete, first line to last. Never a
  fragment, never an "unchanged" comment, never a diff.
- Decide the file layout yourself. Nothing here dictates one.
- If a symbol you need is genuinely absent from the task, do not guess in silence and
  do not reason around it: use the most defensible reading and mark it with one
  `// ASSUMPTION: <what was unresolved>` comment at the point it matters.

## Format, which is parsed mechanically

For each file, a level-3 heading holding **only its repository-relative path**,
immediately followed by one fenced block holding **only that file's content**:

### src/payout/payout.service.ts
```ts
import { Injectable } from '@nestjs/common';
// …the complete file…
```

### prisma/schema.prisma
```prisma
model Payout {
  // …
}
```

Nothing outside that pattern is read. A path that appears twice is taken once, at its
last occurrence. Prose between blocks is ignored, so keep it to nothing.

Begin with the first heading.
