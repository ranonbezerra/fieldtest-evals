declare module 'class-validator' {
  export const IsEmail: PropertyDecorator;
  export const IsString: PropertyDecorator;
  export const MinLength: (length: number) => PropertyDecorator;
  export function validate<T>(object: T): Promise<any[]>;
  // Add other exports as needed for compilation.
}

declare module 'argon2' {
  export const argon2id: any;
  export function hash(
    plain: string,
    options?: Record<string, any>,
  ): Promise<string>;
  export function verify(
    hash: string,
    plain: string,
    options?: Record<string, any>,
  ): Promise<boolean>;
}

declare module '@nestjs/testing' {
  import { TestingModule } from '@nestjs/common';
  export const Test: {
    createTestingModule(metadata: any): {
      compile(): Promise<TestingModule>;
    };
  };
}

declare module 'supertest' {
  import { IncomingMessage } from 'http';
  export default function request(app: any): any;
}
