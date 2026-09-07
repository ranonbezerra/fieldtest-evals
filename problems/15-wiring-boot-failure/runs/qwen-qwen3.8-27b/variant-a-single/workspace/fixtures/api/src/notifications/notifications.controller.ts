import { Body, Controller, Inject, Post } from '@nestjs/common';
import { NotificationsService } from './notifications.service.js';
import type { SendNotificationInput } from './notifications.service.js';

@Controller('notifications')
export class NotificationsController {
  constructor(
    @Inject(NotificationsService) private readonly notificationsService: NotificationsService,
  ) {}

  @Post()
  send(@Body() body: SendNotificationInput) {
    return this.notificationsService.send(body);
  }
}
