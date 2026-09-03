export interface CreateCustomerInput {
  email: string;
  name: string;
}

export interface UpdateCustomerInput {
  email?: string;
  name?: string;
}

export interface Customer {
  id: string;
  email: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}
