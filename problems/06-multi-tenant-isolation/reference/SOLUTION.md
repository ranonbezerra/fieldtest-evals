# Reference solution — annotated core

## Crux 1: resolve once, server-side

```ts
@Injectable()
export class TenantMiddleware implements NestMiddleware {
  async use(req: Request, _res: Response, next: NextFunction) {
    const byHost  = await this.tenants.findByHost(req.hostname);   // M1
    const byToken = req.auth?.orgId;
    if (!byHost || byHost.id !== byToken) throw new UnauthorizedException();
    tenantContext.run({ tenantId: byHost.id }, next);              // AsyncLocalStorage
  }
}
```

`AsyncLocalStorage` gives request-scoped context that survives async boundaries
without threading a parameter through every signature (graded 1).

## Crux 2: structural enforcement — the query can't forget

```ts
// Prisma client extension: every op on tenant-owned models is scoped/stamped.
export const tenantPrisma = base.$extends({
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        if (!TENANT_OWNED.has(model)) return query(args);
        const { tenantId } = tenantContext.getStore();      // throws if absent
        if (READS.has(operation))
          args.where = { AND: [args.where ?? {}, { tenantId }] };   // M2
        if (operation === 'create')
          args.data = { ...args.data, tenantId };                    // M3: stamp,
          // overwriting anything the client sent — forged ids die here.
        return query(args);
      },
    },
  },
});
```

Handlers use `tenantPrisma` like a normal client; isolation is a property of the
layer, not of developer memory. (RLS with `SET app.tenant_id` is the equally
valid DB-level version.)

## Crux 3: schema — uniqueness changes meaning

```prisma
model Customer {
  id       String @id @default(uuid())
  tenantId String
  email    String
  @@unique([tenantId, email])          // M4: unique PER TENANT
  @@index([tenantId])
}
```

## Crux 4: probing safety

Fetch-by-id goes through the same scoped client, so another tenant's id simply
matches nothing → the handler's normal not-found path returns **404** (M6). A
403 would confirm the resource exists.

## Common wrong answers

- Tenant from a header/body the client controls — isolation by honor system.
- `where: { tenantId }` hand-written in every repository method — works until
  the first forgotten clause; this is the failure mode the problem is about.
- Global `@unique` on email/slug — tenant B blocked by tenant A's data.
- 403 on cross-tenant fetch — leaks existence.
- Tenant kept in a singleton/module-scoped variable — bleeds across concurrent
  requests; must be request-scoped (ALS/CLS).
