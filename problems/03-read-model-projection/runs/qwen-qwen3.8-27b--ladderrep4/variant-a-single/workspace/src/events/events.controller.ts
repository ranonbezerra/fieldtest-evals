import { Body, Controller, Post } from '@nestjs/common';
import { IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { EventService, EventDto } from './events.service.js';

export class LogEventDto {
  @IsUUID()
  companyId!: string;

  @IsUUID()
  workerId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  type!: string;
}

@Controller('events')
export class EventsController {
  constructor(private readonly events: EventService) {}

  @Post()
  log(@Body() body: LogEventDto): Promise<EventDto> {
    return this.events.logEvent(body);
  }
}
