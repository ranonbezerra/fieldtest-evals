# search-service

```bash
cp .env.example .env && set -a && . ./.env && set +a
docker compose up -d db
./scripts/migrate.sh
./scripts/verify.sh
```

`psql` is required for the scripts. On macOS: `brew install libpq` and put its `bin`
on `PATH`.
