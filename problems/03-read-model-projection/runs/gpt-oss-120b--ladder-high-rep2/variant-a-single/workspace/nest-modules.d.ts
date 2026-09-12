declare module '@nestjs/schedule' {
  export function Cron(cronExpression: string): MethodDecorator;
}

declare module '@nestjs/testing' {
  export const Test: any;
  export type TestingModule = any;
}
