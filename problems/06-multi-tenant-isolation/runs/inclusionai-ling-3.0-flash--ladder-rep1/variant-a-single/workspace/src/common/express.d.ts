declare module 'express' {
  export interface Request {
    [key: string]: any;
    headers: Record<string, string | string[]>;
  }
  export interface Response {
    [key: string]: any;
  }
  export type NextFunction = (err?: any) => void;
}
