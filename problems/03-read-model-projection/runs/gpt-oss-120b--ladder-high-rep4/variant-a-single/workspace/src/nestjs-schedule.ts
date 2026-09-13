export class ScheduleModule {
  static forRoot() {
    return {
      module: ScheduleModule,
    };
  }
}

export function Cron(_expression: string) {
  return function (_target: any, _propertyKey: string, descriptor: PropertyDescriptor) {
    // No‑op decorator for testing
    return descriptor;
  };
}

export const CronExpression = {
  EVERY_10_MINUTES: '*/10 * * * *',
};
