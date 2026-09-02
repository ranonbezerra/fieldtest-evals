// ASSUMPTION: The plan's manifest states this file reads from
// src/operations/operations.types.ts and is "type-level only; no separate repo needed."
// We import from the types module rather than from operations.repository, which is
// not resolvable from this file's import context.

import type { ReDeriveInput } from "../operations/operations.types";

/**
 * Re-derivation reuses OperationsRepository directly; no separate repository
 * implementation is needed. This module exists to satisfy the layout convention
 * and to re-export the input type for consumers within the re-derivation feature.
 */
export type { ReDeriveInput };
