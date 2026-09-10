The typecheck failed. Below are every file that has errors and the compiler's complete
output.

Fix all of them in one reply.

You are seeing the whole set on purpose. Some of these errors are one mistake repeated
across files — a missing extension, a name that drifted, a convention applied in one
place and not another. Fixing them one file at a time cannot see that, and has not
worked: nineteen single-file rounds on this repository left twenty-one instances of the
same import error standing, each fixed and then re-introduced by the next file.

So before you write anything, read the error list as a whole and decide how many
distinct mistakes are in it. Then apply each decision everywhere it belongs.

- **Change exactly what the compiler requires.** This is not design work. The
  specification and the structure are settled; you are reconciling files that disagree.
- When two files disagree about a name, a signature or a type, **one of them is the
  definition**. Change the caller unless the definition is the thing the errors say is
  wrong.
- Do not add features, do not rename anything the errors do not mention, do not
  reorganise.
- Return **only the files you changed**. A file you did not need to touch must not
  appear.

## Format, which is parsed mechanically

For each file, a level-3 heading holding **only its repository-relative path**,
immediately followed by one fenced block holding **only that file's complete content**:

### src/thing/thing.service.ts
```ts
// the complete file, first line to last
```

Never a fragment, never a diff, never an "unchanged" comment. Nothing outside that
pattern is read.

## The errors

{{ERRORS}}
