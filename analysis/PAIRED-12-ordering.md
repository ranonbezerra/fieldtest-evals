# Problem 12, paired: the measure that separates the axes is not a measure

Every mechanical comparison between the two axes came back null.

    compile rate        ladder 85%   model 80%   Fisher p = 0.632
    green test suite    ladder 40%   model 38%   Fisher p = 0.838
    suite that fails    11 runs      11 runs

Counting tests said the same: 310 for the ladder against 417 for the model, the latter
inflated by a single run on 13 that produced 264. On every number available without
reading code, the level-2 issue buys nothing.

## Then the same problem, read

Problem 12 hides a trap. The original repository reads line items like this:

    return this.prisma.invoiceLineItem.findMany({ where: { invoiceId } });

No `orderBy`. The rows come back in insertion order because that is what the database
happens to return, and the original suite says so in a comment and asserts nothing:

    // insertion order, as the database returns it

The `position` column exists on the model, which is exactly what makes it a trap: it
looks like an ordering that was forgotten. It was not forgotten. It is behaviour
consumers depend on and no test protects, and the migration has to preserve it.

Both axes produced a passing suite. They assert opposite things.

    ladder rep4   ✓ returns line items in stored (insertion) order, not by position
    model  rep4   ✓ returns line items in position order even when stored out of order

The ladder preserved the behaviour. The model axis **repaired** it — added the
`orderBy` that looked missing, and then wrote a green test asserting the new behaviour
was correct. That is worse than leaving it untested. A failing test is a question; a
passing test asserting the wrong contract is an answer, and it is wrong.

The level-2 issue for this problem says, in §3:

    look for behaviour that consumers depend on and no test asserts

That sentence is the whole difference. It does not describe the trap, name the column,
or mention ordering. It tells the model what kind of thing to go looking for, and on
this run the model went and found it.

## What this does and does not establish

It does not move the rate. Both runs compiled; both suites are green; both would pass
any gate this repository runs. The difference is invisible to `tsc`, invisible to the
test count, and invisible to the pass rate — which is why four rounds on each axis
could not see it.

It is one problem and one pair of runs. The atomicity proof I earlier held up as the
ladder's strongest evidence turned out to be produced by **both** axes on this problem,
so the claim in that verdict -- that no condition had produced it -- was true against
the old campaigns and false against the paired model run. Corrected here.

What survives is narrower and more interesting than the claim it replaces: on a problem
whose difficulty is a **judgement about what not to change**, the issue changed the
answer. Three more pairs are being read to find out whether that holds.
