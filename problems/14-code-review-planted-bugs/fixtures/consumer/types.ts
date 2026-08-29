export type DeliveryStatus = 'pending' | 'processing' | 'done' | 'failed';

export interface Delivery {
  id: string;
  eventId: string;
  channel: 'email' | 'sms' | 'push';
  recipient: string;
  payload: Record<string, unknown>;
  status: DeliveryStatus;
  attempts: number;
  lastError: string | null;
  createdAt: Date;
}

export interface ProviderEvent {
  id: string;
  provider: string;
  externalId: string;
  type: string;
  receivedAt: Date;
}

/** Trimmed to what this service uses. */
export interface PrismaLike {
  delivery: {
    findMany(args: {
      where?: Record<string, unknown>;
      orderBy?: Record<string, 'asc' | 'desc'>;
      skip?: number;
      take?: number;
    }): Promise<Delivery[]>;
    update(args: { where: { id: string }; data: Partial<Delivery> }): Promise<Delivery>;
    updateMany(args: {
      where: Record<string, unknown>;
      data: Partial<Delivery>;
    }): Promise<{ count: number }>;
    upsert(args: {
      where: { eventId: string };
      create: Omit<Delivery, 'createdAt'>;
      update: Partial<Delivery>;
    }): Promise<Delivery>;
  };
  providerEvent: {
    create(args: { data: Omit<ProviderEvent, 'receivedAt'> }): Promise<ProviderEvent>;
    findUnique(args: {
      where: { provider_externalId: { provider: string; externalId: string } };
    }): Promise<ProviderEvent | null>;
  };
}

export interface RawBodyRequest {
  rawBody: Buffer;
  body: unknown;
}
