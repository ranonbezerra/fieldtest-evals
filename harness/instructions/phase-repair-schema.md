`prisma generate` failed. The schema below is yours; the error is Prisma's.

Return the corrected `schema.prisma`, complete, first line to last.

Nothing downstream of this can be fixed while it fails. The generated client does not
exist, so every model and every field the application references is unknown to the
compiler, and the TypeScript errors you would otherwise see are consequences rather
than causes.

- **Change only what the validation error requires.** Do not rename models, do not
  add fields the application does not use, do not reorganise.
- The most common cause is a relation written from one side only. Prisma requires the
  opposite field on the other model — a `Foo` with `bar Bar @relation(...)` needs a
  matching `foos Foo[]` on `Bar`. Adding the missing side is the fix; deleting the
  relation is not.
- Keep every `@@map`, `@@index`, `@@unique` and default exactly as they are unless the
  error names them.

Return the file inside one fenced block and nothing else.

## The error

{{ERRORS}}
