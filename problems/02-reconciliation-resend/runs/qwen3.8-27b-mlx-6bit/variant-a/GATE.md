$ prisma generate -> 0
Prisma schema loaded from prisma/schema.prisma

✔ Generated Prisma Client (v5.22.0) to ./node_modules/.pnpm/@prisma+client@5.22.0_prisma@5.22.0/node_modules/@prisma/client in 22ms

Start by importing your Prisma Client (See: https://pris.ly/d/importing-client)

Tip: Want to turn off tips and other hints? https://pris.ly/tip-4-nohints

┌─────────────────────────────────────────────────────────┐
│  Update available 5.22.0 -> 8.0.0-rc.12                 │
│                                                         │
│  This is a major update - please follow the guide at    │
│  https://pris.ly/d/major-version-upgrade                │
│                                                         │
│  Run the following to update                            │
│    npm i --save-dev prisma@latest                       │
│    npm i @prisma/client@latest                          │
└─────────────────────────────────────────────────────────┘


$ tsc --noEmit (attempt 0) -> 2
src/app.module.ts(2,31): error TS2307: Cannot find module './payment/payment.module' or its corresponding type declarations.
src/payment/payment.repository.ts(11,18): error TS2353: Object literal may only specify known properties, and 'createdAt' does not exist in type 'OrderOrderByWithRelationInput | OrderOrderByWithRelationInput[]'.
src/payment/payment.repository.ts(22,36): error TS2561: Object literal may only specify known properties, but 'effectiveDate' does not exist in type 'OrderWhereInput'. Did you mean to write 'effective_date'?
src/payment/payment.repository.ts(29,31): error TS2561: Object literal may only specify known properties, but 'lastAttemptAt' does not exist in type '(Without<OrderUpdateManyMutationInput, OrderUncheckedUpdateManyInput> & OrderUncheckedUpdateManyInput) | (Without<...> & OrderUpdateManyMutationInput)'. Did you mean to write 'last_attempt_at'?
src/payment/payment.repository.ts(36,35): error TS2561: Object literal may only specify known properties, but 'lastAttemptAt' does not exist in type '(Without<OrderUpdateManyMutationInput, OrderUncheckedUpdateManyInput> & OrderUncheckedUpdateManyInput) | (Without<...> & OrderUpdateManyMutationInput)'. Did you mean to write 'last_attempt_at'?
src/payment/payment.repository.ts(50,34): error TS2561: Object literal may only specify known properties, but 'settledAt' does not exist in type '(Without<OrderUpdateManyMutationInput, OrderUncheckedUpdateManyInput> & OrderUncheckedUpdateManyInput) | (Without<...> & OrderUpdateManyMutationInput)'. Did you mean to write 'settled_at'?
src/payment/payment.repository.ts(90,9): error TS2561: Object literal may only specify known properties, but 'amountMinorUnits' does not exist in type '(Without<SettlementCreateInput, SettlementUncheckedCreateInput> & SettlementUncheckedCreateInput) | (Without<...> & SettlementCreateInput)'. Did you mean to write 'amount_minor_units'?
src/payment/payment.service.ts(3,70): error TS2307: Cannot find module './bank-client.interface' or its corresponding type declarations.
src/payment/payment.service.ts(4,53): error TS2307: Cannot find module './payment.repository' or its corresponding type declarations.
test/payment.spec.ts(2,32): error TS2307: Cannot find module '../src/payment/payment.service' or its corresponding type declarations.
test/payment.spec.ts(3,63): error TS2307: Cannot find module '../src/payment/bank-client.interface' or its corresponding type declarations.
test/payment.spec.ts(24,17): error TS2344: Type 'Promise<BankSendResponse>' does not satisfy the constraint 'Procedure'.
  Type 'Promise<BankSendResponse>' provides no match for the signature '(...args: any[]): any'.
test/payment.spec.ts(25,25): error TS2344: Type 'Promise<Settlement[]>' does not satisfy the constraint 'Procedure'.
  Type 'Promise<Settlement[]>' provides no match for the signature '(...args: any[]): any'.


$ tsc --noEmit (attempt 1) -> 2
src/app.module.ts(3,31): error TS2307: Cannot find module './payment/payment.module' or its corresponding type declarations.
src/payment/payment.repository.ts(21,5): error TS2322: Type '{ id: string; supplier_key: string; amount_minor_units: bigint; effective_date: Date; txid: string; status: string; attempt_count: number; last_attempt_at: Date | null; settled_at: Date | null; created_at: Date; updated_at: Date; }[]' is not assignable to type 'OrderRecord[]'.
  Type '{ id: string; supplier_key: string; amount_minor_units: bigint; effective_date: Date; txid: string; status: string; attempt_count: number; last_attempt_at: Date | null; settled_at: Date | null; created_at: Date; updated_at: Date; }' is not assignable to type 'OrderRecord'.
    Types of property 'amount_minor_units' are incompatible.
      Type 'bigint' is not assignable to type 'number'.
src/payment/payment.repository.ts(29,5): error TS2322: Type '{ id: string; supplier_key: string; amount_minor_units: bigint; effective_date: Date; txid: string; status: string; attempt_count: number; last_attempt_at: Date | null; settled_at: Date | null; created_at: Date; updated_at: Date; } | null' is not assignable to type 'OrderRecord | null'.
  Type '{ id: string; supplier_key: string; amount_minor_units: bigint; effective_date: Date; txid: string; status: string; attempt_count: number; last_attempt_at: Date | null; settled_at: Date | null; created_at: Date; updated_at: Date; }' is not assignable to type 'OrderRecord'.
    Types of property 'amount_minor_units' are incompatible.
      Type 'bigint' is not assignable to type 'number'.
src/payment/payment.repository.ts(33,5): error TS2322: Type '{ id: string; supplier_key: string; amount_minor_units: bigint; effective_date: Date; txid: string; status: string; attempt_count: number; last_attempt_at: Date | null; settled_at: Date | null; created_at: Date; updated_at: Date; }[]' is not assignable to type 'OrderRecord[]'.
  Type '{ id: string; supplier_key: string; amount_minor_units: bigint; effective_date: Date; txid: string; status: string; attempt_count: number; last_attempt_at: Date | null; settled_at: Date | null; created_at: Date; updated_at: Date; }' is not assignable to type 'OrderRecord'.
    Types of property 'amount_minor_units' are incompatible.
      Type 'bigint' is not assignable to type 'number'.
test/payment.spec.ts(2,32): error TS2307: Cannot find module '../src/payment/payment.service' or its corresponding type declarations.
test/payment.spec.ts(3,80): error TS2307: Cannot find module '../src/payment/bank-client.interface' or its corresponding type declarations.


$ tsc --noEmit (attempt 2) -> 2
src/app.module.ts(2,31): error TS2307: Cannot find module './payment/payment.module' or its corresponding type declarations.
src/payment/payment.repository.ts(29,5): error TS2322: Type '{ id: string; supplier_key: string; amount_minor_units: bigint; effective_date: Date; txid: string; status: string; attempt_count: number; last_attempt_at: Date | null; settled_at: Date | null; created_at: Date; updated_at: Date; }[]' is not assignable to type 'OrderRecord[]'.
  Type '{ id: string; supplier_key: string; amount_minor_units: bigint; effective_date: Date; txid: string; status: string; attempt_count: number; last_attempt_at: Date | null; settled_at: Date | null; created_at: Date; updated_at: Date; }' is not assignable to type 'OrderRecord'.
    Types of property 'status' are incompatible.
      Type 'string' is not assignable to type 'OrderStatus'.
src/payment/payment.repository.ts(37,5): error TS2322: Type '{ id: string; supplier_key: string; amount_minor_units: bigint; effective_date: Date; txid: string; status: string; attempt_count: number; last_attempt_at: Date | null; settled_at: Date | null; created_at: Date; updated_at: Date; } | null' is not assignable to type 'OrderRecord | null'.
  Type '{ id: string; supplier_key: string; amount_minor_units: bigint; effective_date: Date; txid: string; status: string; attempt_count: number; last_attempt_at: Date | null; settled_at: Date | null; created_at: Date; updated_at: Date; }' is not assignable to type 'OrderRecord'.
    Types of property 'status' are incompatible.
      Type 'string' is not assignable to type 'OrderStatus'.
src/payment/payment.repository.ts(41,5): error TS2322: Type '{ id: string; supplier_key: string; amount_minor_units: bigint; effective_date: Date; txid: string; status: string; attempt_count: number; last_attempt_at: Date | null; settled_at: Date | null; created_at: Date; updated_at: Date; }[]' is not assignable to type 'OrderRecord[]'.
  Type '{ id: string; supplier_key: string; amount_minor_units: bigint; effective_date: Date; txid: string; status: string; attempt_count: number; last_attempt_at: Date | null; settled_at: Date | null; created_at: Date; updated_at: Date; }' is not assignable to type 'OrderRecord'.
    Types of property 'status' are incompatible.
      Type 'string' is not assignable to type 'OrderStatus'.
test/payment.spec.ts(2,49): error TS2307: Cannot find module '../src/payment/payment.service' or its corresponding type declarations.
test/payment.spec.ts(3,63): error TS2307: Cannot find module '../src/payment/bank-client.interface' or its corresponding type declarations.
test/payment.spec.ts(4,34): error TS2307: Cannot find module '../src/payment/payment.repository' or its corresponding type declarations.

