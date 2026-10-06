# NeoWell — Background Processes Specification

| | |
|---|---|
| **Version** | 2.0 |
| **Related** | [01 Requirements](01-requirements-specification.md) · [02 Schema](02-database-schema-specification.md) (`Job`, `WebhookEvent`) · [04 API](04-api-endpoint-specification.md) |

---

## 1. Architecture

NeoWell has three kinds of background work. None of them needs any infrastructure beyond PostgreSQL:

| Kind | Mechanism | Why |
|---|---|---|
| **Scheduled jobs** (J1–J11) | `@nestjs/schedule` cron decorators inside the API process. | Simple; no extra service. |
| **Queued jobs** (Q1–Q7) | A **Postgres-backed queue**, the `Job` table. Workers claim jobs with `SELECT … FOR UPDATE SKIP LOCKED`. | Survives restarts; safe with several API instances; no Redis needed. |
| **Incoming calls** (W1–W2) | HTTP webhooks: stored in `WebhookEvent` first, then processed. | Idempotent, auditable, replayable. |

```
 ┌───────────── API instance (×N) ─────────────┐
 │ HTTP controllers ──enqueue──▶ Job table ◀── Worker loop (poll 2 s, claim ≤ 5)
 │ Cron scheduler ──(J1..J11)──▶ queries + enqueue                                │
 │ Webhook controllers ──▶ WebhookEvent ──▶ handler ──▶ domain update + enqueue   │
 └────────────────────────────────────────────────┘
               │ PostgreSQL │   external: Expo Push · SMS gateway · Payment aggregator · LiveKit · Speech-to-text
```

**Multiple instances.** Cron jobs run on every instance, but each is written to be safe in parallel:
- **Conditional updates.** For example `UPDATE … WHERE status = 'REQUESTED' AND acceptDeadline < now()`. Only one instance's update succeeds, and only that instance enqueues the follow-up work.
- **Global jobs.** Weekly payouts and purges take a Postgres advisory lock (`pg_try_advisory_lock`) so only one instance runs them.
- **Switch-off.** `JOBS_ENABLED=false` disables cron and the worker on an instance, for example to keep a web-only replica.

**Queue semantics**

| Property | Value |
|---|---|
| Claiming | `status = QUEUED AND runAt <= now()`, oldest first, `FOR UPDATE SKIP LOCKED`, at most 5 per poll per instance. The claimed job becomes `RUNNING` with `lockedAt = now()`. |
| Success | `DONE`, `finishedAt = now()` |
| Failure | `attempts += 1`, `lastError` saved. Retried with backoff `runAt = now() + 2^attempts × 30 s` until `maxAttempts` (default 5), then `FAILED`. Failed jobs are listed in `GET /admin/jobs?status=FAILED`. |
| Stuck jobs | `RUNNING` with `lockedAt` older than 10 min is put back in the queue (handled in J8). |
| Idempotency | Every handler can run twice safely: it checks state before acting, e.g. "already PAID → skip". |
| Time zone | Cron expressions run in `Africa/Douala` (UTC+1). |

## 2. Scheduled jobs

| ID | Name | Schedule | What it does | Serves |
|---|---|---|---|---|
| **J1** | `rechecks.remind` | every minute | `Recheck` PENDING with `dueAt <= now()` and `notifiedAt` null → set `notifiedAt`, enqueue **Q1 notify** (RECHECK_DUE, SMS fallback). Rechecks still PENDING 2 h after `dueAt` → MISSED. | CHK-08, NOT-01, NOT-03 |
| **J2** | `consultations.expire` | every minute | (a) AWAITING_PAYMENT older than 30 min with no PENDING payment → CANCELLED (UNPAID). (b) REQUESTED past `acceptDeadline` → EXPIRED, enqueue **Q4 refund**, notify both. | CONS-03, CONS-04 |
| **J3** | `consultations.remind` | every minute | CONFIRMED with `scheduledAt` in the next 10 min and `reminderSentAt` null → set `reminderSentAt`, notify both (CONSULT_STARTING_SOON, SMS fallback). | NOT-01, NOT-03 |
| **J4** | `payments.reconcile` | every 5 min | Payments PENDING for more than 3 min → enqueue **Q5 payment status**. PENDING for more than 2 h → FAILED ("timed out"). | PAY-01 |
| **J5** | `babies.namePrompt` | daily 08:00 | Babies reaching 42 days with no `givenName` and `namePromptSentAt` null → notify the caregiver (BABY_NAME_PROMPT), set `namePromptSentAt`. | BABY-02, NOT-01 |
| **J6** | `checks.nudge` | every hour, 08:00–20:00 | Babies AT_HOME under 28 days whose last check is over 24 h old and who were not nudged in the last 24 h → notify (CHECK_NUDGE, push only). | NOT-05 |
| **J7** | `payouts.weekly` | Mondays 06:00 (advisory lock) | For each clinician: COMPLETED + PAID consultations with no `payoutId` → one `Payout` (PENDING) for the previous week; link the consultations; notify the clinician. | CONS-14, ADM-03 |
| **J8** | `maintenance.cleanup` | daily 03:00 | Delete OTP codes older than 24 h; refresh tokens 30 days past expiry/revocation; DONE jobs older than 14 days; FAILED jobs older than 90 days; webhook events older than 90 days. Re-queue stuck RUNNING jobs. | §7 of doc 02 |
| **J9** | `accounts.purge` | daily 03:30 (advisory lock) | Users with `deletionRequestedAt` 30+ days ago: delete babies (cascades to measurements, checks, voice notes), devices and notifications. Anonymise the user (`phone = deleted:<id>`, names removed). Consultations and messages are kept. Stored files are deleted via **Q7**. | ACC-04 |
| **J10** | `push.receipts` | every 15 min | Fetch Expo push receipts for tickets from the last hour. Delete `Device` rows whose token returned `DeviceNotRegistered`. | ACC-05 |
| **J11** | `clinicians.availableNowExpiry` | — (no job) | `availableNowUntil` is a timestamp compared at read time, so no job is needed. | CLIN-04 |

## 3. Queued jobs

| ID | Queue name | Enqueued by | Payload | What it does | Retries | Serves |
|---|---|---|---|---|---|---|
| **Q1** | `notify` | Domain events (below), J1, J3, J5, J6, J7 | `{ userId, type, title, body, data?, sms?: boolean }` | Creates the `Notification` (inbox), then enqueues Q2 for each device. If `sms` is set and the user has no device, enqueues Q3. Text is chosen in the user's locale. | 5 | NOT-01, NOT-04 |
| **Q2** | `push.send` | Q1 | `{ notificationId, token }` | POST to Expo Push API `https://exp.host/--/api/v2/push/send`. Stores the ticket id for J10. Sets `Notification.pushedAt`. | 5 | NOT-01 |
| **Q3** | `sms.send` | Q1, OTP request | `{ phone, message, notificationId? }` | Sends through the SMS gateway (console driver in development). Sets `Notification.smsAt`. | 5 | AUTH-01, NOT-03 |
| **Q4** | `payment.refund` | decline, J2 expiry, cancellation | `{ consultationId }` | Creates a REFUND `Payment` and calls the provider's disbursement API. On success: `paymentStatus = REFUNDED`, notify the caregiver. Sandbox refunds succeed immediately. | 8 | PAY-02, CONS-04, CONS-10 |
| **Q5** | `payment.status` | J4, `POST …/payments` (sandbox) | `{ paymentId }` | Asks the provider for the payment status and applies it exactly like a webhook (§5). The sandbox provider confirms after ~3 s: success unless the payer phone ends in `000`. | 5 | PAY-01, PAY-04 |
| **Q6** | `voice.transcribe` | `POST /babies/:id/voice-notes` | `{ voiceNoteId }` | If `STT_URL` is set: POST the audio to the self-hosted OpenAI-compatible endpoint `{STT_URL}/v1/audio/transcriptions` (faster-whisper / Speaches), store transcript + language, detect complaint keywords (EN/FR) → TRANSCRIBED. If not set: SKIPPED. | 3 | VOICE-01..03 |
| **Q7** | `storage.delete` | J9, removals | `{ keys[] }` | Deletes stored files. | 5 | ACC-04 |

### Domain events that enqueue notifications (Q1)

| Event | To | Type | SMS fallback |
|---|---|---|---|
| Payment succeeded → REQUESTED | Clinician | CONSULT_REQUESTED | yes |
| Payment failed | Caregiver | PAYMENT_FAILED | — |
| Accepted | Caregiver | CONSULT_CONFIRMED | yes |
| Declined / Expired / Cancelled (by other party) | The other party | CONSULT_DECLINED / CONSULT_EXPIRED / CONSULT_CANCELLED | — |
| Starting in ≤ 10 min (J3) | Both | CONSULT_STARTING_SOON | yes |
| New chat message | The other participant | NEW_MESSAGE (at most one per consultation every 2 min) | — |
| Referral created | Caregiver | REFERRAL_CREATED | yes |
| Drug chart created | Caregiver | DRUG_CHART_CREATED | — |
| Refund completed | Caregiver | REFUND_COMPLETED | — |
| Recheck due (J1) | Caregiver | RECHECK_DUE | yes |
| Clinician verified / rejected | Clinician | CLINICIAN_VERIFIED / CLINICIAN_REJECTED | — |
| Payout created (J7) | Clinician | PAYOUT_CREATED | — |

## 4. On-device scheduled work (mobile)

These run as **local notifications** on the phone, so they work offline (FR-NOT-02):

| Name | Trigger | Content |
|---|---|---|
| Check reminders | Daily at each `reminderTimes` value from `GET /babies/:id/check-schedule`. Rescheduled when babies or schedules change, and on app start. Not scheduled while the baby is in hospital/KMC. | "Time for {displayName}'s check" |
| Recheck alarm | At `recheck.dueAt`, scheduled right after the result screen. | "Re-check {displayName}'s temperature now" |
| Dose alarms | Every `timesOfDay` for `durationDays` from `startDate` (at most 64 pending; the next 7 days are refreshed on app start). | "{drug} {dose} ({route}) for {displayName}" |
| Offline check queue | When the network returns, or the app foregrounds: re-send queued checks with their `clientRef`. | — |

## 5. Incoming calls (webhooks)

### W1 — Payment provider: `POST /webhooks/payments/:provider`

| Step | Detail |
|---|---|
| 1. Verify | Header `x-neowell-signature` must equal `hex(HMAC-SHA256(PAYMENTS_WEBHOOK_SECRET, rawBody))` (for aggregators with a different scheme, the provider adapter verifies its own signature). |
| 2. Store | Insert a `WebhookEvent { source: "payments:<provider>", externalId: event.reference, signatureValid, payload }`. A duplicate `(source, externalId)` → return `200` without reprocessing. |
| 3. Apply | Only when the signature is valid. Find the `Payment` by `externalRef` and apply the status transition in one transaction: PENDING → PAID (COLLECTION) moves the consultation AWAITING_PAYMENT → REQUESTED, sets `acceptDeadline`, snapshots the 7-day summary and posts the REPORT message; PENDING → FAILED marks it FAILED. A REFUND event → REFUNDED. Already-final payments are ignored. |
| 4. React | Enqueue notifications (§3). Set `WebhookEvent.processedAt` (or `error`). |
| Payload (normalised) | `{ reference, status: SUCCESSFUL\|FAILED, amount, currency: "XAF", operator, reason? }`. Each provider adapter maps its format to this. |

### W2 — LiveKit: `POST /webhooks/livekit`

| Step | Detail |
|---|---|
| 1. Verify | `WebhookReceiver.receive(rawBody, authorizationHeader)` from `livekit-server-sdk` using `LIVEKIT_API_KEY/SECRET`. |
| 2. Store | `WebhookEvent { source: "livekit", externalId: event.id }` (idempotent). |
| 3. Apply | `participant_joined` by the clinician while CONFIRMED → IN_PROGRESS (`startedAt`). `room_finished` → set `endedAt` (the clinician still completes the consultation explicitly). |

### Outgoing calls (for reference)

| Service | Call | When |
|---|---|---|
| Expo Push API | `POST /--/api/v2/push/send`, `POST /--/api/v2/push/getReceipts` | Q2, J10 |
| SMS gateway | provider REST API | Q3 |
| Payment aggregator (MTN MoMo / Orange Money) | collect, status, disburse | `POST …/payments`, Q4, Q5 |
| LiveKit | access token (signed locally, no network call) | `POST /consultations/:id/call` |
| Speech-to-text (self-hosted) | `POST {STT_URL}/v1/audio/transcriptions` | Q6 |

## 6. Configuration

| Variable | Default | Purpose |
|---|---|---|
| `JOBS_ENABLED` | `true` | Run cron + worker on this instance |
| `JOBS_POLL_MS` | `2000` | Worker poll interval |
| `PAYMENT_PROVIDER` | `SANDBOX` | Default provider adapter |
| `PAYMENTS_WEBHOOK_SECRET` | — | HMAC secret for W1 |
| `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` | — | Calls (FR-CONS-09); calls are disabled when unset |
| `STT_URL`, `STT_MODEL` | —, `Systran/faster-whisper-small` | Self-hosted speech-to-text (Q6) |
| `EXPO_ACCESS_TOKEN` | — | Optional Expo push security token |
| `PUBLIC_BASE_URL` | `http://localhost:3000` | Builds `/files/…` and `/calls/…` links |

## 7. Monitoring

- `GET /health` checks database connectivity.
- `GET /admin/jobs?status=FAILED` lists failed jobs with `lastError`.
- Job handler errors and webhook processing errors are logged with the job/event id.
- Alert when, for 15 minutes: more than 20 FAILED jobs, J1 runs fall behind (rechecks overdue > 5 min), or webhook signature failures exceed 5.
