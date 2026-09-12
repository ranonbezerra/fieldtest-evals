declare module 'express' {
  export interface Request {
    headers: Record<string, string | string[] | undefined>;
    [key: string]: unknown;
  }
  export interface Response {
    cookie(name: string, value: string, options?: Record<string, unknown>): void;
    [key: string]: unknown;
  }
}
