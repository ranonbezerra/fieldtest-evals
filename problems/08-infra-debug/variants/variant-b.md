# Variant B — docker-compose stack that "randomly" fails

A team's local/CI stack (`docker-compose.yml`: api, worker, postgres, redis,
nginx) fails intermittently. Symptoms reported:

- `docker compose up` sometimes works, sometimes the api crash-loops on boot
  with a database connection error; a manual restart of api "fixes" it.
- The worker never processes jobs in CI, though it works on one dev's machine.
- nginx returns 502 for `/api` even when the api container is healthy.
- postgres data vanishes between CI runs (expected) but also between local
  restarts (not expected).

You are given the compose file containing (among working config): api
`depends_on: [postgres]` with no condition and no healthcheck on postgres; the
worker reading `REDIS_URL=redis://localhost:6379`; nginx `proxy_pass
http://api:8080` while the api listens on 3000; the postgres service missing a
volume for its data dir (an anonymous volume masks it locally until pruned).

Deliver:

1. `diagnosis.md` — each symptom → root cause, with the evidence command
   (`docker compose logs`, `docker inspect`, in-network `curl`), noting which
   symptoms are timing-dependent and why "restart fixes it" is a clue.
2. A corrected `docker-compose.yml` as a minimal diff: healthcheck +
   `depends_on: condition: service_healthy`, service-name networking, correct
   ports, named volume. No `privileged`, no host networking as a workaround.
3. `runbook.md` — verification: cold start from `down -v`, expected healthy
   states, an end-to-end request, and a job processed by the worker.
