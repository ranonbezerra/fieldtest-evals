# Runs — 18 timing-equal enumeration defence

Created by `harness/ft-go`; nothing here is written by hand. Structure and rules are
the same as every other problem — see any sibling `runs/README.md`.

Two notes for this problem:

**Run the timing test on a quiet machine.** It measures wall time, and so does every
other process. A run judged on this machine while something else was resident is
measuring the machine — see [`harness/host-limits.md`](../../harness/host-limits.md).

**Read the test before believing it.** A timing test that samples once, or that
compares means without a threshold anyone justified, passes and fails at random. That
is worse than no test: it is a green check on a property nobody verified.
