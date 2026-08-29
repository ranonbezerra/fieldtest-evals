import { Module } from '@nestjs/common';
import { DeliveryRepository } from './delivery.repository.js';
import { NotificationsService } from './notifications.service.js';

@Module({
  providers: [NotificationsService, DeliveryRepository],
  exports: [NotificationsService],
})
export class NotificationsModule {}
