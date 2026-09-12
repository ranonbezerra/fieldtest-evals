// Minimal shims to satisfy TypeScript compiler for missing external modules.

declare module 'class-validator' {
  // The actual library provides many decorators; we only need the one used in the code.
  export function IsISO8601(): PropertyDecorator;
}

declare module '@nestjs/schedule' {
  // Scheduler decorators and module; implementations are not required for compilation.
  export function Cron(cronExpression: string): MethodDecorator;
  export const ScheduleModule: {
    forRoot(): any;
  };
}
