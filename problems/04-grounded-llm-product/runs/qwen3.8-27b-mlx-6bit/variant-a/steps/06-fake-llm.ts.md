# 06-fake-llm.ts

## reasoning

```
We need answer user's request: write exactly one file src/fake-llm.ts, complete content in one fenced block, nothing else. Need follow plan. Need analyze in same language as user's request? User request is English, so English. Need produce final only fenced code.

Need implement ScriptedLlm per plan:
```
// src/fake-llm.ts
export class ScriptedLlm implements LlmClient {
  constructor(responses: Map<string, string>);
  generate(prompt: string, context: string[]): Promise<string>;
}
```
Reads src/llm-client.ts. Reference has LlmClient interface. Need import type? Since ESM, TypeScript strict. Need likely `import type { LlmClient } from "./llm-client.js";`? The project uses ESM, type module. In TS with NodeNext maybe imports need .js extension? The reference files don't show imports. Plan says file layout flat under src, one file per concern. Need decide import path: `./llm-client` or `./llm-client.js`. Conventions in codebase? The given read-only reference src/llm-client.ts no imports. For ESM, TypeScript often uses `.js` extension if moduleResolution nodenext. But plan doesn't specify. We need most defensible. The task says TypeScript strict, Node 20+, ESM "type":"module". Usually imports use `.js`. But in many codebases with bundler, no extension. Since they explicitly say ESM, use `./llm-client.js`. However if vitest and tsconfig maybe allow? Need not overthink. But final only file. Could avoid import by structural typing? `export class ScriptedLlm { constructor(private readonly responses: Map<string, string>) {} async generate(prompt: string, _context: string[]): Promise<string> { ... } }` It would structurally implement LlmClient but plan says implements LlmClient. We can import type. If no import, no dependency? But manifest says reads src/llm-client.ts. Better import type.

Need behavior: scripted fake. It should return response based on prompt? Plan: constructor(responses: Map<string, string>), generate(prompt, context). Need exact behavior? Not fully specified. It should be deterministic scripted fake. Likely look up prompt in responses; if missing throw? Or return empty? Need defensible. For eval harness, tests will configure responses keyed by prompt. But `answer` builds prompt from question; tests need know prompt? Maybe they can pass a map keyed by question? Need inspect plan: answer builds prompt from question; call llm.generate once. ScriptedLlm responses Map<string,string>. It likely maps prompt to response. If no matching prompt, what? Could throw Error(`No scripted response for prompt: ...`) to fail fast. But tests might not expect throw? The plan doesn't specify error. Need implement exactly what plan specifies: only constructor and generate. Could return `""` if missing? But then grounding refusal maybe. But scripted fake should be explicit. Need choose most defensible and maybe mark assumption if unresolved.

The instructions: If symbol genuinely absent, don't guess in silence; write most defensible reading and mark with one ASSUMPTION comment at point it matters. Here behavior for missing response is unresolved. Could mark assumption: missing prompt returns empty string? Or throws? Need decide.

The tests in plan: answer with scripted LLM returns confident lie etc. They will construct ScriptedLlm with responses map. Need they know key. If generate uses prompt exactly, tests must know prompt construction. But answer.ts not given; we only write fake-llm. Could design ScriptedLlm to key by prompt or maybe question? The plan says responses: Map<string, string>; generate(prompt, context). It likely uses prompt as key. But if answer builds prompt from question in a way tests don't know, harness inconvenient. Maybe prompt is just question? Plan: "Build prompt from `question`; call `llm.generate` once". Could be `prompt = question` or includes mode? The fake can match by prompt. For tests, they can use same question as key if answer passes question as prompt. But unknown.

Could make ScriptedLlm more flexible: look up by exact prompt, then by context? But plan says Map<string,string>. Don't add features. Could implement: if responses.has(prompt) return; else throw. That is typical.

Need consider context parameter unused. In strict TS, noUnusedParameters? Could be enabled. Use `_context` to avoid unused. But interface signature is `generate(prompt: string, context: string[]): Promise<string>;` Implementation can name `_context`. That's okay.

Need return Promise<string>. Could `return Promise.resolve(...)`. Or async method. Need if missing: throw Error. If using async, thrown error becomes rejected promise. Fine.

Need exact code:
```
import type { LlmClient } from "./llm-client.js";

export class ScriptedLlm implements LlmClient {
  constructor(private readonly responses: Map<string, string>) {}

  generate(prompt: string, _context: string[]): Promise<string> {
    const response = this.responses.get(prompt);
    if (response === undefined) {
      throw new Error(`No scripted response registered for prompt: ${prompt}`);
    }
    return Promise.resolve(response);
  }
}
```

But if response can be empty string, `get` returns undefined only missing. Good.

Could use `has` to allow empty: `if (!this.responses.has(prompt)) throw; return Promise.resolve(this.responses.get(prompt) as string);` Better.

Need import extension? If using `./llm-client.js`, okay if TS with NodeNext. But in many eval workspaces, they may compile with tsc? The reference files likely no imports. The plan manifest says reads src/llm-client.ts, not .js. If they run vitest with esbuild, `./llm-client.js` resolves to .ts? Vitest supports. If tsc with moduleResolution bundler, `.js` maybe allowed? It maps to .ts. If moduleResolution node10, `.js` may not resolve? But ESM type module suggests node16/nodenext. Use .js.

Could avoid import by `import type { LlmClient } from "./llm-client";` If their tsconfig uses bundler, no ext. Which is more likely? The codebase conventions: ESM, type module. In NestJS with Node 20, often tsconfig module: commonjs? But they say ESM. For ESM TS, relative imports should include file extension. I'd use `.js`.

Need maybe no ASSUMPTION? Missing response behavior is a feature. The plan didn't specify. Could mark:
```
// ASSUMPTION: an unregistered prompt rejects with an Error rather than returning a default.
```
But user says if symbol absent not behavior? It says If a symbol you need is genuinely absent... mark assumption. Missing behavior maybe not symbol. But could include one comment? They said do not add export/feature/file plan does not name. Error behavior is necessary. Could avoid comment? But if unresolved, mark. However final should be clean. The instructions: "If a symbol you need is genuinely absent from both the plan and the references, do not guess in silence ... mark it with one // ASSUMPTION..." Here no symbol absent; behavior is design. But could be considered unresolved. Do we need mark? It might be undesirable to include comment because plan didn't ask. But if we throw, maybe okay as defensible. No need ASSUMPTION unless symbol absent. I think no comment.

Need consider "scripted confident-lie answer scores low" tests may use ScriptedLlm with map. If missing prompt throws, tests must register exact prompt. But since they test answer, they may not know prompt. Could be a problem. Alternative: ScriptedLlm could return a single scripted response regardless of prompt? But constructor takes Map. Maybe map keys are scenario ids or questions? Need infer from plan: `ScriptedLlm implements LlmClient { constructor(responses: Map<string, string>); generate(prompt: string, context: string[]): Promise<string>; }` It doesn't say key. The most natural is prompt -> response. But if prompt construction unknown to test, maybe answer uses question as prompt. Plan says "Build prompt from question" not necessarily exact. In tests, they can create fake inline object instead of ScriptedLlm? But plan says eval harness uses scripted fake. The test may use ScriptedLlm with `new ScriptedLlm(new Map([[question, lie]]))` if answer passes question as prompt. But if answer adds "Answer the following question: ..." then key mismatch. Since we only implement fake, maybe need make it robust: look up by prompt; if not found, try context? But that adds behavior. Could key by question embedded in prompt: find first map key contained in prompt? That would be flexible but unspecified and could be considered feature. But maybe necessary for tests? Let's think.

The task is from an eval where model must produce files according to plan. The other files will be generated separately? We only write fake-llm. The tests may be written by another model following plan. They will likely assume ScriptedLlm maps prompt to response. They may know answer's prompt because they also write answer? But here only one file requested; maybe the full workspace will be assembled from separate outputs. Need align with plan only.

Plan's control flow: `answer`: 2. Build prompt from `question`; call `llm.generate` once, get raw text. It doesn't specify prompt format. In `ScriptedLlm`, if responses keyed by prompt, the test needs exact prompt. To make harness usable, maybe `ScriptedLlm` should map by `prompt` but if not found, throw. The answer implementation could simply use `question` as prompt to make it testable. Since plan says build prompt from question, likely `prompt = question`. So okay.

Need maybe include `readonly responses`? Not necessary.

Strict TypeScript: class property parameter with private readonly is okay. If `noParameterProperties`? Not specified. Could avoid parameter properties for compatibility:
```
export class ScriptedLlm implements LlmClient {
  private readonly responses: Map<string, string>;
  constructor(responses: Map<string, string>) { this.responses = responses; }
  ...
}
```
This is safer if lint disallows parameter properties. Use explicit.

Need no extra exports. Only ScriptedLlm.

Potential issue: `implements LlmClient` with import type from `.js`. If the file is checked with `verbatimModuleSyntax`, type import okay.

Could use `Promise.resolve(this.responses.get(prompt) ?? "")`? Missing returns empty, causing refusal. But then tests for lie need exact key; if wrong key silent low score. Fail-fast better.

Need maybe use `context`? No.

Let's consider if `responses` map keys could be scenario ids and prompt includes id? No.

The final must be one fenced block, nothing else. Need ensure no explanation. Use ```ts ... ```.

Double-check conventions: "Code and comments in English." okay. "Do not create a file it does not call for" only one file. "Implement exactly what plan specifies for this file. Do not add an export, feature or file the plan does not name." Throwing on missing is a feature? It's internal behavior. Could be okay. But maybe plan expects no throw. If they wanted no extra, perhaps generate should return `""` when missing to keep simple. Which is more defensible? Let's evaluate.

A scripted fake LLM in tests: you register responses for prompts you expect. If an unexpected prompt occurs, throwing reveals bug. Returning empty silently hides. So throw is defensible. But plan doesn't name error type. Adding Error is not export. Fine.

Could use `throw new Error(...)`; no custom error. Good.

Need maybe if response is undefined but map has key with undefined? Map<string,string> cannot have undefined value in type. Good.

Potential issue: If prompt not found and we throw inside non-async method, returns rejected promise? Actually if method returns Promise<string> and throws synchronously, caller awaiting gets rejection? If called as `llm.generate(...)` without await, the throw occurs before promise returned, so caller must handle. In `answer` likely `await llm.generate`, synchronous throw becomes rejected? In async function, a synchronous throw in called function before promise? If answer is async and does `const raw = await llm.generate(...);`, if generate throws synchronously, the throw happens during evaluation of right-hand side inside async function, so it rejects. Fine.

Could make method `async generate` and throw, returns promise. Simpler:
```
async generate(prompt: string, _context: string[]): Promise<string> { ... }
```
This always returns promise. Use async. But if no await, okay.

Need strict: `_context` unused but underscore convention may still trigger noUnusedParameters? Usually underscore prefix ignored. Good.

Could omit context parameter? Must match interface, can have fewer params in implementation? TypeScript allows method with fewer parameters. But plan signature includes context. Could implement `generate(prompt: string): Promise<string>` and still implements? Yes, but to be exact include `_context`.

Need maybe preserve Map reference; no validation.

Let's think about import extension again. If final uses `./llm-client.js`, and their test runner resolves? In Vitest with Vite, importing `.js` that maps to `.ts` works if `resolve.extensions`? Vite supports TS path aliases? By default, importing `./llm-client.js` from a .ts file in Vite: it will resolve to `./llm-client.ts`? I think yes, Vite has behavior for TS: if import ends with .js, it tries .ts. In tsconfig NodeNext, required. If their tsconfig is module ESNext + moduleResolution bundler, `.js` also allowed? I think TypeScript allows .js to resolve to .ts under bundler? It may. If moduleResolution node10, `.js` might not resolve to .ts? Actually TS in classic/node resolution: for relative import with .js, it looks for .js file? It may not map to .ts unless allowJs? In older, you import without extension. But ESM type module likely not node10. The safe for TS compiler is no extension if using bundler, but ESM runtime needs extension. Since they say ESM, use .js. The reference codebase maybe NestJS with `module: nodenext`? Use .js.

Could avoid import entirely by not using `implements`, but plan says implements. Could use `import type { LlmClient } from "./llm-client";` no extension. Which is more likely accepted by tests? They may not compile, just vitest. Both work in Vitest? If no extension, Vite resolves .ts. If .js, also likely. For tsc, depends. I lean `.js` due ESM.

Need maybe no semicolons? Codebase unknown. Use semicolons.

Final:
```ts
import type { LlmClient } from "./llm-client.js";

export class ScriptedLlm implements LlmClient {
  private readonly responses: Map<string, string>;

  constructor(responses: Map<string, string>) {
    this.responses = responses;
  }

  async generate(prompt: string, _context: string[]): Promise<string> {
    if (!this.responses.has(prompt)) {
      throw new Error(`No scripted response registered for prompt: ${prompt}`);
    }

    return this.responses.get(prompt) as string;
  }
}
```

Is `as string` needed? Since Map<string,string>, get returns string | undefined. After has, TS still sees string | undefined? In strict, no narrowing for Map.get. Could use:
```
const response = this.responses.get(prompt);
if (response === undefined) throw ...;
return response;
```
This handles empty string and no cast. But if key exists with undefined impossible. Use this.

```
const response = this.responses.get(prompt);
if (response === undefined) { throw ... }
return response;
```
If a registered response is empty string, get returns "", not undefined, okay. Good.

Need maybe if prompt contains newline, error message multi-line; fine.

Could use `Promise.resolve(response)` instead of async. But async okay. If method async, return string becomes promise.

One more thought: The plan says `generate(prompt: string, context: string[]): Promise<string>;` If we use async, type is `Promise<string>`. Good.

Need final only fenced block. Ensure no extra text.
```

## reply

```ts
import type { LlmClient } from "./llm-client.js";

export class ScriptedLlm implements LlmClient {
  private readonly responses: Map<string, string>;

  constructor(responses: Map<string, string>) {
    this.responses = responses;
  }

  async generate(prompt: string, _context: string[]): Promise<string> {
    const response = this.responses.get(prompt);

    if (response === undefined) {
      throw new Error(`No scripted response registered for prompt: ${prompt}`);
    }

    return response;
  }
}
```
