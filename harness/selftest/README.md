# Self-test

Not a problem. A deliberately tiny task, run through the whole harness, to prove the
machinery before a campaign spends hours on it:

```bash
. harness/ft-env.sh
harness/ft-go harness/selftest a
```

It exercises phase 0, the manifest parse, several file phases, the fingerprint check
and the capture. Expect a handful of minutes at the rates in `../README.md`.

Run it after any change to `ft-run`, `ft-aider`, `ft-go` or the phase instructions.
Its `runs/` output is disposable — delete it and run again.
