# Canonicalization of report content

The structured JSON of an issued report version is the source of truth. The PDF
is a rendering of that JSON and is never part of the hash. An anchor is
`SHA-256(canonical_bytes)` where `canonical_bytes` is the UTF-8 encoding of the
canonical serialization below, written as 64 lowercase hex characters.

## Canonical serialization rules

Input: the parsed JSON value of the stored report version (a JSON object).

1. Objects
   - Keys are sorted lexicographically in UTF-16 code unit order (the default
     JavaScript `Array.prototype.sort` on strings) and emitted in that order.
   - A key whose value is `undefined` is omitted entirely (JSON.stringify
     semantics). After `JSON.parse` this cannot occur, so stored and supplied
     content behave identically.
   - Emitted compactly: `{"k1":v1,"k2":v2}` — no whitespace between tokens.
2. Arrays
   - Element order is significant and preserved: `[e1,e2,...]`.
3. Strings
   - Emitted with `JSON.stringify` escaping: quotes, backslashes and control
     characters are escaped; all other code points pass through unchanged.
4. Numbers
   - Emitted as the shortest decimal string that round-trips to the same
     IEEE-754 double — exactly what `JSON.stringify` produces (`12.5`, `100`,
     `1e+21`). Consequently `1.10` and `1.1` canonicalize identically, as do
     `1e2` and `100`, and `-0` and `0`.
   - Non-finite values (NaN, +/-Infinity) are not representable in JSON and are
     rejected, not hashed.
5. Booleans and null
   - The literals `true`, `false`, `null`.
6. Anything else
   - Any other JavaScript type (function, symbol, bigint, ...) is rejected.

## Worked example

    input:      { "b": 1, "a": { "d": 2, "c": [true, null] } }
    canonical:  {"a":{"c":[true,null],"d":2},"b":1}
    hash:       sha256(UTF-8(canonical)) in lowercase hex

## What does not affect the hash

- Key insertion order of objects.
- Whitespace and formatting of the original JSON text.
- Numeric notation that denotes the same double (`1.10` is `1.1`).
- The PDF rendering, file names, and any rendering metadata.

## Reproduction

An auditor recomputes the hash from the stored (or supplied) content as:
parse JSON, apply the rules above, UTF-8 encode, SHA-256, lowercase hex.
Reference implementation: `src/anchoring/canonicalize.ts`
(`canonicalize` and `canonicalHash`).
