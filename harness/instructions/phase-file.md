Write exactly one file: `{{PATH}}`

`PLAN.md` above is your own specification and governs. This file: {{NOTE}}

- Write it complete, first line to last. Never a fragment, never an "unchanged"
  comment, never a diff.
- Implement exactly what the plan specifies for this file. Do not add an export, a
  feature or a file the plan does not name.
- Files shown read-only are references. Rely on them; never restate or rewrite them.
- You have no tools, no shell and no filesystem. Everything you can know is above.
- If a symbol you need is genuinely absent from both the plan and the references, do
  not guess in silence and do not reason around it: write the file using the most
  defensible reading and mark it with one `// ASSUMPTION: <what was unresolved>`
  comment at the point it matters.

Reply with the complete content of `{{PATH}}` inside one fenced block, and nothing
else — no explanation before it and none after.
