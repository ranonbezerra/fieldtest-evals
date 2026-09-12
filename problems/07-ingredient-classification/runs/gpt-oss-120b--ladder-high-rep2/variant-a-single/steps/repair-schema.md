# repair-schema

## reasoning

```
We need to fix provider env usage. Change to literal, likely "postgresql". So modify datasource provider = "postgresql". Keep env for url. Return schema.
```

## reply

```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
```
