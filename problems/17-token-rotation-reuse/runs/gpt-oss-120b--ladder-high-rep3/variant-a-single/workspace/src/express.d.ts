declare module 'express' {
  import { IncomingMessage, ServerResponse } from 'http';
  import { ParsedQs } from 'qs';
  import { ParamsDictionary } from 'express-serve-static-core';

  export interface Request<
    P = ParamsDictionary,
    ResBody = any,
    ReqBody = any,
    Query = ParsedQs,
    Locals extends Record<string, any> = Record<string, any>
  > extends IncomingMessage {
    params: P;
    query: Query;
    body: ReqBody;
    cookies?: Record<string, string>;
    // other properties can be added as needed
  }

  export interface Response<ResBody = any, Locals extends Record<string, any> = Record<string, any>>
    extends ServerResponse {
    cookie(name: string, value: string, options?: any): this;
    // other methods can be added as needed
  }
}
