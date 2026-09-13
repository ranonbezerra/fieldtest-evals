declare module 'express' {
  export interface Request {
    // allow any additional properties Nest may add
    [key: string]: any;
  }
  export interface Response {
    [key: string]: any;
  }
  export interface NextFunction {
    (...args: any[]): any;
  }
}

declare module 'class-validator' {
  export const IsEmail: any;
  export const IsString: any;
  export const IsNotEmpty: any;
  export const IsOptional: any;
}

declare module 'helmet' {
  const helmet: any;
  export default helmet;
}

declare module '@nestjs/testing' {
  export const Test: any;
  export const TestingModule: any;
}

declare module 'supertest' {
  const request: any;
  export default request;
}
