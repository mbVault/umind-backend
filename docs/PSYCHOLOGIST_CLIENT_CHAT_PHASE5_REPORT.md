# U Mind — Psychologist–Client Chat: Phase 5 Implementation Report

**Date:** 2026-10-28  
**Scope:** Backend chat MVP (Phases 1–4)  
**Status:** Complete

---

## 1. Summary

Persistent, real-time text chat between an anonymous client and their assigned psychologist is implemented on the existing U Mind backend.

- Conversation boundary: one `PsychologistSession` → independent message history  
- Storage: PostgreSQL via Prisma (`PsychologistChatMessage`)  
- Delivery: Socket.IO (persist-then-broadcast)  
- History: HTTP GET on client and staff route trees  
- Identities: existing JWT `User` + SuperTokens `Account` → `PsychologistProfile`  
- Saathi AI and LiveKit remain untouched  

---

## 2. Files created and modified

### Created

| Path | Role |
| ---- | ---- |
| `prisma/migrations/20261028180000_psychologist_chat_messages/migration.sql` | Table, FKs, unique, index, sender `CHECK` |
| `src/modules/sessions/chatService.ts` | Authz, history, send, read, content rules |
| `src/validators/chat.ts` | History query Zod schema |
| `src/socket/index.ts` | Socket exports |
| `src/socket/socketAuth.ts` | Dual-audience handshake auth |
| `src/socket/chatSocket.ts` | Rooms + `session:join` / `message:*` |
| `tests/chat.session.test.ts` | HTTP + Socket integration tests |
| `docs/PSYCHOLOGIST_CLIENT_CHAT_PHASES.md` | Phase plan & decisions |
| `docs/PSYCHOLOGIST_CLIENT_CHAT_PHASE5_REPORT.md` | This report |

### Modified

| Path | Change |
| ---- | ------ |
| `prisma/schema.prisma` | `PsychologistChatMessage` + reverse relations on `User`, `PsychologistProfile`, `PsychologistSession` |
| `src/server.ts` | `http.createServer(app)` + `attachChatSocket` |
| `src/routes/sessions.ts` | `GET /:sessionId/messages` |
| `src/routes/staff/psychologist.ts` | `GET /me/sessions/:sessionId/messages` |
| `tests/helpers.ts` | Reset deletes `psychologistChatMessage` |
| `tests/staff.helpers.ts` | Same reset ordering |
| `package.json` / lockfile | `socket.io`, `socket.io-client` (dev) |

**Not modified:** Saathi modules, LiveKit (none existed), recording consent routes, booking/payment lifecycle.

---

## 3. Final Prisma model

```prisma
model PsychologistChatMessage {
  id                          String          @id @default(uuid()) @db.Uuid
  sessionId                   String          @db.Uuid
  senderRole                  ParticipantRole
  senderUserId                String?         @db.Uuid
  senderPsychologistProfileId String?         @db.Uuid
  content                     String          @db.Text
  clientMessageId             String          @db.VarChar(64)
  createdAt                   DateTime        @default(now()) @db.Timestamptz(6)
  readAt                      DateTime?       @db.Timestamptz(6)

  @@unique([sessionId, senderRole, clientMessageId])
  @@index([sessionId, createdAt, id])
}
```

**SQL extras (migration):**

- FKs → `PsychologistSession`, `User`, `PsychologistProfile` with `ON DELETE RESTRICT`
- `CHECK` `PsychologistChatMessage_sender_identity_check`: exactly one sender FK matching `senderRole`

**Applied:** Migration `20261028180000_psychologist_chat_messages` on local `umind_dev`.  
**Verified 2026-10-28:** `prisma migrate status` → Database schema is up to date (14 migrations).

---

## 4. HTTP contracts

Envelope unchanged: `{ status: "success", data }` / `{ status: "fail", message, details? }`.

### Client

`GET /api/sessions/:sessionId/messages?limit=&cursor=`  
Auth: `Authorization: Bearer <customer JWT>`

### Psychologist

`GET /api/v1/staff/psychologist/me/sessions/:sessionId/messages?limit=&cursor=`  
Auth: SuperTokens staff session (test: `X-Test-SuperTokens-User-Id`) + `PSYCHOLOGIST` role

### Query

| Param | Rules |
| ----- | ----- |
| `limit` | 1–100, default 50 |
| `cursor` | Optional opaque `nextCursor` from prior page |

### Response `data`

```ts
{
  items: ChatMessageDto[];  // chronological ascending
  nextCursor: string | null;
  hasMore: boolean;
}
```

### `ChatMessageDto`

```ts
{
  id: string;
  sessionId: string;
  senderRole: "CUSTOMER" | "PSYCHOLOGIST";
  senderUserId: string | null;
  senderPsychologistProfileId: string | null;
  content: string;
  clientMessageId: string;
  createdAt: string;       // ISO
  readAt: string | null;   // ISO
}
```

**Pagination:** No cursor → latest page; with cursor → older messages before that point. Unauthorized → `404 Session not found`.

---

## 5. Socket.IO contracts

**Path:** `/socket.io` on the same HTTP server as Express.

### Handshake `auth`

| Audience | Auth object |
| -------- | ----------- |
| Customer | `{ type: "customer", accessToken: "<jwt>" }` (or Bearer header) |
| Staff (test) | `{ type: "staff", testSuperTokensUserId: "<id>" }` when `STAFF_AUTH_TEST_BYPASS` |
| Staff (live) | `{ type: "staff", accessToken: "<st-access-token>" }` |

### Events

Ack shape: `{ ok: true, data } | { ok: false, code: number, message: string }`

| Event | Direction | Payload / data |
| ----- | --------- | -------------- |
| `session:join` | client → server | `{ sessionId }` → `{ sessionId, room }` |
| `message:send` | client → server | `{ sessionId, clientMessageId, content }` → `{ message }` |
| `message:new` | server → room | `ChatMessageDto` (after DB persist) |
| `message:read` | client → server | `{ sessionId, messageId }` → `{ message }` |
| `message:read` | server → room | updated `ChatMessageDto` with `readAt` |

**Room:** `psych-session:{sessionId}`  
**Send rules:** `booking.communicationMode === CHAT` and `session.status === IN_PROGRESS`  
**Content:** plain text, trim, no null bytes, max 4000 chars  
**Idempotency:** unique `(sessionId, senderRole, clientMessageId)`  
**Read:** recipient only; set once; retries idempotent  

---

## 6. Authorization and isolation

| Check | Implementation |
| ----- | -------------- |
| Customer ownership | `session.booking.userId === auth.userId` |
| Psychologist ownership | `Account` → `PsychologistProfile`; `session.booking.psychologistProfileId === profile.id` |
| Sender identity | Derived server-side from principal; never from payload |
| Cross-session | Messages queried only by authorized `sessionId` |
| Strangers | `404 Session not found` (no leak) |
| Room join | Re-checks participant access before `socket.join` |
| Send/read | Re-checks participant access in service layer |

---

## 7. Product decisions enforced

| Decision | Where |
| -------- | ----- |
| Session-scoped history | FK `sessionId` only; no thread table |
| CHAT-only send (MVP) | `assertChatSendAllowed` |
| Send only while `IN_PROGRESS` | same |
| History readable after complete | GET history has no status gate |
| Participant FK = profile (not Account) | schema + send path |
| VOICE/VIDEO side-chat | Out of scope; no schema block for later |

---

## 8. Verification (actually run)

| Check | Command | Result (2026-10-28) |
| ----- | ------- | ------------------- |
| Chat tests | `npx vitest run tests/chat.session.test.ts` | **9 passed** |
| Typecheck | `npx tsc --noEmit` | **Pass** (exit 0) |
| Migrations | `npx prisma migrate status` | **Up to date** on `localhost/umind_dev` |

### Test coverage in `tests/chat.session.test.ts`

- Authorized client + psych HTTP history; other client / other psych denied  
- Two bookings same pair → isolated histories  
- Cursor pagination stable  
- Socket send → peer `message:new` with same id; history persists  
- Idempotent retry (no duplicate row)  
- Reject send if not `IN_PROGRESS` or not `CHAT`  
- Unassigned psych cannot join/send  
- Recipient read OK; sender cannot forge; read retry idempotent  
- Unauthenticated socket connect rejected  

**Not separately automated:** explicit “DB failure must not broadcast” fault injection (persist-then-broadcast ordering guarantees no emit before successful `sendChatMessage`; failure path returns ack error only).

---

## 9. Deviations and open issues

| Item | Notes |
| ---- | ----- |
| Unique index name | Prisma truncated to `…clientMessageI_key` — expected |
| Live SuperTokens on sockets | Implemented via `getSessionWithoutRequestResponse`; **not** exercised in CI (tests use bypass) |
| Mobile UI | Not in this MVP; clients must still wire Socket.IO + history GET |
| `upToMessageId` batch read | Deferred; single-message `message:read` only |
| Full suite regression | Only chat suite re-run for this report; run `npm test` before release if desired |
| Content logging | Message bodies are not logged; unexpected socket errors log name only |

---

## 10. How to run locally

```bash
# Ensure migrations applied
npx prisma migrate deploy

# API + Socket.IO
npm run dev

# Chat tests
npx vitest run tests/chat.session.test.ts
```

Customer socket example auth: `{ type: "customer", accessToken }`.  
Staff (dev/test bypass): `{ type: "staff", testSuperTokensUserId }`.

---

## 11. Recommended next workstreams (out of this report)

1. Mobile session-room Chat UI (client Experts path + psychologist Today Join for CHAT mode)  
2. LiveKit VOICE/VIDEO (separate from text chat)  
3. Optional: fault-injection test for broadcast-on-DB-failure  
4. Optional: batch `upToMessageId` reads  

---

*End of Phase 5 report.*
