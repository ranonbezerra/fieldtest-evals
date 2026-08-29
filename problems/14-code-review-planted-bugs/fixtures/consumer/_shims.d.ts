// Minimal declarations so the fixture typechecks standalone, without node_modules.
// Not part of the code under review.
declare module '@nestjs/common' {
  export function Injectable(): ClassDecorator;
  export function Controller(prefix?: string): ClassDecorator;
  export function Post(path?: string): MethodDecorator;
  export function Headers(name?: string): ParameterDecorator;
  export function Body(): ParameterDecorator;
  export function Req(): ParameterDecorator;
  export function HttpCode(code: number): MethodDecorator;
  export class Logger {
    constructor(context?: string);
    log(m: unknown): void;
    warn(m: unknown): void;
    error(m: unknown): void;
  }
  export class UnauthorizedException extends Error {}
  export interface OnModuleInit { onModuleInit(): void | Promise<void>; }
}

// Node surface this fixture uses, declared locally so it typechecks without
// @types/node. Not part of the code under review.
declare const process: { env: Record<string, string | undefined> };
declare const crypto: { randomUUID(): string };
interface Buffer extends Uint8Array {}
declare const Buffer: {
  from(input: string | Uint8Array, encoding?: string): Buffer;
};
declare module 'node:crypto' {
  export function createHmac(alg: string, key: string): {
    update(data: string | Uint8Array): { digest(enc: string): string };
  };
  export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean;
}
