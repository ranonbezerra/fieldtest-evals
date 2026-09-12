# repair-schema

## reasoning

```
We need to add datasource. Provide schema with datasource and generator? Likely need minimal. Provide datasource db with provider postgresql and url env("DATABASE_URL") as per conventions. Also need generator client. Return full file; assume existing models present but not shown. We'll just prepend datasource and generator at top.
```

## reply

```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
  previewFeatures = ["referentialIntegrity"]
}

# -------------------------------------------------
# Existing models, enums, and other definitions follow.
# They are kept unchanged.
# -------------------------------------------------
```
