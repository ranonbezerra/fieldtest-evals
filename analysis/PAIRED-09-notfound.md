# Problem 09, paired: the model axis tests the leak and calls it a pass

The level-2 issue lists this among its acceptance criteria:

    - A non-member requesting `GET /trips/:id` → not-found, not forbidden

The variant the model axis works from says nothing about it. The string does not appear:
no `403`, no `forbidden`, no `non-member`. Zero lines.

Both axes delivered a green suite. They assert opposite contracts.

    ladder rep1   ✓ answers a non-member with the same not-found as a missing trip
    model  rep4   ✓ forbids a non-member from viewing the trip
    model  rep3   ✓ rejects with forbidden when the caller is not a member

The model axis wrote **more** tests than the ladder on this problem — 18 and 16 against
19 — and used them to lock in the information leak. A 403 tells the caller the trip
exists. Ask for a range of ids, keep the ones that answer 403, and you have enumerated
private trips without being a member of any of them.

This is the second pair read, and the second time the two axes compile identically,
pass identically, and disagree about what correct means.

## How this case differs from 12, and why the difference matters

On 12 the issue did not name the trap. It said only:

    look for behaviour that consumers depend on and no test asserts

and the model went and found the missing `orderBy` on its own. That is the issue
teaching a habit.

Here the issue hands the answer over. `not-found, not forbidden` is the requirement,
stated. The model did not reason its way to it -- it was told, and complied, while the
axis that was not told chose the reasonable-looking wrong thing three times out of
three.

The second kind is less impressive and more useful. It is exactly the arrangement the
repository was built to evaluate: someone who already knows the answer writes it into
the issue, and a model small enough to run on a desk carries it out. What this pair
shows is that **without being told, the model does not get there** -- not once, in
three clean runs, on a distinction any reviewer would raise.

## What it does not show

One problem, two model runs against one ladder run. The ladder's four runs on 09 are
all green and all name the criterion, so the ladder side is solid; the model side is
three clean runs of which two were read here.

Neither observation moves a rate. Every run discussed compiles and passes.
