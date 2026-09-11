# Canonicalization for anchoring hashes

The anchor hash is computed over a canonical serialization of the structured
report content. The JSON document is the source of truth; the PDF is only a
rendering of it and is never hashed. This document is normative: an auditor
four years from now must be able to reproduce the exact hash from the content
and these rules alone.

Implementation: `src/anchoring/canonical-json.ts` (`canonicalize`,
`canonicalHash`).

## 1. Hash

`sha256:<64 lowercase hex characters>` — SHA-256 over the UTF-8 encoding of
the canonical string (section 2).

## 2. Canonical string

The input is a parsed JSON value (RFC 8259). Values that are not JSON values —
`undefined`, functions, symbols, BigInt, `NaN`, `±Infinity` — are rejected and
anchoring is refused (`invalid_content`).

- **Objects.** Members are ordered by key, keys compared as UTF-16 code unit
  sequences (for valid strings this equals Unicode code point order). No
  whitespace: `{"k1":v1,"k2":v2}`. If the original document contained
  duplicate member names, standard JSON parse semantics apply (last occurrence
  wins) before canonicalization.
- **Arrays.** Element order is preserved — order is meaningful. No
  whitespace: `[v1,v2]`.
- **Numbers.** Normalized to the value's shortest round-trip decimal form
  (ECMAScript `Number.prototype.toString`). Concretely: `1e5` and `100000`
  serialize identically, `1.10` becomes `1.1`, `-0` becomes `0`; exponent
  notation appears only when the engine emits it (e.g. `1e+21`). Two inputs
  with the same numeric value always canonicalize identically.
- **Strings.** Escape only what must be escaped:
  - `"` → `\"`, `\` → `\\`
  - backspace, form feed, newline, carriage return, tab → `\b` `\f` `\n` `\r` `\t`
  - any other character in U+0000–U+001F → `\uXXXX` (lowercase hex, zero-padded)
  - every other code point (U+0020 and above) appears literally; non-BMP
    characters are single code points (no surrogate splitting)
- **Booleans and null.** `true`, `false`, `null`.
- **Depth.** Nesting is limited to 200 levels; deeper input is rejected.

## 3. Encoding

The canonical string is encoded as UTF-8; the hash is computed over those
bytes.

## 4. Worked example

Content (key order and number format are irrelevant):

```json
{ "vitals": { "hr": 72, "bp": "120/80" }, "version": 1, "patient": "p-9" }
```

Canonical form:

```
{"patient":"p-9","version":1,"vitals":{"bp":"120/80","hr":72}}
```

Hash: `sha256:` + hex( SHA-256( utf8( the canonical form ) ) ).
