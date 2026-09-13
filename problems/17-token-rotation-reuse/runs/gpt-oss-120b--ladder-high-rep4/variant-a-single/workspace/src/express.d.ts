declare module 'express' {
  import { IncomingMessage, ServerResponse } from 'http';
  import { ParsedUrlQuery } from 'querystring';
  import { CookieOptions } from 'express-serve-static-core';

  export interface Request<P = any, ResBody = any, ReqBody = any, Query = ParsedUrlQuery>
    extends IncomingMessage {
    body?: ReqBody;
    cookies?: Record<string, string>;
    query?: Query;
    params?: P;
  }

  export interface Response<ResBody = any, Locals extends Record<string, any> = Record<string, any>>
    extends ServerResponse {
    status(code: number): this;
    json: (body: any) => this;
    cookie(name: string, value: any, options?: CookieOptions): this;
  }
}
