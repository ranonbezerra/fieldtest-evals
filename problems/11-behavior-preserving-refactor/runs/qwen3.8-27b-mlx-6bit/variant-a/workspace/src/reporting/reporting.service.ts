import { PaymentStatusMapper } from '../shared/payment-status-mapper';

// ASSUMPTION: @nestjs/common is unavailable in this workspace; the service
// is a plain class with no decorators, consistent with the plan's note that
// the mapper has no NestJS lifecycle hooks.

export class ReportingService {
  private readonly mapper: PaymentStatusMapper;

  constructor() {
    this.mapper = new PaymentStatusMapper({
      unknownPolicy: 'skip',
      legacyReportCasing: true,
    });
  }

  /**
   * Map an array of raw provider status codes to their internal status strings.
   * Unknown codes are silently dropped (skip policy).
   * The 'completed' status is emitted as the literal 'COMPLETED' (legacy quirk).
   */
  mapStatuses(providerCodes: string[]): string[] {
    return providerCodes
      .map((code) => this.mapper.map(code))
      .filter((s): s is string => s !== undefined);
  }
}
