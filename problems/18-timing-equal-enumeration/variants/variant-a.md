# Variant A — Sign-up must not reveal that an email is taken

Build the sign-up and sign-in endpoints for an API where an attacker must not be
able to learn whether an address has an account.

## Requirements

Implement in **TypeScript + NestJS + Prisma + PostgreSQL**:

1. `POST /auth/sign-up` — `{ email, password }`. A new address creates the
   account. An address that already exists **produces the same response as one
   that did not**: same status, same body, same headers.
2. `POST /auth/sign-in` — `{ email, password }`. A wrong password and an unknown
   address produce the same response.
3. Passwords are hashed with argon2id or bcrypt at a real cost factor.
4. An observer who can send requests and measure how long they take must not be
   able to tell the branches apart. This is a requirement, not a nice-to-have,
   and it is the one the other requirements do not imply.
5. The real outcome still reaches the account owner: an existing address gets a
   "someone tried to sign up with your address" email; a new one gets a
   verification email. Neither may change what the caller observes.

## Deliverables

- Prisma schema + migration
- NestJS module: controller, service, repository
- Tests that fail if the property is broken — including a timing test that
  compares the two branches over multiple samples, and a byte comparison of the
  two responses
- `SECURITY.md` (15–25 lines): the mechanism, why you chose it over the
  alternatives, and what it does **not** protect against

Assume a mail port `sendEmail(to, template, vars): Promise<void>` exists.
