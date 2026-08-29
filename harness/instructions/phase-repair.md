`{{PATH}}` does not compile. These are the compiler's exact messages for the whole
workspace — not a summary of them:

```
{{ERRORS}}
```

Rewrite `{{PATH}}` complete, fixing what these messages require of this file.

- `PLAN.md` above still governs. **Do not drop a requirement to silence an error.** If
  satisfying the compiler seems to require abandoning something the plan specified,
  keep the plan and add one `// ASSUMPTION:` line saying what you could not reconcile.
- Change nothing the messages do not name.
- If a message refers to a shape you cannot see, say so in an `// ASSUMPTION:` line
  rather than guessing at it repeatedly.

Reply with the complete content of `{{PATH}}` inside one fenced block, and nothing else.
