import { Injectable } from '@nestjs/common';

@Injectable()
export class NotificationsService {
  async sendTransferReceipt(transferId: string): Promise<void> {
    // implementation
  }
}
