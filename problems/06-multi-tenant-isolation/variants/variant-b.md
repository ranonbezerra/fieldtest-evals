# Variant B — Agency workspace SaaS

A project-management SaaS sells isolated workspaces to agencies. Each agency has
its own subdomain (`acme.tool.com`), members, clients, and projects. Data leaks
between agencies are contract-breaking. Tokens carry a `workspace` claim.

Build in **TypeScript + NestJS + Prisma + Postgres**:

1. Workspace resolution middleware from subdomain + token claim (must agree),
   stored in request-scoped context; mismatch = reject.
2. Structural isolation: workspace-aware Prisma client scoping every read and
   stamping every write centrally; no per-handler manual filtering.
3. Schema for members/clients/projects with workspace-scoped uniqueness (project
   slug unique per workspace, member email unique per workspace).
4. `GET /workspace-config` — name, logo, plan limits for the resolved workspace.
5. An audited admin escape hatch: a support-role path that can read across
   workspaces, logged with actor + reason, unusable from tenant credentials.
6. Tests: workspace B cannot list/fetch(404)/update/delete workspace A's data;
   same slug in two workspaces; context integrity under concurrent requests.
