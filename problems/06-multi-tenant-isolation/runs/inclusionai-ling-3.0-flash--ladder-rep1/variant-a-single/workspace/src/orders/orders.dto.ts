export interface CreateOrderDto {
  amount: number;
  status: string;
}

export interface UpdateOrderDto {
  status?: string;
  amount?: number;
}
