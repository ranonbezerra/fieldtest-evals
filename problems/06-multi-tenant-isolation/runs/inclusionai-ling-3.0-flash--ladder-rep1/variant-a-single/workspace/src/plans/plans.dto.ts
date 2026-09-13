export interface CreatePlanDto {
  name: string;
  price: number;
}

export interface UpdatePlanDto {
  name?: string;
  price?: number;
}
