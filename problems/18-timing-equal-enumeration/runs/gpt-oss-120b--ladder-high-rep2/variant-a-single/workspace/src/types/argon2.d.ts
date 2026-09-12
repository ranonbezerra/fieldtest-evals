declare module 'argon2' {
  export type Argon2HashOptions = {
    type?: number;
  };

  export function hash(
    plain: string,
    options?: Argon2HashOptions,
  ): Promise<string>;

  export function verify(
    hash: string,
    plain: string,
  ): Promise<boolean>;
}
