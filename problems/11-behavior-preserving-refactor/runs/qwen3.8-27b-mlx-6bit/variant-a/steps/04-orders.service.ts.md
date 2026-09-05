# 04-orders.service.ts

## reasoning

```
Let me analyze what I need to write for `src/orders/orders.service.ts`.

From the PLAN.md:
- Orders service refactored to delegate status mapping to PaymentStatusMapper with throw policy
- The orders service instantiates `new PaymentStatusMapper({ unknownPolicy: 'throw' })` and calls `.map(code)`.
- The orders service previously had a local private method `mapStatus(code)` that always throws on unknown.

From the layout conventions:
- `src/<feature>/<feature>.service.ts`
- The service holds the logic. Zero raw SQL, zero Prisma client calls.
- Class: `PascalCase`

From the mapper reference:
- `PaymentStatusMapper` is in `src/shared/payment-status-mapper.ts`
- It exports `PaymentStatusMapper`, `InternalStatus`, `UnknownPolicy`, `MapperOptions`
- The `map` method returns `string | undefined`

Now, I need to write the orders service. The plan says:
- Orders service delegates status mapping to PaymentStatusMapper with throw policy
- It previously had a local private method `mapStatus(code)` → always throws on unknown.

The service should:
1. Import `PaymentStatusMapper` from `src/shared/payment-status-mapper.ts`
2. Instantiate it with `{ unknownPolicy: 'throw' }`
3. Have a method that maps provider status codes using the mapper

Since this is a NestJS service, it should be decorated with `@Injectable()`. It's listed in the orders module's providers.

The plan says the orders service "calls a local private method `mapStatus(code)`" before, and after, it delegates to the mapper. So I need to keep a method that other code in the service would call to get the mapped status.

Let me think about what the orders service likely does in a marketplace API:
- It probably has methods related to orders (get order, list orders, etc.)
- When displaying an order, it maps the payment status from provider code to internal status

Since I don't have the original file, I need to write a reasonable orders service that:
1. Is a NestJS `@Injectable()` service
2. Uses the `PaymentStatusMapper` with `unknownPolicy: 'throw'`
3. Has a method that maps status (the delegation point)

The plan says the service should delegate to the mapper. The key method is whatever was previously `mapStatus(code)`.

Let me write a clean, minimal orders service that:
- Imports and instantiates `PaymentStatusMapper`
- Exposes a `mapPaymentStatus` method (or keeps the internal `mapStatus`) that delegates to the mapper
- Has typical order-related methods that would use this

Actually, looking more carefully at the plan: "Orders service refactored to delegate status mapping to PaymentStatusMapper with throw policy". The key change is that instead of having its own inline mapping logic, it now uses the shared mapper.

Since I don't have the original file content, I need to write something defensible. The service should:
1. Be `@Injectable()`
2. Create a `PaymentStatusMapper` instance with `{ unknownPolicy: 'throw' }`
3. Have a method that maps provider status codes (this is what the controller or other code calls)
4. Perhaps have order-related CRUD methods that use this mapping

Let me keep it focused. The plan specifically says this file is about delegating status mapping. I'll write a service that has the mapper and a public method for mapping, plus perhaps a basic `getOrder` or similar that uses it.

Actually, I should be careful. The task says "Do not add an export, a feature or a file the plan does not name." So I should only include what's necessary for the orders service to delegate status mapping.

Let me write a minimal but complete NestJS service:

```typescript
import { Injectable, NotFoundException } from '@nestjs/common';
import { PaymentStatusMapper } from '../shared/payment-status-mapper';

@Injectable()
export class OrdersService {
  private readonly mapper = new PaymentStatusMapper({ unknownPolicy: 'throw' });

  mapPaymentStatus(providerCode: string): string {
    return this.mapper.map(providerCode) as string;
  }
}
```

Wait, but this seems too thin. In a real marketplace API, the orders service would have more. But the plan says to implement exactly what it specifies. The plan says:

"Orders service refactored to delegate status mapping to PaymentStatusMapper with throw policy"

The key behavior: the orders service uses the mapper with throw policy. The previous local `mapStatus(code)` is replaced by delegation to the mapper.

Since I don't have the original file, I'll write a service that:
1. Has the mapper instantiated with throw policy
2. Has a public method that delegates to the mapper for status mapping
3. Is structured as a proper NestJS service

I'll keep it minimal but complete. The `map` method returns `string | undefined`, but with throw policy, it will never return undefined (it throws instead), so I can safely assert or cast to `string`.

Let me finalize my approach. The service is an orders service in a marketplace. It maps payment statuses for display. I'll write it with:
- The mapper as a private readonly field
- A public method `mapPaymentStatus` that delegates to the mapper

This is the minimal defensible implementation given what I know.
```

## reply

```typescript
import { Injectable } from '@nestjs/common';
import { PaymentStatusMapper } from '../shared/payment-status-mapper';

@Injectable()
export class OrdersService {
  private readonly mapper = new PaymentStatusMapper({ unknownPolicy: 'throw' });

  /**
   * Map a raw provider payment-status code to the internal status for display.
   * Throws `TypeError` for codes not in the mapping table (preserves legacy
   * orders behaviour).
   */
  mapPaymentStatus(providerCode: string): string {
    const result = this.mapper.map(providerCode);
    if (result === undefined) {
      // Unreachable with 'throw' policy; guard for type-narrowing only.
      throw new TypeError(`Unknown provider status code: ${providerCode}`);
    }
    return result;
  }
}
```
