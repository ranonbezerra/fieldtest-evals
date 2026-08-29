# 10 — Adapt an existing screen for a new feature

## The real situation

The everyday front-end task is almost never "generate a page from a design". It
is: a working React app exists, a PM hands you a mockup or a paragraph, and you
**edit** live screens — add a capability, thread new state through existing
components, wire new API calls — without breaking anything already there. In one
real case, a UX pattern proven in one product (a persistent "active session" bar
visible on every screen) had to be ported into a different product's back-office.
That's the shape of this problem: modification under regression pressure.

Front-end benchmarks are catching up to this distinction: real UI development is
generation *plus* editing and repairing, iteratively, inside frameworks — and
models that generate impressive pages from scratch score very differently when
asked to change an existing one. Editing punishes exactly what unconditioned
generation hides: not reading the existing state management before adding your
own, duplicating a data-fetch that already exists one level up, restyling things
nobody asked about, and quietly breaking behaviors the diff never mentions.

The gate here is therefore twofold: the new capability works, **and** an
explicit list of existing behaviors still works. The judge reviews the diff, not
just the result — a rewrite that happens to work fails a problem about editing.

Variant C is deliberately underspecified (a one-paragraph PM request, no
mockup): assumptions must be surfaced, not guessed.

## Stack

React + TypeScript (Vite), react-query for server state, react-router. The
scaffold app per variant is small but real: routing, auth context, a list
screen, a detail screen.
