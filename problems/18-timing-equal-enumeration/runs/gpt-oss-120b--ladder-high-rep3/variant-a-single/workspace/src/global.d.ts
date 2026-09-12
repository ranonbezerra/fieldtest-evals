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
