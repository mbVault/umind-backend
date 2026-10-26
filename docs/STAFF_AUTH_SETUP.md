# Staff authentication setup (Psychologist + Admin)

## Architecture

- **Anonymous clients** continue to use `/api/auth/*` (recovery key + JWT). Unchanged.
- **Staff** (psychologists and admins) authenticate via **self-hosted SuperTokens** at `/api/v1/staff/auth`.
- Application data lives in Prisma (`Account`, roles, psychologist verification, admin RBAC). SuperTokens owns credentials and sessions.

Authentication alone does **not** grant staff access. A provisioned `Account` with the correct `AccountRole`, and for admins an active `AdminMembership` plus permissions, is required.

## Prerequisites

1. PostgreSQL for the U Mind app database (`DATABASE_URL` / Prisma).
2. SuperTokens Core (PostgreSQL-backed Docker image) with `API_KEYS` set.
3. A **separate PostgreSQL database** for SuperTokens (default local name: `umind_supertokens`). Do **not** point Core at `umind_dev`.

## Local SuperTokens Core (Docker Compose)

This repo ships `docker-compose.yml` for Core only. It reuses the existing host Postgres on `:5432` (verified open in local dev) and creates `umind_supertokens` before Core starts.

Pinned image: `registry.supertokens.io/supertokens/supertokens-postgresql:11.4.8`  
(Must overlap CDI with `supertokens-node` — e.g. node 24.0.4 needs CDI 5.4; Core 11.0.0 is too old.)  
Core listens on `127.0.0.1:3567` (loopback only).

```bash
# 1) Derive .env.docker + SUPERTOKENS_* in .env from DATABASE_URL (secrets not printed)
npm run supertokens:env

# 2) Start Docker Desktop, then Core
npm run supertokens:up

# 3) Smoke-check
curl http://127.0.0.1:3567/hello
```

Or manually: copy `.env.docker.example` → `.env.docker`, set Postgres credentials + API key, align backend `.env`, then `docker compose --env-file .env.docker up -d`.

**Backend connection URI**

| Where the Node API runs | `SUPERTOKENS_CONNECTION_URI` |
| --- | --- |
| On the host (`npm run dev`) | `http://localhost:3567` |
| Inside the same Compose network as Core | `http://supertokens:3567` |

`SUPERTOKENS_API_KEY` in `.env` must equal `SUPERTOKENS_API_KEY` / Core `API_KEYS` in `.env.docker`.

Empty `SUPERTOKENS_CONNECTION_URI` → SDK skips init; staff sessions are rejected until Core is configured (`src/config/supertokens.ts`).

## Staff auth recipes

Configured in `src/config/supertokens.ts`:

| Method | Recipe | Notes |
| --- | --- | --- |
| Email + password | EmailPassword | Public signup disabled |
| Email OTP | Passwordless (`USER_INPUT_CODE`) | OTP logged to server console until SMTP is wired |
| Phone OTP | Passwordless (`EMAIL_OR_PHONE`) | OTP logged until SMS provider is wired |
| Google | ThirdParty | Requires `STAFF_GOOGLE_CLIENT_ID` + `STAFF_GOOGLE_CLIENT_SECRET` |
| Apple | ThirdParty | Requires Apple client id, key id, team id, private key |

`GET /api/v1/staff/auth/methods` returns which methods are enabled (no auth).

Staff access still requires a provisioned Prisma `Account` + role after SuperTokens sign-in.

## Psychologist product flow (mobile)

**Apply-first on existing `PsychologistProfile`:**

1. **Onboard me** — Google / Apple / OTP → SuperTokens session → `Account` **without** `PSYCHOLOGIST` role + `PsychologistProfile` (`hrApprovalStatus = PENDING_APPROVAL`).
2. Fills Apply → Profile → Docs on the same Profile (draft APIs need Account only).
3. **Submit for HR** → `POST /psychologist/me/application/submit-hr` (still `PENDING_APPROVAL`).
4. HR queue → `GET /admin/psychologists/hr-queue`; **approve** / **reject** only change `hrApprovalStatus` (`APPROVED` | `REJECTED`). Approve also grants `PSYCHOLOGIST` role.
5. **Sign in** — works only with `PSYCHOLOGIST` role (after HR approve). Same Google/Apple identity.

`hrApprovalStatus` is HR-only. Publication/`LIVE` remains the client bookability gate after verification.

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
