# repair2-set

## reasoning

```
We need to add missing type packages? Usually need to add import extensions .js? In ESM they use .js extensions. In service they import '* as argon2 from 'argon2';' need .js? Should be 'argon2' works with types. But TS can't find module, probably missing @types. But we can't install. Likely need to add "declare module" stubs. Create a typings file? But we cannot add new files? Could add .d.ts in src? Not prohibited. Add a file like src/types.d.ts declaring modules. Provide minimal types.

Similarly class-validator and @nestjs/testing, supertest. Add declarations.

Implement declarations for these modules.

Create a file src/global.d.ts with declare module statements.

Return changed files: src/global.d.ts (new). Also need to reference in tsconfig? Might be automatic.

We only output changed files, new file counts.

Thus produce file.
```

## reply

### src/global.d.ts
```ts
declare module 'argon2' {
  export interface Argon2Options {
    type?: number;
  }
  export function hash(
    plain: string,
    options?: Argon2Options,
  ): Promise<string>;
  export function verify(
    hash: string,
    plain: string,
    options?: Argon2Options,
  ): Promise<boolean>;
  export const argon2id: number;
}
declare module 'class-validator' {
  export function IsEmail(): PropertyDecorator;
  export function IsString(): PropertyDecorator;
  export function MinLength(length: number): PropertyDecorator;
}
declare module '@nestjs/testing' {
  export const Test: any;
}
declare module 'supertest' {
  const request: any;
  export default request;
}
```
