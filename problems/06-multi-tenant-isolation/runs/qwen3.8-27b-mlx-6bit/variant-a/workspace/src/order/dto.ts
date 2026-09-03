export interface CreateOrderInput {
  customerId: string;
  planId: string;
  status?: string;
  totalCents: number;
}

export interface UpdateOrderInput {
  customerId?: string;
  planId?: string;
  status?: string;
  totalCents?: number;
}

export interface Order {
  id: string;
  customerId: string;
  planId: string;
  status: string;
  totalCents: number;
  createdAt: Date;
  updatedAt: Date;
}
