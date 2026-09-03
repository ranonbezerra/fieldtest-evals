export interface CreatePlanInput {
  name: string;
  priceCents: number;
}

export interface UpdatePlanInput {
  name?: string;
  priceCents?: number;
}

export interface Plan {
  id: string;
  name: string;
  priceCents: number;
  createdAt: Date;
  updatedAt: Date;
}
