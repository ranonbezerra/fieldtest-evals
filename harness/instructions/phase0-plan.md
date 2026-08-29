Read the problem statement above. Before any code exists, produce the plan the
implementation will follow.

Write `PLAN.md`. It is a specification. It is not an essay and it is not an
implementation.

It must contain these sections, in this order:

**1. Assumptions.** Every decision the statement leaves open, the choice you made,
and one line of why. If a decision would change the design and the statement does
not settle it, it belongs here. If the statement settles everything, say so.

**2. Data model.** The complete schema: every table or model, every column with its
type, every constraint, index and unique key. Say what each nullable column means
when it is null.

**3. Types and signatures.** Every exported type, interface, enum, class and function
signature the implementation will use, written out. Every error code and what raises
it. Every ordering rule between two operations that could be written in either order.

**4. Control flow.** The state machine, the transaction boundaries, and what is inside
each and what must not be. A table or short prose, not code.

**5. Tests.** One line per test: what it proves, and what would have to be broken for
it to fail.

**6. Manifest.** Last, and machine-read. Exactly this form:

    <!-- manifest
    path/to/file.ext | reads: other/path.ext, another.ext | what this file holds
    -->

Manifest rules:

- Every file the implementation needs, in the order they must be written.
- Under `reads:`, a file may name only files listed **above** it. `reads: -` if none.
- Paths are relative to the repository root you are creating.
- List only files you will actually write.

Rules for the plan itself:

- **Declare the types completely; leave the bodies out.** A body is local and can be
  written later against this document. A type is the thing the rest of the code has to
  agree with, and getting it wrong is one design error that becomes several coding
  errors somewhere else.
- **Every symbol you name here must be resolvable here.** Whoever implements this has
  no tools, no shell, no repository and nothing to read but this plan and the files its
  manifest lists. A name you use and do not define cannot be looked up.
- Nothing beyond the six sections.

Reply with the complete contents of `PLAN.md` and nothing else — no preamble, no
closing remark.
