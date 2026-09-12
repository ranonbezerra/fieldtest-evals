declare module '@nestjs/schedule' {
  export const Cron: (...args: any[]) => MethodDecorator;
  export const CronExpression: {
    EVERY_15_MINUTES: string;
  };
  export class ScheduleModule {
    static forRoot(): any;
  }
}
