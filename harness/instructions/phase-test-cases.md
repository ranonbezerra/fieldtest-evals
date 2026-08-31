List the test cases for `{{PATH}}`. **Do not write the tests.**

`PLAN.md` above is your own specification, and the implementation files shown
read-only are what these tests will run against.

One line per case, in this shape:

    - <name of the test> — <what it proves, and what would have to be broken for it to fail>

Rules:

- Cover the behaviour the task statement asks to be tested, and the behaviour the
  plan says matters. A case per branch that could be wrong on its own.
- **Say what would have to break.** A case whose failure condition you cannot name is
  a case that will pass whatever the code does, and that is worse than no case.
- Include the cases that are awkward: concurrency, duplicate delivery, exhaustion,
  boundary values, the error path that looks like the success path.
- Name what you deliberately are **not** testing and why, in one closing line.

This is a list, not code. No imports, no `describe`, no assertions — those come next,
from this list. Reply with the list and nothing else.
