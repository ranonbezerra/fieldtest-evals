Write `PLAN.md` for the task above. It is a specification for whoever implements it,
who will have this document and nothing else.

Six sections, in this order, and nothing outside them:

**1. Assumptions.** Decisions the statement leaves open, with the choice and one line
of why. If it settles everything, write "none".

**2. Data model.** Every table, model or persistent structure, with columns and types.
Write "none" if the task has no persistence.

**3. Types and signatures.** Every exported type, interface, enum, class and function
signature. Every error and what raises it. Every ordering rule between two operations
that could be written in either order.

**4. Control flow.** State machine, transaction boundaries, what is inside each and
what must not be. Prose or a table, not code.

**5. Tests.** One line per test: what it proves.

**6. Manifest.** Last, and machine-read. Copy this shape exactly, replacing every part
of it:

    <!-- manifest
    src/thing.ts | reads: - | what it holds
    test/thing.test.ts | reads: src/thing.ts | what it proves
    -->

A file may name under `reads:` only files listed above it. `reads: -` if none. Paths
are relative to the repository root. List only files you will write.

---

**Declare the types completely; leave the bodies out.** A body is local and can be
written later against this document. A type is what the rest of the code must agree
with, and getting it wrong is one design error that becomes several coding errors
elsewhere.

**Every symbol you name must be resolvable here.** Whoever implements this has no
tools, no shell and nothing to read but this document and the files its manifest
lists.

**Do not deliberate in the output.** Where the task leaves a convention open — which
file something lives in, whether a config file is in scope, how a helper is named —
**choose, write it in section 1 in one line, and move on.** A wrong convention is
different, not wrong. Weighing one costs the budget this document needs.

**You have a hard output limit.** Reaching it means no plan at all, which is worse
than a terse one. Write the sections directly. No preamble, no working out, no
closing remarks — begin at "## 1. Assumptions".
