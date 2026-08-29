# Self-test — minor-unit money helpers

Build a small TypeScript module for money in minor units.

## Requirements

1. A `Money` type and helpers to add and subtract amounts.
2. Subtracting below zero is an error, not a negative result.
3. A formatter that renders an amount as a decimal string with two places.
4. Tests covering the error case and the formatter's rounding boundary.

## Scope

Two source files at most, plus one test file. The module has **no runtime
dependencies**; Vitest and TypeScript are already installed and configured, so do not
write `package.json`, `tsconfig.json` or any other config.
