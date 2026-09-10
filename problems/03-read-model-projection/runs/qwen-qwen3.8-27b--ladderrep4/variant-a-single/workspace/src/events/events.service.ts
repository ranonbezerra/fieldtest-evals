import { Injectable } from '@nestjs/common';
import { AppError } from '../common/app-error.js';
import { EventRepository, LogEventInput } from './events.repository.js';

export interface EventDto {
  id: string;
  orderId: string;
  type: string;
  createdAt: Date;
}

@Injectable()
export class EventService {
  constructor(private readonly events: EventRepository) {}

  logEvent(input: LogEventInput): Promise<EventDto> {
    return this.events.findWorker(input.workerId).then(async (worker) => {
      if (!worker || worker.companyId !== input.companyId) {
        throw new AppError(404, 'resource_not_found', `Worker ${input.workerId} was not found in company ${input.companyId}.`, {
          workerId: input.workerId,
          companyId: input.companyId,
        });
      }
      const event = await this.events.logEvent(input);
      return {
        id: event.id,
        orderId: event.orderId,
        type: event.type,
        createdAt: event.createdAt,
      };
    });
  }
}
