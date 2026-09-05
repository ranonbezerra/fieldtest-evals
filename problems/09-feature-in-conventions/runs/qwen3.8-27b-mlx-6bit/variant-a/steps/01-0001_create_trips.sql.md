# 01-0001_create_trips.sql

## reasoning

```
Let me analyze the PLAN.md to write the exact DDL for the three tables: trips, trip_members, and trip_invites.

From the plan:

**trips**
| column | type | notes |
|---|---|---|
| id | SERIAL PK | |
| name | TEXT NOT NULL | |
| destination | TEXT NOT NULL | |
| start_date | TIMESTAMPTZ NOT NULL | |
| end_date | TIMESTAMPTZ NOT NULL | |
| created_at | TIMESTAMPTZ NOT NULL DEFAULT now() | |
| updated_at | TIMESTAMPTZ NOT NULL DEFAULT now() | |

**trip_members**
| column | type | notes |
|---|---|---|
| id | SERIAL PK | |
| trip_id | INT NOT NULL FK → trips.id ON DELETE CASCADE | |
| user_id | INT NOT NULL FK → users.id | |
| role | TEXT NOT NULL CHECK IN ('owner','member') | |
| created_at | TIMESTAMPTZ NOT NULL DEFAULT now() | |
| updated_at | TIMESTAMPTZ NOT NULL DEFAULT now() | |
| UNIQUE (trip_id, user_id) | | |

**trip_invites**
| column | type | notes |
|---|---|---|
| id | SERIAL PK | |
| trip_id | INT NOT NULL FK → trips.id ON DELETE CASCADE | |
| email | TEXT NOT NULL | |
| token | TEXT(64) NOT NULL UNIQUE | |
| status | TEXT NOT NULL DEFAULT 'pending' CHECK IN ('pending','accepted','declined') | |
| invited_by | INT NOT NULL FK → users.id | |
| created_at | TIMESTAMPTZ NOT NULL DEFAULT now() | |
| updated_at | TIMESTAMPTZ NOT NULL DEFAULT now() | |

Now let me write the DDL. The plan says "Drizzle migrations are plain SQL files in `drizzle/`". So this is a plain SQL migration file.

Let me write it:
```

## reply

```sql
CREATE TABLE trips (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    destination TEXT NOT NULL,
    start_date TIMESTAMPTZ NOT NULL,
    end_date TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE trip_members (
    id SERIAL PRIMARY KEY,
    trip_id INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id),
    role TEXT NOT NULL CHECK (role IN ('owner', 'member')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (trip_id, user_id)
);

CREATE TABLE trip_invites (
    id SERIAL PRIMARY KEY,
    trip_id INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    token TEXT(64) NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined')),
    invited_by INTEGER NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```
