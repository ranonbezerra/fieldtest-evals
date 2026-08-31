# 03-operation-read-model.types.ts

## reasoning

```
The task is to write `src/operations/operation-read-model.types.ts` based on the PLAN.md specification.

Looking at the plan, section 3 "Types and signatures" shows exactly what should be included in this file:

```ts
// src/operations/operation-read-model.types.ts
export type OperationStatus = string;

export interface OperationReadModel {
  id: bigint;
  orderId: bigint;
  companyId: bigint;
  workerId: bigint | null;
  eventId: bigint | null;
  status: string;
  amountCents: bigint;
  currency: string;
  occurredAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

// Input the write service hands to maintenance for one order.
export interface OperationUpsertInput {
  orderId: bigint;
  companyId: bigint;
  workerId: bigint | null;
  eventId: bigint | null;
  status: string;
  amountCents: bigint;
  currency: string;
  occurredAt: Date;
}

export interface OperationDeleteInput {
  orderId: bigint;
}

// Dashboard query input.
export interface OperationsQueryInput {
  companyId: bigint;
  status?: string;
  fromDate?: Date;
  toDate?: Date;
  page: number;
  pageSize: number;
}

export interface OperationsPage {
  items: OperationReadModel[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}

export interface CompanyTotals {
  companyId: bigint;
  totalAmountCents: bigint;
  orderCount: number;
}

export interface DateWindow {
  from: Date;
  to: Date;
}
```

The plan also mentions errors:
- `ResourceNotFoundError` → code `resource_not_found`. Raised when the re-derivation window contains no derivable rows and the caller expected them, or when maintenance is asked to update an order whose source row no longer exists.
- `InvalidParameterError` → code `invalid_parameter`. Raised for `page < 1`, `pageSize < 1 || pageSize > 200`, `fromDate > toDate`.

The manifest says: "src/operations/operation-read-model.types.ts | reads: - | shared input/output types and error contracts"

So "error contracts" should be included in this file. The plan says "Errors (raised by service, mapped to envelope by controller/exception filter):" and lists `ResourceNotFoundError` and `InvalidParameterError`.

Hmm, but the plan's code block for this file doesn't include error classes. However, the manifest describes this file as "shared input/output types and error contracts". The plan's section 3 code block shows the types, and then has an "Errors" paragraph after it.

The question is: should I include the error classes in this file? The plan's code block for `operation-read-model.types.ts` only shows the types. But the manifest explicitly says "shared input/output types and error contracts".

Let me think about this. The plan's section 3 code block is labeled `// src/operations/operation-read-model.types.ts` and contains only the types. The errors are described in prose after that: "Errors (raised by service, mapped to envelope by controller/exception filter): ResourceNotFoundError → code resource_not_found... InvalidParameterError → code invalid_parameter..."

Since the manifest says this file holds "shared input/output types and error contracts", I think it's most defensible to include the error classes in this file. The error "contract" is the code (`resource_not_found`, `invalid_parameter`) and the envelope shape.

But wait — the instructions say "Implement exactly what the plan specifies for this file. Do not add exports, features, or files that the plan doesn't name."

The plan's code block for this file doesn't include error classes. But the manifest (which is part of the plan) says "shared input/output types and error contracts". So the error contract is part of this file's responsibility.

The most defensible reading: include the types from the code block, plus error classes with their codes since the manifest says "error contracts" belong here.

Actually, let me reconsider. The plan's section 3 code block is explicit about what's in this file. The errors are described as "raised by service, mapped to envelope by controller/exception filter". This suggests the error classes exist somewhere — most likely in this types file since it's the "shared" file.

Given:
1. The manifest says this file has "error contracts"
2. The plan describes two error types with codes
3. The envelope shape is given in the conventions

I'll include:
- All the types from the code block
- Error classes `ResourceNotFoundError` and `InvalidParameterError` with their snake_case codes
- Possibly an error code type

Let me think about how to structure the errors. The convention says:
```json
{ "error": { "code": "resource_not_found", "message": "...", "details": {} } }
```

So the error contract includes:
- `code` is snake_case
- `message` is developer-facing English
- `details` is an object, never null

I'll define:
- An `ErrorCode` type or just use string literals
- `ResourceNotFoundError` class extending Error with a `code` property
- `InvalidParameterError` class extending Error with a `code` property

Actually, since the plan says these are "raised by service", they should be Error subclasses. Let me write them as classes.

Let me also consider: the plan mentions `OperationStatus = string`. I'll keep that.

Now, about the error details — should I include a `details` property? The envelope has `details` as an object. But the error classes raised by the service might just carry a code and message, with the controller/filter adding details. Let me keep it simple: the error classes carry `code` and `message`, and the controller maps to the envelope.

Actually, re-reading: "Errors (raised by service, mapped to envelope by controller/exception filter)". So the service raises the error classes, and the controller maps them to the envelope. The error classes need at least a `code` so the controller can map them.

Let me write:

```ts
export type OperationErrorCode = 'resource_not_found' | 'invalid_parameter';

export class ResourceNotFoundError extends Error {
  readonly code: OperationErrorCode = 'resource_not_found';
  
  constructor(message: string) {
    super(message);
    this.name = 'ResourceNotFoundError';
  }
}

export class InvalidParameterError extends Error {
  readonly code: OperationErrorCode = 'invalid_parameter';
  
  constructor(message: string) {
    super(message);
    this.name = 'InvalidParameterError';
  }
}
```

Hmm, but should I use `readonly code` or just a property? Let me keep it clean.

Actually, wait. Let me reconsider whether to include error classes at all. The instruction is very strict: "Implement exactly what the plan specifies for this file. Do not add exports, features, or files that the plan doesn't name."

The plan's code block for this file does NOT include error classes. It only includes the types. The errors are mentioned in prose as being "raised by service".

But the manifest says "shared input/output types and error contracts". This is a tension.

Let me look at the plan's code block again very carefully:

```ts
// src/operations/operation-read-model.types.ts
export type OperationStatus = string;
... (all the interfaces) ...
export interface DateWindow {
  from: Date;
  to: Date;
}
```

Then after the code block:
"Errors (raised by service, mapped to envelope by controller/exception filter):
- ResourceNotFoundError → code resource_not_found. ...
- InvalidParameterError → code invalid_parameter. ..."

The code block is explicitly labeled as the file content. The errors are described outside the code block. This strongly suggests the error classes are NOT in this file, or at least the plan's explicit code block doesn't include them.

However, the manifest says "error contracts" are in this file. 

Hmm, this is a genuine ambiguity. Let me think about what's most defensible.

Option A: Include only the types from the code block (no error classes).
- Pro: Matches the explicit code block exactly.
- Con: Manifest says "error contracts" belong here, and the plan describes error codes that need to live somewhere.

Option B: Include types + error classes.
- Pro: Manifest says "error contracts" belong here; the plan describes the errors with their codes.
- Con: The explicit code block doesn't show them.

The instruction says "If a symbol you need is genuinely absent from both the plan and the references, do not guess in silence... write the file using the most defensible reading and mark it with one ASSUMPTION comment."

The error codes ARE in the plan (in prose). So they're not "genuinely absent". The question is just where they live.

Given the manifest explicitly says this file has "error contracts", and the plan describes the error codes, I think the most defensible reading is to include the error contract (the codes) in this file. The "error contract" could mean just the code constants, not necessarily full classes.

Let me think about what "error contract" means. The convention says: "code is snake_case and is the contract." So the "error contract" is the set of codes. I could define:

```ts
export const OperationErrorCodes = {
  resourceNotFound: 'resource_not_found',
  invalidParameter: 'invalid_parameter',
} as const;

export type OperationErrorCode = typeof OperationErrorCodes[keyof typeof OperationErrorCodes];
```

But the plan names `ResourceNotFoundError` and `InvalidParameterError` as the raised errors. These are class names (PascalCase per convention). So they're likely classes.

Given the plan uses PascalCase names `ResourceNotFoundError` and `InvalidParameterError`, these are classes. And since the manifest says error contracts are in this types file, I'll include them as classes here.

Actually, I realize I'm overthinking this. Let me re-read the instruction once more:

"Implement exactly what the plan specifies for this file. Do not add exports, features, or files that the plan doesn't name."

The plan DOES name `ResourceNotFoundError` and `InvalidParameterError` (in the errors section). And the manifest says this file holds "error contracts". So including these error classes is within what the plan names. I'm not adding anything the plan doesn't name.

So Option B is defensible and I'll go with it, but I'll keep the error classes minimal (just code + message) since that's all the plan specifies.

Wait, but the plan's explicit code block for this file is very clear and doesn't include errors. If I add error classes, am I "adding exports the plan does not name"? No — the plan DOES name them (ResourceNotFoundError, InvalidParameterError). So I'm not adding unnamed exports.

Let me go with including the error classes, since:
1. The manifest explicitly says "error contracts" are in this file.
2. The plan names the error classes and their codes.
3. It's the most defensible reading given both sources.

Now let me also double check: are there any other types I'm missing? Let me re-read the plan's section 3.

The code block includes:
- `OperationStatus` (type alias)
- `OperationReadModel` (interface)
- `OperationUpsertInput` (interface)
- `OperationDeleteInput` (interface)
- `OperationsQueryInput` (interface)
- `OperationsPage` (interface)
- `CompanyTotals` (interface)
- `DateWindow` (interface)

That's it for the types. Plus the errors in prose.

Let me now also consider: should `OperationStatus` be used in `OperationReadModel.status` and `OperationUpsertInput.status`? The plan defines `export type OperationStatus = string;` but then uses `status: string` in the interfaces. So `OperationStatus` is defined but the interfaces use `string`. I'll keep it exactly as the plan shows — define `OperationStatus` and use `string` in the interfaces (matching the plan exactly).

Actually, that's a bit odd — defining a type alias and not using it. But the plan explicitly shows `status: string` in both interfaces while also defining `OperationStatus = string`. I'll match the plan exactly. The instruction says implement exactly what the plan specifies.

Hmm, but that means `OperationStatus` is an unused export. That's fine — the plan names it, so I include it.

Let me write the file now.

```ts
export type OperationStatus = string;

export interface OperationReadModel {
  id: bigint;
  orderId: bigint;
  companyId: bigint;
  workerId: bigint | null;
  eventId: bigint | null;
  status: string;
  amountCents: bigint;
  currency: string;
  occurredAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

// Input the write service hands to maintenance for one order.
export interface OperationUpsertInput {
  orderId: bigint;
  companyId: bigint;
  workerId: bigint | null;
  eventId: bigint | null;
  status: string;
  amountCents: bigint;
  currency: string;
  occurredAt: Date;
}

export interface OperationDeleteInput {
  orderId: bigint;
}

// Dashboard query input.
export interface OperationsQueryInput {
  companyId: bigint;
  status?: string;
  fromDate?: Date;
  toDate?: Date;
  page: number;
  pageSize: number;
}

export interface OperationsPage {
  items: OperationReadModel[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}

export interface CompanyTotals {
  companyId: bigint;
  totalAmountCents: bigint;
  orderCount: number;
}

export interface DateWindow {
  from: Date;
  to: Date;
}

// Error contract: snake_case codes are the stable API surface. The controller /
// exception filter maps these to the single error envelope.
export type OperationErrorCode = 'resource_not_found' | 'invalid_parameter';

export class ResourceNotFoundError extends Error {
  readonly code: OperationErrorCode = 'resource_not_found';

  constructor(message: string) {
    super(message);
    this.name = 'ResourceNotFoundError';
  }
}

export class InvalidParameterError extends Error {
  readonly code: OperationErrorCode = 'invalid_parameter';

  constructor(message: string) {
    super(message);
    this.name = 'InvalidParameterError';
  }
}
```

Wait, I need to reconsider the error classes. The plan says "Errors (raised by service, mapped to envelope by controller/exception filter)". The convention's error envelope has `details` as an object, never null. Should the error classes carry a `details` field?

The plan doesn't specify that the error classes carry details. It just says they're raised by service and mapped to envelope by controller. So the mapping (adding details) happens at the controller/filter level. The error classes just need a code and message.

But to be safe and match the envelope, maybe I should include a `details` field defaulting to `{}`. Hmm, but the plan doesn't specify this. Let me keep it minimal — just code and message — since that's all the plan specifies for the errors. The envelope mapping is the controller's job per the plan.

Actually, let me reconsider whether to include `details`. The convention says the envelope always has `details` as an object. If the error class is what gets mapped, and the mapping needs to produce `details: {}`, then either:
- The error class carries `details` (defaulting to `{}`), or
- The controller always sets `details: {}`.

The plan doesn't specify. To be defensible and match the envelope, I could add `details` to the error classes. But that might be "adding" beyond the plan.

I'll keep it minimal: code + message. The controller will handle details per the envelope convention. This matches "mapped to envelope by controller/exception filter" — the mapping adds details.

Hmm, but actually, let me reconsider once more. If I don't include `details`, and the controller needs to produce it, that's fine — the controller can just set `details: {}`. So minimal error classes are OK.

Let me also reconsider: is it possible the plan intends NO error classes in this file, and the "error contracts" in the manifest just refers to the code constants? In that case, I'd only include `OperationErrorCode` type and maybe a const for the codes.

But the plan explicitly names `ResourceNotFoundError` and `InvalidParameterError` as PascalCase class-like names. And the convention says "Class: PascalCase". So these are classes. And they're named in the plan. And the manifest says error contracts are in this file. So including them as classes is the most defensible reading.

I'm confident in Option B now. Let me finalize.

Actually, let me reconsider the `readonly code` approach vs a const. Using `readonly code: OperationErrorCode = 'resource_not_found'` is clean and type-safe. Good.

One more consideration: should the error classes be in this file or a separate file? The plan's manifest lists only these files:
- DESIGN.md
- prisma/schema.prisma
- src/operations/operation-read-model.types.ts
- src/operations/operation-read-model.repository.ts
- src/operations/operation-read-model.service.ts
- src/operations/drift-repair.processor.ts
- src/operations/operations.controller.ts
- src/operations/operations.module.ts
- test/operation-read-model.spec.ts
- test/drift-repair.spec.ts

There's no separate error file. So the errors must live in one of these. The types file is the natural home (manifest says "error contracts"). So yes, error classes go in this file.

Great, I'm confident. Let me write the final file.

Let me reconsider whether to keep the comments from the plan. The plan has:
- `// Input the write service hands to maintenance for one order.` before `OperationUpsertInput`
- `// Dashboard query input.` before `OperationsQueryInput`

I'll keep these comments since they're part of the plan's specification for this file. They help document the types.

Should I add a comment for the errors? The plan's prose describes them. I'll add a brief comment explaining the error contract, matching the convention. That's reasonable and within scope.

Let me also make sure I'm not adding anything extra. The plan's types are exactly what I have. The errors are named in the plan. Good.

Final check on the `OperationStatus` type — it's defined but the interfaces use `string`. I'll keep it exactly as the plan. It's a named export in the plan, so I include it.

Let me write it out cleanly.

Actually, one concern: TypeScript strict mode. The error classes extend Error. In strict mode with `useDefineForClassFields` (default in modern TS), class fields are defined. `readonly code: OperationErrorCode = 'resource_not_found'` is fine. `this.name = 'ResourceNotFoundError'` in constructor is fine.

But there's a subtlety: when you extend Error in TypeScript with certain configs, `instanceof` checks and property access can be tricky. But for our purposes (just raising and catching by name/code), this is fine.

Let me also consider: should I set `Object.setPrototypeOf(this, new.target.prototype)` in the constructor for proper instanceof? This is a common pattern when extending Error in ES modules. But the plan doesn't specify this, and it might be considered "adding". However, it's a standard correctness concern for Error subclasses in ESM.

Hmm. The convention says ESM, `"type": "module"`. In ESM, extending Error works fine actually — the prototype chain is preserved correctly in modern Node/ESM. The `Object.setPrototypeOf` hack was needed for older transpilation (TS targeting ES5). With ESM and modern targets, it's not needed.

I'll keep it simple without the setPrototypeOf hack, since ESM handles it correctly and the plan doesn't mention it.

Let me finalize the file.

Actually, let me reconsider one more time whether to include the error classes. I keep going back and forth. Let me settle this definitively.

Arguments FOR including error classes:
1. Manifest: "src/operations/operation-read-model.types.ts | ... | shared input/output types and error contracts" — explicitly says error contracts are here.
2. Plan names `ResourceNotFoundError` and `InvalidParameterError` (PascalCase = classes per convention).
3. No separate error file in the manifest, so they must live somewhere, and the types file is the named home for "error contracts".
4. The plan's prose describes them as being raised and mapped, implying they're concrete classes.

Arguments AGAINST:
1. The explicit code block for this file doesn't show them.

The manifest is part of the plan and explicitly assigns "error contracts" to this file. The code block shows the types, but the prose + manifest together specify the error contract belongs here. I'm confident: include them.

The instruction "Do not add exports the plan does not name" — I'm not adding unnamed exports. `ResourceNotFoundError`, `InvalidParameterError`, and the code type are all named/described in the plan.

Final decision: include types + error classes + error code type.

Let me write the final version.

I'll add a concise comment for the error section to document the contract, consistent with the plan's prose and the convention.

Let me write it.
```

## reply

```ts
export type OperationStatus = string;

export interface OperationReadModel {
  id: bigint;
  orderId: bigint;
  companyId: bigint;
  workerId: bigint | null;
  eventId: bigint | null;
  status: string;
  amountCents: bigint;
  currency: string;
  occurredAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

// Input the write service hands to maintenance for one order.
export interface OperationUpsertInput {
  orderId: bigint;
  companyId: bigint;
  workerId: bigint | null;
  eventId: bigint | null;
  status: string;
  amountCents: bigint;
  currency: string;
  occurredAt: Date;
}

export interface OperationDeleteInput {
  orderId: bigint;
}

// Dashboard query input.
export interface OperationsQueryInput {
  companyId: bigint;
  status?: string;
  fromDate?: Date;
  toDate?: Date;
  page: number;
  pageSize: number;
}

export interface OperationsPage {
  items: OperationReadModel[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}

export interface CompanyTotals {
  companyId: bigint;
  totalAmountCents: bigint;
  orderCount: number;
}

export interface DateWindow {
  from: Date;
  to: Date;
}

// Error contract: the snake_case `code` is the stable API surface. The service
// raises these errors; the controller / exception filter maps them to the single
// error envelope `{ "error": { code, message, details } }`.
export type OperationErrorCode = 'resource_not_found' | 'invalid_parameter';

export class ResourceNotFoundError extends Error {
  readonly code: OperationErrorCode = 'resource_not_found';

  constructor(message: string) {
    super(message);
    this.name = 'ResourceNotFoundError';
  }
}

export class InvalidParameterError extends Error {
  readonly code: OperationErrorCode = 'invalid_parameter';

  constructor(message: string) {
    super(message);
    this.name = 'InvalidParameterError';
  }
}
```
