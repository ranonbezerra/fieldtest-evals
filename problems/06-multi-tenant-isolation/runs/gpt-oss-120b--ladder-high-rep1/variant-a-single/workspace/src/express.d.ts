declare module 'express' {
  import { IncomingMessage, ServerResponse } from 'http';

  export interface Request extends IncomingMessage {
    headers: Record<string, any>;
    user?: any;
    tenant?: any;
    [key: string]: any;
  }

  export interface Response extends ServerResponse {
    status: (code: number) => this;
    json: (body: any) => this;
    [key: string]: any;
  }

  export type NextFunction = (...args: any[]) => any;
}
