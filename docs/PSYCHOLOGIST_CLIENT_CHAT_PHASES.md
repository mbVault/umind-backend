# U Mind — Psychologist–Client Chat: Phases & Decisions

Context document for implementing persistent, real-time text chat between an anonymous client and their assigned psychologist.

**Last updated:** 2026-10-28  
**Status:** Phases 1–5 complete. See `docs/PSYCHOLOGIST_CLIENT_CHAT_PHASE5_REPORT.md`.

---

## Product objective

- Persistent text chat scoped strictly to one `PsychologistSession`.
- Independent history per session (even when the same client rebooks the same psychologist).
- PostgreSQL + Prisma = source of truth.
- Socket.IO = real-time delivery only (not storage).
- Reuse existing client JWT and staff SuperTokens → `Account` → `PsychologistProfile`.
- Keep **Saathi AI** and **LiveKit** (voice/video) separate.
- Mode name stays **Chat** (not Saathi).

---

## Confirmed product decisions

| Decision | Rule |
| -------- | ---- |
| Conversation boundary | `PsychologistSession` owns history; no thread/conversation table |
| Send window | Send only when `SessionStatus === IN_PROGRESS` |
| Mode gate (MVP) | Send only when `PsychologistBooking.communicationMode === CHAT` |
| Side-chat on VOICE/VIDEO | Out of scope for MVP; schema stays extensible (no mode column on messages) |
| Client sender | `User` via `senderUserId` |
| Psychologist sender | `PsychologistProfile` via `senderPsychologistProfileId` (not `Account`) |
| Staff auth path | SuperTokens → `Account` → resolve `PsychologistProfile` in service layer |
| Content | Plain UTF-8 text; no HTML/attachments; reject empty/whitespace; max **4000** chars after normalize; handle null bytes; store as PostgreSQL `TEXT` |
| Idempotency | Required `clientMessageId` (UUID or opaque, ≤ 64 chars); unique `(sessionId, senderRole, clientMessageId)` |
| Read receipts | Nullable `readAt`; recipient only; server timestamp; set once; retries idempotent; never clear/move; batch `upToMessageId` optional later |
| History after complete | Readable after completion; sending disabled (service rule) |

Enforce CHAT / `IN_PROGRESS` / content / read rules in the **service layer**, not with static DB constraints (except sender identity `CHECK` and idempotency unique).

---

## Phase overview

| Phase | Name | Status |
| ----- | ---- | ------ |
| **1** | Database schema & migration | **Done** |
| **2** | HTTP history APIs | **Done** |
| **3** | Socket.IO real-time | **Done** |
| **4** | Tests | **Done** (`tests/chat.session.test.ts`) |
| **5** | Implementation report | **Done** — `docs/PSYCHOLOGIST_CLIENT_CHAT_PHASE5_REPORT.md` |

There is no Phase 6/7 in this plan. Mobile Chat UI and LiveKit voice/video are separate workstreams if added later.

---

## Phase 1 — Database (done)

**Goal:** Persist messages without APIs or realtime.

**In scope:**

- Model `PsychologistChatMessage`
- Prisma reverse relations on `User`, `PsychologistProfile`, `PsychologistSession` only (no ALTER of existing business columns)
- FKs with `onDelete: Restrict`
- Reuse `ParticipantRole` (`CUSTOMER` | `PSYCHOLOGIST`)
- Unique `(sessionId, senderRole, clientMessageId)`
- Index `(sessionId, createdAt, id)`
- SQL `CHECK` for exactly-one sender matching `senderRole`

**Out of scope:** Services, HTTP, Socket.IO, mobile, LiveKit, Saathi, booking lifecycle changes.

**Artifacts:**

- `prisma/schema.prisma` — `PsychologistChatMessage`
- `prisma/migrations/20261028180000_psychologist_chat_messages/migration.sql`

**Sender identity (DB):**

- `CUSTOMER` → `senderUserId` set, `senderPsychologistProfileId` null  
- `PSYCHOLOGIST` → `senderPsychologistProfileId` set, `senderUserId` null  

---

## Phase 2 — HTTP APIs (done)

**Goal:** Authorized, paginated message history for both audiences.

**Routes:**

- Client: `GET /api/sessions/:sessionId/messages?cursor=&limit=`
- Psychologist: `GET /api/v1/staff/psychologist/me/sessions/:sessionId/messages?cursor=&limit=`

**Query:** `limit` (1–100, default 50), optional `cursor` (opaque `nextCursor` from prior page).

**Response `data`:** `{ items: ChatMessageDto[], nextCursor: string | null, hasMore: boolean }`  
Messages returned in chronological ascending order. Without cursor = latest page; with cursor = older page before that point.

**Artifacts:**

- `src/modules/sessions/chatService.ts` — authz + history (+ helpers for Phase 3 send rules)
- `src/validators/chat.ts`
- `src/routes/sessions.ts` — client history route
- `src/routes/staff/psychologist.ts` — psych history route

**Still out of scope here:** Socket.IO, send-over-socket, LiveKit, mobile UI.

---

## Phase 3 — Socket.IO (done)

**Goal:** Real-time send/receive/read with persist-then-broadcast.

**Integration:** `src/server.ts` uses `http.createServer(app)` + `attachChatSocket(server)`.

**Artifacts:**

- `src/socket/chatSocket.ts`, `src/socket/socketAuth.ts`, `src/socket/index.ts`
- `src/modules/sessions/chatService.ts` — `sendChatMessage`, `markChatMessageRead`
- Dependencies: `socket.io` (runtime), `socket.io-client` (dev/tests)

**Handshake `auth`:**

- Customer: `{ type: "customer", accessToken: "<jwt>" }` (or `Authorization: Bearer`)
- Staff (tests): `{ type: "staff", testSuperTokensUserId: "<id>" }` when `STAFF_AUTH_TEST_BYPASS`
- Staff (live): `{ type: "staff", accessToken: "<st-access-token>" }` via `Session.getSessionWithoutRequestResponse`

**Events (ack shape `{ ok: true, data } | { ok: false, code, message }`):**

| Event | Purpose |
| ----- | ------- |
| `session:join` | Authorize + join `psych-session:{sessionId}` |
| `message:send` | Persist then emit `message:new` to room |
| `message:new` | Canonical persisted DTO |
| `message:read` | Recipient sets `readAt`; re-emits `message:read` |

**Service rules on send:** `communicationMode === CHAT` and `status === IN_PROGRESS`.

---

## Phase 4 — Tests (done)

**File:** `tests/chat.session.test.ts`  
**Command:** `npx vitest run tests/chat.session.test.ts`  
**Result (2026-10-28):** **9 passed**.

Covered: HTTP authz + isolation + pagination; socket send/receive; idempotent retry; CHAT/`IN_PROGRESS` gates; unassigned psych denied; read-receipt forge blocked; unauthenticated connect rejected. Missed-message recovery is via HTTP history after reconnect (same as product design).

---

## Phase 5 — Implementation report (done)

Formal report: **[`PSYCHOLOGIST_CLIENT_CHAT_PHASE5_REPORT.md`](./PSYCHOLOGIST_CLIENT_CHAT_PHASE5_REPORT.md)**  
Includes files, Prisma/migration details, HTTP + Socket contracts, authz, verified test/typecheck/migrate results, deviations, and next workstreams.

---

## Explicitly out of scope (entire chat MVP unless re-approved)

- LiveKit project/media/recording setup  
- Voice/video calling  
- Saathi AI changes  
- New auth systems  
- Conversation/thread model  
- Attachments, edit/delete, reactions, typing, presence  
- Group chat  
- Push-notification redesign  
- Admin silent chat browsing  
- Side-chat during VOICE/VIDEO  

---

## Related existing routes (do not redesign in chat phases)

**Client** `/api/sessions/:sessionId` — get, attendance, recording-consent, complete, no-show, fault-remedy, complaints  

**Staff** `/api/v1/staff/psychologist/me/sessions/:sessionId` — get, join, leave, notes, complete, after-session  

Chat **extends** these with `/messages` + Socket.IO; it does not replace them.

---

## Suggested next step

Backend chat MVP is complete (Phases 1–5). Next: **mobile Chat UI**, then **LiveKit** for VOICE/VIDEO.
