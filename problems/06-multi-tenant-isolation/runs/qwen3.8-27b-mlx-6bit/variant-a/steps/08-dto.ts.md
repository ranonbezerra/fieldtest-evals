# 08-dto.ts

## reasoning

```
The user wants me to write exactly one file: `src/customer/dto.ts`.

From the PLAN.md, I can see the DTO/Input types for customer:

```ts
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
```

This is straightforward. The plan explicitly defines these three interfaces. Let me write the file with exactly these exports and nothing else.
```

## reply

```ts
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
```
