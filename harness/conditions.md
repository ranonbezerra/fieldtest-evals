# Three ways into the same model

There is one model server. There are three ways of reaching it, and this eval runs
all three, because all three are real ways to work and the differences between them
are a finding rather than a nuisance.

```
you ──► chat UI (Cline, or oMLX's own) ──► line proxy ──┐
     ──► aider  (ft-aider)                              ├──► oMLX ──► Qwen3.8-27B
     ──► direct API calls (ft-run)                      ┘
```

The order above is the order of comfort, and it is the reverse of the order of
measurement quality. That tension is the whole reason to document this rather than
pick one.

---

## Condition `chat` — a conversation, in Cline or the server's own chat

**What it is.** Natural language, no commands. You describe the task, the agent reads
files, writes them, runs things, and you steer as it goes. It is the most comfortable
of the three by a distance, and it was the default here until it started producing
problems that depended on the situation rather than on the task.

**What it uniquely gives.** Follow-up. You can ask what the model understood, look at
a file together, correct a misreading in one sentence. Nothing else on this page can
do that, and for work that is not a specified task it is the only sensible path.

**What it costs, measured.**

- **The loop grows its own context.** Every file read, every file written and every
  re-sent workspace listing goes back in. **Measured in the pilot, not here:** a task
  whose real content was 3,000 tokens was observed reaching 90,000, and the workspace
  file listing alone was 2,700 tokens, resent on every message.
- **Then it is trimmed, and the trim is silent.** The KV cache outgrowing what the GPU
  may wire aborts the request loudly. What happens *before* that is worse: the
  conversation is trimmed to fit, the oldest turn goes first, and the oldest turn is
  the task. The run then completes, plausibly, against instructions no longer in the
  window. Nothing in the output says so.
- **Streaming into a parser truncates paths.** oMLX emits one SSE frame per token, so
  a path arrives split — `">packages"`, `"/contracts/src"`, `"/auth/sign"`,
  `"-in.ts"`. A client that acts on the stream as it arrives, as Cline does to show a
  live diff, can close a tag on a chunk boundary. Three files landed at a repository
  root that way, each byte-perfect under a truncated name. The line proxy in
  [`chat/`](chat/) closes the whole class by holding content until a newline, since
  every tag a client parses opens and closes within one line.
- **It does not enforce a file boundary.** aider physically could not write outside
  the files it was given. An agent can, and does. Whatever contract you wrote is now
  a matter of the model's compliance.
- **The counters are not yours.** Token accounting is the client's, mixed with its
  own system prompt, its tool schemas and its retries.

**What a run in this condition can tell you:** whether the model is usable this way at
all, and where the loop breaks it. **What it cannot:** anything about the model that
is not entangled with the client. A failure here has at least two candidate causes and
the artifact usually cannot separate them.

**How it is run.** By hand — see [`chat/README.md`](chat/README.md). Point the client
at the line proxy, set its context window to the same number as the server, paste the
variant verbatim, steer nothing, and save the whole session as `transcript.md`.

---

## Condition `aider` — one command, one request

**What it is.** `ft-aider`: a single non-interactive aider invocation in whole-file
format, with the files it may write given as editable and everything else read-only.
One prefill, one generation, no loop. This is what the pilot used for roughly thirty
task executions, so numbers from this condition are comparable to that record.

**What it uniquely gives.** Speed and adaptability with almost no harness. It parses
the reply and writes the files, so a reply carrying several files lands correctly
without anyone inventing a convention for it. `--read` is a first-class notion. And
because there is no loop, none of the chat condition's context growth can happen.

**What it costs, measured.**

- **Unmeasured context.** aider prepends its own system prompt and edit-format
  instructions. Inside a 16,384-token output ceiling that reasoning is also paid out
  of, that is not free, and it is not the same across models.
- **The editable-files line is load-bearing and silent when wrong.** aider only writes
  files already in the chat. Omit one and it replies with prose, produces no listings,
  and the run ends having written nothing — which looks exactly like a model that had
  nothing to say.
- **Whole format re-emits everything.** A file that gains a method pays to re-emit
  what is already in it — 1,489 tokens on one task of the pilot, and rising with every
  task touching the same file. Against an output ceiling, that is budget spent copying
  code that is already on disk.
- **Exit 0 does not mean written.** aider has exited 0 having created the files empty
  and never filled them, three times in one epic of the pilot. `ft-aider` reports the byte count
  and fails on zero regardless of the exit code.
- **The counters are estimates.** aider's own, not the server's `usage` block, so
  tok/s here is wall-clock and not comparable line-for-line with the `api` condition.

**What a run in this condition can tell you:** how the model does when a competent,
general-purpose tool frames the request — which is what most people will actually
have. **What it cannot:** separate the model's contribution from aider's framing.

---

## Condition `api` — the harness talks to the server

**What it is.** `ft-run`: build the messages, POST them, read the reply, write the
file. The model has no tools, no shell, and nothing to read but what the phase named.

**What it uniquely gives.**

- **Nothing unmeasured in the prompt.** The system message is the cheatsheet and
  nothing else. Every token the model sees is on the command line.
- **The server's own counters.** `prompt_tokens`, `completion_tokens`, `finish_reason`,
  and oMLX's `total_time` and `model_load_duration` — so tok/s is generation rate
  rather than wall clock, and a phase that paid for a model reload is not scored as
  though generation were slow.
- **The file boundary is absolute.** The model never writes anything; the harness
  extracts the reply and writes the one file the phase named. A boundary that does not
  depend on compliance is not the same kind of object as one that does.
- **The reasoning is captured separately** (`reasoning_content`), which is what makes
  the "unresolved reference versus too many decisions" diagnosis possible at all.
- **`reasoning_effort` is reachable.** The model's own dial — `xhigh`/`medium`/`low` —
  is a request field, so this condition can leave it at the model's default and lower
  it as a recorded fallback when a phase overflows. Neither other condition can send
  it: aider has no flag for it, and a chat client sends whatever its own settings say.
- **No streaming parser, so the truncated-path class cannot occur.** Nothing is handed
  to a parser as it arrives.

**What it costs.**

- **The harness owns the convention.** "Reply with the file in one fenced block" is a
  rule the model can break, and when the artifact is itself markdown the rule needs an
  exception (`--verbatim`). aider had already solved this.
- **One file per request.** More requests, more prefills, and each re-sends the plan.
- **No interactive anything.** A phase that goes wrong goes wrong to completion.
- **More harness to maintain**, and a bug in it is indistinguishable from a bug in the
  model until someone reads the transcript.

**What a run in this condition can tell you:** the closest thing available to the
model's own contribution. **What it cannot:** how the model behaves when a tool is
steering it, which is how it will usually be used.

---

## Side by side

| | `chat` | `aider` | `api` |
|---|:--:|:--:|:--:|
| comfort | highest | good | lowest |
| follow-up possible | yes | no | no |
| context can grow past the task | **yes** | no | no |
| enforces which files may be written | no | yes | yes, absolutely |
| unmeasured prompt from the tool | large | moderate | none |
| token counters | client's | aider's estimate | **server's** |
| reasoning captured separately | no | no | **yes** |
| `reasoning_effort` controllable | no | no | **yes** |
| streaming-parser path truncation | possible | no | no |
| writes several files per reply | yes | yes | no |
| setup cost | line proxy + rules | one script | the harness |

---

## What the eval does with all three

Running every problem three ways would triple a campaign that already takes hours per
problem, and two of the three cannot separate model from tool anyway. So:

1. **`api` is the spine.** Every problem, every variant. This is the record.
2. **`aider` on a fixed subset** — problems 01 and 09, variant A. Same problems, same
   variant, different path. The gap between the two is the price of the tool, and it
   is a number rather than an assumption.
3. **`chat` on the same subset, by hand.** The comfortable path, measured once so its
   cost is on the record instead of in someone's memory. Expect it to fail differently
   rather than more, and record *how*.

When a run fails, the first question is always which of these it belongs to. That is
why `meta.yaml` records `runner`, and why the run directory is tagged with it.

## What all three share, and it is not the model

One machine, one memory pool. The model needs 22.27 GiB of a 48 GiB Mac, and the
server's ceiling **falls as anything else takes memory** — 37.44 GiB down to 32.36 GiB
inside one session, measured. Under swap pressure the server does not degrade, it
dies: recorded here as a phase that ran 46 minutes and produced zero bytes.

That lands hardest on the `chat` condition, and it is worth stating plainly, because
it is the comfortable one: an editor with its language servers, a container runtime
and a chat client are all resident **while the model is generating**. The condition
that costs the least effort costs the most memory, and the difference does not show up
as an error — it shows up as throughput that belongs to the machine.

[`host-limits.md`](host-limits.md) has the measurements and what to close.

## Holding them comparable

Whatever differs between conditions, these do not: the model, the quantization, the
cheatsheet, the variant text, the context window, and the rule that nobody steers a
run once it starts. Temperature, top_p and top_k are the model card's own
recommendation for thinking mode and are set identically in all three.

**One asymmetry is unavoidable and must be recorded rather than hidden:** only the
`api` condition can send `reasoning_effort`, so only it can lower the effort as a
fallback after a phase overflows. A run in the `aider` or `chat` condition that
overflows simply overflows. When comparing conditions, a ceiling hit in `api` that was
recovered by a retry is not the same event as one in `aider` that was not. Everything else about a condition is
what the condition is *for*.
