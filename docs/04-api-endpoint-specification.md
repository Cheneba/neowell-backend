# NeoWell — API Endpoint Specification

| | |
|---|---|
| **Version** | 2.0 |
| **Base URL** | `https://<host>`; local: `http://localhost:3000` |
| **Live reference** | Swagger UI at `/docs` (non-production), generated from the code |
| **Related** | [01 Requirements](01-requirements-specification.md) · [02 Schema](02-database-schema-specification.md) · [05 Background processes](05-background-processes-specification.md) |

---

## 1. Conventions

| Topic | Convention |
|---|---|
| **Auth** | `Authorization: Bearer <accessToken>` on every route except those marked **Public**. Tokens come from `POST /auth/otp/verify` and `POST /auth/refresh`. |
| **Roles** | **C** = Caregiver, **D** = Clinician (doctor), **A** = Admin, **Any** = any signed-in user. Ownership is always checked as well: a caregiver only reaches their own babies; a clinician only reaches babies and consultations they are part of. |
| **Format** | JSON request and response bodies; UTF-8; dates in ISO 8601 UTC. Uploads use `multipart/form-data` with field `file`. |
| **Validation** | Unknown body fields → `400`. Errors look like `{ "statusCode": 400, "message": "…" \| ["…"], "code"?: "CONSENT_REQUIRED" \| "PROFILE_INCOMPLETE" \| … }`. |
| **Status codes** | `200` OK · `201` created · `202` accepted (async) · `204` no content · `400` invalid · `401` not signed in · `403` role/consent/ownership · `404` not found or not yours · `409` conflict (slot taken, duplicate, wrong state) · `429` rate limited. |
| **Pagination** | Lists take `limit` (default 20–50, max 100) and a cursor (`before` = ISO date or `cursor` = id). The response is an array, or `{ items, nextCursor }` where noted. |
| **Rate limits** | 120 requests/min per IP; `/auth/*` 10 requests/min. OTP also has per-phone limits (FR-AUTH-01). |
| **Files** | Never served directly. Responses contain `…Url` fields: signed `/files/:token` links that expire in 10 minutes. |
| **Money** | Integer XAF. |
| **Codes** | Enum values (findings, actions, statuses) are stable codes the client translates. |
| **Audit** | Every successful write is audited (FR-AUD-01). Clinician reads of a consultation are audited (FR-AUD-02). |

## 2. Endpoints by module

### 2.1 Auth — FR-AUTH

| Method & path | Who | Request | Response | Serves |
|---|---|---|---|---|
| `POST /auth/otp/request` | Public | `{ phone }` (E.164) | `202 { expiresInSeconds }`. `429` on cooldown/limit. | AUTH-01 |
| `POST /auth/otp/verify` | Public | `{ phone, code, role? }` where role ∈ CAREGIVER/CLINICIAN (new users only) | `{ accessToken, refreshToken, isNewUser }` | AUTH-01, AUTH-03 |
| `POST /auth/refresh` | Public | `{ refreshToken }` | New token pair (rotation; reuse revokes all) | AUTH-02 |
| `POST /auth/logout` | Public | `{ refreshToken }` | `204` | AUTH-04 |

### 2.2 Me (account) — FR-ACC

| Method & path | Who | Request | Response | Serves |
|---|---|---|---|---|
| `GET /me` | Any | — | Profile: `id, phone, email, firstName, lastName, role, locale, region, city, consent*At, profileComplete, deletionRequestedAt` | ACC-01, ACC-07 |
| `PATCH /me` | Any | `{ firstName?, lastName?, email?, locale?, region?, city? }` | Profile | ACC-01, ACC-07 |
| `PUT /me/consents` | Any | `{ dataCollection?, clinicianShare?, recording? }` (true = grant, false = withdraw) | Profile | ACC-02 |
| `GET /me/export` | C | — | `{ exportedAt, profile, babies[{…, measurements, observations, consultations}] }` | ACC-03 |
| `DELETE /me` | C, D | — | `202 { purgeAfter }`. Access ends now; purge by job J9. | ACC-04 |
| `POST /me/devices` | Any | `{ expoPushToken, platform }` | `201 { id }` (upsert by token) | ACC-05 |
| `DELETE /me/devices/:token` | Any | — | `204` | ACC-05 |
| `GET /me/notifications` | Any | `?limit&cursor` | `{ items[{id,type,title,body,data,readAt,createdAt}], nextCursor, unreadCount }` | ACC-06, NOT-04 |
| `POST /me/notifications/read` | Any | `{ ids?: string[], all?: boolean }` | `204` | ACC-06 |

### 2.3 Babies — FR-BABY

The baby object returned everywhere:
`{ id, givenName, displayName, sex, dateOfBirth, ageDays, correctedAgeDays|null, gestationalAgeWeeks, termStatus, birthWeightGrams, birthWeightCategory, birthLengthCm, birthHeadCircumferenceCm, birthFacility{id,name}|null, birthFacilityName, careStatus, dischargeDate, riskFactors[{code}], isHighRisk, needsName }`

| Method & path | Who | Request | Response | Serves |
|---|---|---|---|---|
| `POST /babies` | C | `{ sex, dateOfBirth, gestationalAgeWeeks, birthWeightGrams, birthLengthCm, birthHeadCircumferenceCm, givenName?, birthFacilityId?, birthFacilityName?, careStatus?, dischargeDate? }`. `403 PROFILE_INCOMPLETE` if the caregiver has no first/last name. | `201` Baby (birth Measurement created too) | BABY-01..04, MEAS-02 |
| `GET /babies` | C | — | Baby[] | BABY-08 |
| `GET /babies/:id` | C | — | Baby | BABY-02 |
| `PATCH /babies/:id` | C | Any create field, e.g. `{ givenName }`, `{ careStatus: "AT_HOME", dischargeDate }` | Baby | BABY-05, BABY-07 |
| `DELETE /babies/:id` | C | — | `204` (soft delete) | BABY-07 |
| `GET /babies/:id/check-schedule` | C | — | `{ checksPerDay, reminderTimes[], checksLast24h, checksDue, paused, pausedReason?, pendingRecheck? }` | CHK-01, BABY-05 |

### 2.4 Measurements & growth — FR-MEAS

| Method & path | Who | Request | Response | Serves |
|---|---|---|---|---|
| `POST /babies/:id/measurements` | C | `{ measuredAt, weightGrams?, lengthCm?, headCircumferenceCm?, source, notes? }` (at least one value) | `201 { measurement, growth }` | MEAS-01 |
| `GET /babies/:id/measurements` | C | `?limit` | Measurement[] (newest first) | MEAS-03 |
| `GET /babies/:id/growth` | C | — | `{ latest: { weight, length, headCircumference }`, each `{ value, measuredAt, ageDays, zScore, flag: NORMAL\|OUT_OF_RANGE\|FAR_OUT_OF_RANGE\|null }`, `flags[{code, level}]`, `usesCorrectedAge }` | MEAS-04, MEAS-05 |

### 2.5 Checks & triage — FR-CHK

| Method & path | Who | Request | Response | Serves |
|---|---|---|---|---|
| `GET /babies/:id/check-plan` | C | `?type=ROUTINE\|UNWELL&complaints=FEVER,VOMITING&lang=en\|fr` | `{ type, complaints, questions[] }` — each question: `{ id, field, kind: TEMPERATURE\|COUNTER\|SINGLE\|BOOLEAN\|BREATH_COUNTER, required, label, help?, options?[{value,label,danger}], showIf?{field, gte?, lt?, in?}, min?, max? }` | CHK-02..05, CHK-09 |
| `POST /babies/:id/observations` | C | `{ checkType, temperatureC, complaints?, complaintText?, clientRef?, recheckOfId?, voiceNoteId?, observedAt?, feedingCount24h?, feedingQuality?, stoolPattern?, skinColor?, cry?, activity?, breathing?, respiratoryRate?, chestIndrawing?, breathingSound?, jaundice?, cordStatus?, vomiting?, roomFeel?, clothing?, convulsions?, notes? }`. `403 CONSENT_REQUIRED` without data-collection consent. | `201` (or `200` for a repeated `clientRef`): `{ observation, assessment: { level, findings[], actions[], engineVersion, emergencyNumbers[] }, recheck: { id, dueAt }\|null }` | CHK-03..11 |
| `GET /babies/:id/observations` | C | `?limit&before` | Observation[] with `findings`, `actions`, `photoUrl` | CHK-13 |
| `GET /babies/:id/observations/:observationId` | C | — | Observation | CHK-13 |
| `POST /babies/:id/observations/:observationId/photo` | C | multipart `file` (JPEG/PNG ≤ 5 MB) | `{ photoUrl }` | CHK-12 |
| `GET /babies/:id/rechecks` | C | `?status=PENDING` | Recheck[] `{ id, reason, dueAt, status }` | CHK-08 |

### 2.6 Voice — FR-VOICE

| Method & path | Who | Request | Response | Serves |
|---|---|---|---|---|
| `POST /babies/:id/voice-notes` | C | multipart `file` (audio/m4a, aac, mpeg, webm, ogg, wav; ≤ 2 MB / ~60 s) | `201 { id, status }`. Transcription is queued (job `voice.transcribe`). | VOICE-01 |
| `GET /voice-notes/:id` | C (owner), D (consultation participant) | — | `{ id, status, transcript, language, detectedComplaints[], audioUrl }` | VOICE-02 |

### 2.7 Reports — FR-RPT

| Method & path | Who | Request | Response | Serves |
|---|---|---|---|---|
| `GET /babies/:id/summary` | C | `?days=3\|7` | Summary JSON: `generatedAt, period, baby, measurements{latest, growth}, totals, latestRiskLevel, temperature, findingCounts, observations[]` | RPT-01 |
| `GET /babies/:id/summary.pdf` | C | `?days=3\|7&lang=en\|fr` | `application/pdf` | RPT-02 |

### 2.8 Facilities — FR-FAC

| Method & path | Who | Request | Response | Serves |
|---|---|---|---|---|
| `GET /facilities/nearby` | Any | `?lat&lon&radiusKm=50&service?` | Facility[] with `distanceKm` and `departments`, nearest first (max 20) | FAC-01 |
| `GET /facilities` | Any | `?q&limit` | Facility[] (name search; birth facility picker) | FAC-02 |
| `GET /facilities/:id` | Any | — | Facility | FAC-01 |
| `POST /facilities` | A | `{ name, latitude, longitude, services[], region?, city?, address?, mainPhone?, hours?, departments?[{service,name,phone}] }` | `201` Facility | FAC-03 |
| `PATCH /facilities/:id` | A | Any create field + `isActive` | Facility | FAC-03 |

### 2.9 Clinicians — FR-CLIN

The public clinician object (never contains phone or email):
`{ id, displayName, title, specialties, bio, currentFacility, yearsExperience, photoUrl, verified: true, ratingAvg, ratingCount, media: { CHAT?: fee, AUDIO?: fee, VIDEO?: fee }, availableNow }`

| Method & path | Who | Request | Response | Serves |
|---|---|---|---|---|
| `GET /clinicians` | Any | `?medium&availableNow=true` | Public clinician[] (verified only) | CLIN-05 |
| `GET /clinicians/:id` | Any | — | Public clinician + `availability[]` | CLIN-05 |
| `GET /clinicians/:id/slots` | C | `?days=7` (max 14) | `{ slots: ISO[] }`: free 30-min starts within availability, excluding booked slots | CONS-01 |
| `POST /clinicians/me` | D | `{ firstName, lastName, title?, licenseNumber, specialties[], bio?, currentFacility?, yearsExperience?, offersChat?, offersAudio?, offersVideo?, feeChatXaf, feeAudioXaf, feeVideoXaf, payoutProvider?, payoutPhone? }` | `201` own profile | CLIN-01, CLIN-07 |
| `GET /clinicians/me` | D | — | Own profile + `documents[]`, `missingDocuments[]`, `missingForReview[]`, `photoUrl` | CLIN-01..02 |
| `PATCH /clinicians/me` | D | Same fields as create, all optional | Own profile | CLIN-01, CLIN-07 |
| `POST /clinicians/me/photo` | D | multipart image | `{ photoUrl }` | CLIN-01 |
| `POST /clinicians/me/documents` | D | multipart `type` + `file` (PDF/JPEG/PNG ≤ 10 MB) | `201` document; profile → PENDING_REVIEW when photo + 3 documents are present | CLIN-02 |
| `PUT /clinicians/me/availability` | D | `{ slots[{dayOfWeek,startMinute,endMinute}] }` | Availability[] | CLIN-04 |
| `PUT /clinicians/me/available-now` | D | `{ minutes }` (0 switches off, max 240) | `{ availableNowUntil }` | CLIN-04 |
| `GET /clinicians/me/earnings` | D | — | `{ pendingXaf, paidXaf, completedCount, payouts[] }` | CLIN-06, CONS-14 |

### 2.10 Consultations — FR-CONS

The consultation object (participants):
`{ id, status, medium, timing, scheduledAt, acceptDeadline, reason, feeXaf, paymentStatus, baby{id, displayName, givenName, ageDays, sex}, clinician (public), caregiver{firstName, lastName} (clinician view only), preConsultChecklist, previsitSummary, referral, drugChart, review, canJoinCall, chatOpen, unreadCount }`. Clinician view adds `commissionXaf, clinicianEarningXaf`.

| Method & path | Who | Request | Response | Serves |
|---|---|---|---|---|
| `POST /consultations` | C | `{ babyId, clinicianId, medium, timing: SCHEDULED\|ASAP, scheduledAt? (SCHEDULED), reason?, observationId?, preConsultChecklist?, recordingConsent? }`. `403 CONSENT_REQUIRED` without clinician-sharing consent. `409` slot taken; `400` medium not offered / clinician not available now / outside availability. | `201` consultation (AWAITING_PAYMENT) | CONS-01, 02, 05 |
| `POST /consultations/:id/payments` | C | `{ provider: MTN_MOMO\|ORANGE_MONEY\|SANDBOX, payerPhone }` | `201 { paymentId, status: PENDING, message }`: the payer approves on the phone. The result arrives via webhook/poll. | CONS-03, PAY-01 |
| `GET /consultations` | C, D | `?scope=active\|past&limit` | Consultation[] | CONS-*, CLIN-06 |
| `GET /consultations/:id` | C, D (participants) | — | Consultation (clinician read is audited) | CONS-*, AUD-02 |
| `GET /consultations/:id/summary` | D (participant) | `?days=7` | Live summary JSON (same as §2.7) | CONS-06 |
| `POST /consultations/:id/accept` | D | — | `REQUESTED → CONFIRMED` | CONS-04 |
| `POST /consultations/:id/decline` | D | `{ reason? }` | `→ DECLINED` + refund | CONS-04 |
| `POST /consultations/:id/start` | D | — | `CONFIRMED → IN_PROGRESS` | CONS-10 |
| `POST /consultations/:id/complete` | D | `{ clinicianNotes?, diagnosisSummary? }` | `IN_PROGRESS → COMPLETED`; earning recorded | CONS-10, CONS-14 |
| `POST /consultations/:id/no-show` | D | — | `CONFIRMED → NO_SHOW` (no refund) | CONS-10 |
| `POST /consultations/:id/cancel` | C, D | `{ reason? }` | `→ CANCELLED`; refund per FR-CONS-10 | CONS-10 |
| `GET /consultations/:id/messages` | C, D | `?after=<messageId>&limit=50` | Message[] oldest → newest: `{ id, kind, body, imageUrl, senderRole, mine, contactMasked, createdAt, readAt }` | CONS-07 |
| `POST /consultations/:id/messages` | C, D | `{ body }` (≤ 2,000 chars). `409` when chat is closed. | `201` Message (contact details masked) | CONS-07, CONS-08 |
| `POST /consultations/:id/messages/image` | C, D | multipart image (≤ 5 MB) | `201` Message | CONS-07 |
| `POST /consultations/:id/messages/read` | C, D | `{ upToId }` | `204` | CONS-07 |
| `POST /consultations/:id/call` | C, D | — | `{ joinUrl, expiresAt, room }`. `409` outside the call window or for CHAT. | CONS-09 |
| `POST /consultations/:id/referral` | D | `{ facilityId?, facilityName?, urgency, reason }` | `201` Referral `{ code, facility{name, departments} … }` | CONS-11 |
| `POST /consultations/:id/drug-chart` | D | `{ startDate?, items[{ drugName, dose, route, timesOfDay["HH:mm"], durationDays, instructions? }] }` | `201` DrugChart | CONS-12 |
| `POST /consultations/:id/review` | C | `{ rating 1–5, comment? }` | `201` Review | CONS-13 |

### 2.11 Drug charts — FR-DRUG

| Method & path | Who | Request | Response | Serves |
|---|---|---|---|---|
| `GET /babies/:id/drug-charts` | C | `?active=true` | DrugChart[] with items, prescriber name, `endsAt`, recent `doseLogs` | DRUG-01, DRUG-02 |
| `GET /drug-charts/:id` | C (owner), D (prescriber) | — | DrugChart with all dose logs | DRUG-03 |
| `POST /drug-chart-items/:itemId/doses` | C | `{ scheduledFor, status: GIVEN\|SKIPPED }` | `201` DoseLog (upsert) | DRUG-03 |

### 2.12 Admin — FR-ADM

| Method & path | Who | Request | Response | Serves |
|---|---|---|---|---|
| `GET /admin/clinicians` | A | `?status=PENDING_REVIEW` | Profiles with user contact and documents (signed URLs) | ADM-01, CLIN-03 |
| `POST /admin/clinicians/:id/review` | A | `{ decision: VERIFIED\|REJECTED\|SUSPENDED, note? }` | Profile. `400` if verifying without photo + 3 documents. | ADM-01 |
| `PATCH /admin/users/:id` | A | `{ isActive }` | User | ADM-04 |
| `GET /admin/payouts` | A | `?status=PENDING` | Payout[] with clinician name and payout number | ADM-03 |
| `POST /admin/payouts/:id/mark-paid` | A | `{ reference }` | Payout | ADM-03 |
| `GET /admin/stats` | A | — | `{ users{caregivers, clinicians}, babies, checks{GREEN,YELLOW,RED}, consultations{byStatus}, revenueXaf{gross, commission} }` | ADM-05 |
| `GET /admin/jobs` | A | `?status=FAILED` | Job[] | NFR-OBS-01 |

### 2.13 Files, calls, webhooks, health

| Method & path | Who | Request | Response | Serves |
|---|---|---|---|---|
| `GET /files/:token` | Public (signed token, 10 min) | — | File bytes with the stored content type | NFR-SEC-03 |
| `GET /calls/:token` | Public (signed token) | — | HTML call page (LiveKit web client) that joins the room | CONS-09 |
| `POST /webhooks/payments/:provider` | Public (provider signature, header `x-neowell-signature` = HMAC-SHA256 of the raw body) | Provider event | `200 { received: true }` (stored in WebhookEvent, idempotent) | PAY-01..03 |
| `POST /webhooks/livekit` | Public (LiveKit JWT in `Authorization`) | LiveKit webhook | `200` | CONS-09 |
| `GET /health` | Public | — | `{ status, database }` | NFR-OBS-01 |

## 3. Requirement → endpoint matrix

| Requirement group | Endpoints |
|---|---|
| AUTH-01..05 | §2.1 + JWT guard on every route |
| ACC-01..07 | §2.2 |
| BABY-01..08 | §2.3 |
| MEAS-01..05 | §2.3 `POST /babies` (birth measurement), §2.4 |
| CHK-01..13 | §2.3 `check-schedule`, §2.5 |
| VOICE-01..03 | §2.6 (+ job `voice.transcribe`) |
| RPT-01..02 | §2.7, `GET /consultations/:id/summary` |
| FAC-01..03 | §2.8 |
| CLIN-01..07 | §2.9, §2.12 |
| CONS-01..14 | §2.10, `GET /clinicians/:id/slots`, `GET /clinicians/me/earnings` |
| PAY-01..04 | `POST /consultations/:id/payments`, `POST /webhooks/payments/:provider` |
| DRUG-01..03 | §2.11, `POST /consultations/:id/drug-chart` |
| NOT-01..05 | `POST /me/devices`, `GET /me/notifications` (+ jobs, see doc 05) |
| ADM-01..05 | §2.12 |
| AUD-01..02 | Audit interceptor (all writes) + consultation read audit |

## 4. Example: unwell check with fever, then recheck

```http
GET /babies/7c1…/check-plan?type=UNWELL&complaints=FEVER&lang=en
→ { "questions": [ {"id":"temperature","field":"temperatureC","kind":"TEMPERATURE","required":true,…},
                   {"id":"roomFeel","field":"roomFeel","kind":"SINGLE","showIf":{"field":"temperatureC","gte":37.5},…},
                   {"id":"clothing", …}, {"id":"convulsions","kind":"BOOLEAN","help":"In babies, fits can look like twitching…"}, … ] }

POST /babies/7c1…/observations
{ "checkType":"UNWELL", "complaints":["FEVER"], "clientRef":"9b0e…", "temperatureC":38.4,
  "roomFeel":"HOT", "clothing":"HEAVY", "feedingQuality":"GOOD", "activity":"NORMAL", "convulsions":false }
→ 201 { "assessment": { "level":"YELLOW",
         "findings":[{"code":"FEVER_MODERATE","level":"YELLOW"},{"code":"OVERHEATING_LIKELY","level":"YELLOW"}],
         "actions":["COOLING_STEPS","REMOVE_EXTRA_CLOTHING","COOL_ROOM","RECHECK_TEMP_30_MIN","CONSIDER_TELECONSULT"] },
       "recheck": { "id":"r-1", "dueAt":"2026-10-06T10:42:00Z" } }      ← baby aged 5 months

POST /babies/7c1…/observations  { "checkType":"UNWELL", "recheckOfId":"r-1", "temperatureC":38.3, … }
→ 201 { "assessment": { "level":"RED", "findings":[{"code":"FEVER_PERSISTENT","level":"RED"}], … } }
```
