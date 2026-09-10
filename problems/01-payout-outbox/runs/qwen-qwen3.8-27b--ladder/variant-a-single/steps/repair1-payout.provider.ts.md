# repair1-payout.provider.ts

## reasoning

```
Let me analyze the compiler errors that relate to `src/payout/payout.provider.ts`:

1. `src/payout/payout.worker.ts(4,49): error TS2307: Cannot find module './payout.provider' or its corresponding type declarations.`
2. `test/payout.spec.ts(8,37): error TS2307: Cannot find module '../src/payout/payout.provider' or its corresponding type declarations.`
3. `test/payout.spec.ts(48,5): error TS2353: Object literal may only specify known properties, and 'transfer' does not exist in type 'TestProvider'.`
4. `test/payout.spec.ts(48,22): error TS7006: Parameter 'params' implicitly has an 'any' type.`
5. `test/payout.spec.ts(54,21): error TS7006: Parameter 'txHash' implicitly has an 'any' type.`

From the test file errors, I can see:
- Line 8 imports from `'../src/payout/payout.provider'`
- Line 48 has a `TestProvider` object with a `transfer` property that takes `params`
- Line 54 references `txHash`

The test uses a `TestProvider` that has a `transfer` method. The error says `'transfer' does not exist in type 'TestProvider'` — this means the `TestProvider` type is being imported from `payout.provider.ts` and it doesn't have a `transfer` method.

From the variant description, the provider SDK is: `provider.transfer({to, amount}) -> {txHash}`

So I need to create a `payout.provider.ts` that:
1. Exports an interface/type for the provider with a `transfer` method
2. The `transfer` method takes `{to: string, amount: bigint}` and returns `Promise<{txHash: string}>`

Looking at the test errors more carefully:
- `test/payout.spec.ts(48,5): error TS2353: Object literal may only specify known properties, and 'transfer' does not exist in type 'TestProvider'.`

This means `TestProvider` is imported from `payout.provider.ts` and the object literal being assigned to it has a `transfer` property that doesn't match. So `TestProvider` is a type/interface exported from `payout.provider.ts`.

Wait, let me re-read. The error says `'transfer' does not exist in type 'TestProvider'`. This means `TestProvider` is defined in `payout.provider.ts` and it doesn't have a `transfer` property. So I need to make sure `TestProvider` (or whatever interface is exported) has a `transfer` method.

Actually, looking more carefully at the test:
- Line 8: imports from `'../src/payout/payout.provider'`
- Line 48: an object literal is being assigned to something of type `TestProvider` and has a `transfer` property

So `TestProvider` is likely an interface exported from `payout.provider.ts` that represents the blockchain provider interface. It should have a `transfer` method.

The interface should be:
```typescript
export interface BlockchainProvider {
  transfer(params: { to: string; amount: bigint }): Promise<{ txHash: string }>;
}
```

But the test uses `TestProvider` as the type name. Let me think about this...

Actually, the test likely does something like:
```typescript
import { SomeType } from '../src/payout/payout.provider';

const testProvider: SomeType = {
  transfer: async (params) => { ... },
};
```

And the error says `'transfer' does not exist in type 'TestProvider'` — wait no, it says the error is on the object literal side. Let me re-read:

`test/payout.spec.ts(48,5): error TS2353: Object literal may only specify known properties, and 'transfer' does not exist in type 'TestProvider'.`

This means the type `TestProvider` is imported from `payout.provider.ts` and it doesn't have a `transfer` property. So `TestProvider` is the interface I need to export.

Wait, but `TestProvider` is an odd name for a production interface. Let me think again...

Actually, maybe the export is named `PayoutProvider` or `BlockchainProvider` and the test imports it as `TestProvider`? No, that doesn't make sense with the error message.

The error says the type is `TestProvider` — so the export from `payout.provider.ts` must be named `TestProvider` or the test imports it with that name.

Hmm, but that's weird. Let me reconsider. Maybe the file exports an interface called `TestProvider` (which is the provider interface used in tests), or maybe it exports something like `PayoutProvider` and the test aliases it.

Given the constraint "Change nothing the messages do not name", I should focus on what makes the errors go away. The errors name:
- A module `'./payout.provider'` that needs to exist
- A type `TestProvider` that needs to have a `transfer` property
- The `transfer` method takes `params` (with implicit any, so it needs a type)
- `txHash` is referenced (implicit any, so it needs a type)

So the file needs to export something that:
1. Has a name that the test imports as `TestProvider` (or the file exports `TestProvider`)
2. Has a `transfer` method with typed parameters

Let me go with exporting an interface. Given the test references `TestProvider` as the type, and the error is about `transfer` not existing in that type, I'll export an interface.

Looking at the worker import: `src/payout/payout.worker.ts(4,49): error TS2307: Cannot find module './payout.provider'`

The worker likely imports the provider interface to type its dependency.

I think the cleanest solution is:

```typescript
export interface TestProvider {
  transfer(params: { to: string; amount: bigint }): Promise<{ txHash: string }>;
}
```

Wait, but `TestProvider` as a name in production code is weird. Let me think about what makes sense...

Actually, re-reading the constraint: "Change nothing the messages do not name." The messages name `TestProvider` as the type. So I need to export something with that name (or at least a type that resolves to it).

Let me just export the interface as `TestProvider` since that's what the test expects. Or maybe it's `PayoutProvider` and the test does `import { PayoutProvider as TestProvider }`. But the error message says "does not exist in type 'TestProvider'" which means the type is literally called `TestProvider` in the test's scope.

The safest approach: export an interface named `TestProvider` with the `transfer` method properly typed.

Actually wait — maybe the worker imports something else from this file. Let me look at the worker error:
`src/payout/payout.worker.ts(4,49): error TS2307: Cannot find module './payout.provider' or its corresponding type declarations.`

This just says the module can't be found. The worker probably imports the provider interface to type its constructor parameter.

I'll go with:

```typescript
export interface TestProvider {
  transfer(params: { to: string; amount: bigint }): Promise<{ txHash: string }>;
}
```

This should fix:
- The module not found errors (file now exists)
- The `TestProvider` type having a `transfer` property
- The `params` parameter being typed
- The `txHash` being typed (in the return type)

Let me double-check against all the errors:
1. `src/payout/payout.worker.ts(4,49): error TS2307: Cannot find module './payout.provider'` ✓ (file exists now)
2. `test/payout.spec.ts(8,37): error TS2307: Cannot find module '../src/payout/payout.provider'` ✓ (file exists now)
3. `test/payout.spec.ts(48,5): error TS2353: Object literal may only specify known properties, and 'transfer' does not exist in type 'TestProvider'.` ✓ (interface has `transfer`)
4. `test/payout.spec.ts(48,22): error TS7006: Parameter 'params' implicitly has an 'any' type.` ✓ (params is typed as `{ to: string; amount: bigint }`)
5. `test/payout.spec.ts(54,21): error TS7006: Parameter 'txHash' implicitly has an 'any' type.` ✓ (txHash is typed as `string` in the return type)

Wait, error 5 is about a parameter `txHash` at line 54. This might be in a callback like:
```typescript
const testProvider = {
  transfer: async (params) => {
    // ...
    return { txHash: 'some-value' };
  },
};
```

If `txHash` is a parameter, it might be in a mock callback like:
```typescript
transfer: vi.fn(async (params) => ({ txHash: 'abc' }))
```

Or maybe it's destructured:
```typescript
transfer: async ({ to, amount }) => { ... }
```

Hmm, but the error says "Parameter 'txHash' implicitly has an 'any' type" at line 54. This suggests `txHash` is used as a parameter somewhere. Maybe:

```typescript
const mockTransfer = vi.fn();
mockTransfer.mockImplementation(async (params: { to: string; amount: bigint }) => ({ txHash: 'test-hash' }));
```

Or perhaps it's in a different context. The point is that if the return type of `transfer` is `Promise<{ txHash: string }>`, then any variable or parameter named `txHash` that comes from destructuring the result would be properly typed.

Actually, I think the error at line 54 might be something like:
```typescript
const { txHash } = await provider.transfer({ to: 'addr', amount: 100n });
```

If `transfer` returns `Promise<{ txHash: string }>`, then `txHash` would be `string`, not `any`. So my interface should fix this.

I'm confident the solution is:

```typescript
export interface TestProvider {
  transfer(params: { to: string; amount: bigint }): Promise<{ txHash: string }>;
}
```

This is minimal and fixes all the named errors without changing anything else.
```

## reply

```typescript
export interface TestProvider {
  transfer(params: { to: string; amount: bigint }): Promise<{ txHash: string }>;
}
```
