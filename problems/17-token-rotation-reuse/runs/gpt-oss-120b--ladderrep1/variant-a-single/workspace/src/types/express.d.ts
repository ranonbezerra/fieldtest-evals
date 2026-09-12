declare module 'express' {
  import { Request as ExRequest, Response as ExResponse, CookieOptions } from 'express-serve-static-core';
  export type Request = ExRequest;
  export type Response = ExResponse;
  export type CookieOptions = CookieOptions;
}
