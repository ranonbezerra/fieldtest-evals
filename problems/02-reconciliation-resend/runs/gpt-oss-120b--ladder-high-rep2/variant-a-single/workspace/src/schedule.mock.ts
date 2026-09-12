// Minimal mock implementations to satisfy compile‑time imports when the real
// @nestjs/schedule package is not present.

export const Cron = (cronExpression: string): MethodDecorator => {
  return () => {
    // No‑op decorator – the actual scheduling is not required for tests.
  };
};

export class ScheduleModule {
  static forRoot() {
    // Returns a dummy module definition compatible with NestJS expectations.
    return {
      module: ScheduleModule,
    };
  }
}
