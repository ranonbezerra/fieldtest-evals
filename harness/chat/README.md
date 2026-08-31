# The `chat` condition, run by hand

The comfortable path, made reproducible. It is not scriptable, so the protocol is
the instrument: follow it exactly or the run is not comparable to the others.

## Setup, once

**1. Start the line proxy.**

```bash
harness/chat/omlx-lineproxy.py            # listens on :9001, forwards to oMLX
```

Not optional. oMLX emits one SSE frame per token, so a path arrives split —
`">packages"`, `"/contracts/src"`, `"/auth/sign"`, `"-in.ts"` — and a client
that writes the file live to show a diff can close a tag on a chunk boundary. Three
files landed at a repository root that way, byte-perfect under truncated names. The
proxy holds content until a newline; every tag a client parses opens and closes within
one line, so line-buffering closes the whole class.

It also turns reasoning deltas into SSE comments: no tags reach anyone's parser, and
the connection stays alive through a long think.

A LaunchAgent keeps it up on this machine, so there is usually nothing to start.

**2. Point the client at the proxy, not the server.** Base URL `http://localhost:9001/v1`.

**3. Set the client's context window to 32768** — the same number as the server. A
client that thinks it has more will send more, and the server's refusal is a hard
error where the client's own trimming would have been graceful.

**4. Set temperature 1.0, top_p 0.95, top_k 20** — the model card's recommendation
for thinking mode, and the same as every other condition.

**5. Copy [`clinerules/`](clinerules/) into the run workspace as `.clinerules/`.**

## Per run

```bash
P=problems/01-payout-outbox
mkdir -p $P/runs/qwen3.8-27b-mlx-6bit--chat/variant-a/workspace
cp -r harness/chat/clinerules $P/runs/.../workspace/.clinerules
cp harness/cheatsheet/typescript-nestjs.md $P/runs/.../workspace/CHEATSHEET.md
```

Open the workspace in a fresh session with no history, then:

1. Attach `CHEATSHEET.md` as the first message. Nothing else.
2. Paste `variants/variant-a.md` **verbatim**, as the second message. It is the entire
   prompt.
3. **Steer nothing.** Approve tool calls, answer nothing. If the model asks a
   question, that is a result — record it and let the run end. Answering it makes the
   run measure you.
4. Stop when the model stops. Do not run the criteria in the session.

## Capture

This is the condition where capture is manual and therefore the condition where it
gets skipped. It is also the one where the transcript matters most, because the
failure mode being measured — the task being trimmed out of the window — is invisible
in the code and visible only in the session.

Save into the run directory:

- `transcript.md` — the **complete** session. Every message, every tool call, every
  file listing the client re-sent. Not a summary.
- `meta.yaml` — copy the shape `ft-go` writes, and fill by hand what applies:
  `runner: chat`, the client and its version, wall time, and the client's token
  counters if it shows them, marked `are_estimates: true`.
- `NOTES.md` — the things only a witness knows: whether the client re-sent the
  workspace listing, roughly when the context started climbing, whether it wrote
  outside the files the task named, and whether it ever asked a question.

## What to watch for while it runs

| What you see | What it means |
|---|---|
| The context counter climbing between messages while nothing new is read | the loop is growing. Past the window, the oldest turn — the task — goes first |
| A file appearing at the workspace root with a truncated name | the proxy is not in the path |
| A file written that the task never named | the boundary is not enforced here; note it, do not delete it |
| The model asking where something lives | record it verbatim. It is the clearest evidence of an unresolved reference |
