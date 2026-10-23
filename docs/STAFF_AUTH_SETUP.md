# Staff authentication setup (Psychologist + Admin)

## Architecture

- **Anonymous clients** continue to use `/api/auth/*` (recovery key + JWT). Unchanged.
- **Staff** (psychologists and admins) authenticate via **self-hosted SuperTokens** at `/api/v1/staff/auth`.
- Application data lives in Prisma (`Account`, roles, psychologist verification, admin RBAC). SuperTokens owns credentials and sessions.

Authentication alone does **not** grant staff access. A provisioned `Account` with the correct `AccountRole`, and for admins an active `AdminMembership` plus permissions, is required.

## Prerequisites

1. PostgreSQL for the U Mind app database.
2. SuperTokens Core (PostgreSQL-backed Docker image recommended) on a private network with `API_KEYS` set.
3. Prefer a **separate database or schema** for SuperTokens tables so Prisma migrations do not conflict.

## Environment

Copy `.env.example` and set:

- `SUPERTOKENS_CONNECTION_URI`, `SUPERTOKENS_API_KEY`
- `SUPERTOKENS_API_BASE_PATH=/api/v1/staff/auth` (do not use `/api/auth`)
- `INVITATION_TOKEN_PEPPER`
- Leave `OBJECT_STORAGE_CONFIGURED=false` until a real provider is implemented (document upload routes return **503**)

## Database

```bash
npx prisma migrate deploy
npm run prisma:seed:staff-rbac
```

The seed creates role/permission catalogs only. It does **not** grant founder access to any account.

## Founder bootstrap (manual / ops)

1. Create a SuperTokens EmailPassword user via Core/admin APIs or a one-off script (public `signUpPOST` is disabled).
2. Insert an `Account` with that `superTokensUserId`.
3. Add `AccountRole` `ADMIN`.
4. Create `AdminMembership` (ACTIVE) and attach `FOUNDER_SUPER_ADMIN` via `AdminMembershipRole`.

## Object storage

`src/lib/objectStorage.ts` is an abstraction that fails with **503 Service Unavailable** until configured. Do not fabricate credentials. Wire a private bucket provider and set `OBJECT_STORAGE_CONFIGURED=true` when ready.

## Rate limiting

Invitation and accept endpoints use an **in-memory** rate limiter (`src/middleware/rateLimit.ts`). It is per-process only and resets on restart. Swap the store for Redis (or similar) for multi-instance production.

## Key routes

| Method | Path | Notes |
|--------|------|--------|
| GET | `/api/v1/staff/me` | Provisioned staff session |
| GET | `/api/v1/staff/me/permissions` | Active admin only |
| * | `/api/v1/staff/psychologist/*` | Requires `PSYCHOLOGIST` role |
| * | `/api/v1/staff/admin/*` | Requires `ADMIN` + membership + permission |
| POST | `/api/v1/staff/invitations/accept` | ST session; creates membership transactionally |

There is **no** public admin signup route.
