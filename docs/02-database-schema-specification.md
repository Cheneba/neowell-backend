# NeoWell — Database Schema Specification

| | |
|---|---|
| **Version** | 2.0 |
| **Database** | PostgreSQL 16, accessed through Prisma ORM 7 |
| **Source of truth** | [`prisma/schema.prisma`](../prisma/schema.prisma). This document's field tables are generated from it by `python3 scripts/docs/gen_schema_doc.py`. |
| **Diagram** | [03-database-diagram.excalidraw](03-database-diagram.excalidraw) (open at excalidraw.com), with a rendered preview in [03-database-diagram.svg](03-database-diagram.svg) |
| **Related** | [01 Requirements](01-requirements-specification.md) · [04 API](04-api-endpoint-specification.md) |

---

## 1. Overview

The schema has 27 tables and 37 enums, grouped into ten domains:

| Domain | Tables | Serves |
|---|---|---|
| Identity & access | User, OtpCode, RefreshToken | AUTH, ACC |
| Babies & growth | Baby, Measurement | BABY, MEAS |
| Checks & triage | Observation, Recheck, VoiceNote | CHK, VOICE |
| Facilities & referral | Facility, FacilityDepartment, Referral | FAC, CONS-11 |
| Clinicians | ClinicianProfile, ClinicianDocument, ClinicianAvailability | CLIN |
| Teleconsultation | Consultation, Message, Review | CONS |
| Payments & payouts | Payment, Payout | PAY, CONS-14 |
| Drug chart | DrugChart, DrugChartItem, DoseLog | CONS-12, DRUG |
| Notifications | Device, Notification | NOT, ACC-05/06 |
| Platform | Job, WebhookEvent, AuditLog | Background processes, AUD |

**Conventions**
- Primary keys are UUID v4 strings (`id`).
- Timestamps are `timestamptz`, stored in UTC. Local times (availability, dose times, reminder times) are Africa/Douala (UTC+1, no daylight saving).
- Money is integer **XAF** (FCFA has no minor unit).
- Measurements use `Decimal(4,1)`: one decimal place for °C and cm.
- Soft deletion (`deletedAt`) is used only for babies. Everything else is hard-deleted or anonymised by the retention jobs.
- Enum values are stable API codes. The app translates them.

## 2. Relationships

| From | To | Cardinality | On delete |
|---|---|---|---|
| User | Baby | 1 — 0..n (caregiver owns babies) | cascade |
| User | ClinicianProfile | 1 — 0..1 | cascade |
| User | RefreshToken, Device, Notification, VoiceNote | 1 — 0..n | cascade |
| User | Consultation (as caregiver) | 1 — 0..n | cascade |
| User | Message (as sender) | 1 — 0..n | set null |
| Baby | Measurement, Observation, Recheck, VoiceNote, DrugChart, Referral | 1 — 0..n | cascade |
| Baby | Facility (birth facility) | n — 0..1 | set null |
| Observation | Recheck (requested by this check) | 1 — 0..n | cascade |
| Recheck | Observation (answering checks) | 1 — 0..n | set null |
| Observation | VoiceNote | 0..1 — 0..1 | set null |
| Observation | Consultation (check that led to it) | 1 — 0..n | set null |
| ClinicianProfile | ClinicianDocument, ClinicianAvailability | 1 — 0..n | cascade |
| ClinicianProfile | Consultation, Review, Payout | 1 — 0..n | restrict |
| Consultation | Payment, Message | 1 — 0..n | cascade |
| Consultation | Referral, Review, DrugChart | 1 — 0..1 | cascade |
| Consultation | Payout | n — 0..1 | set null |
| Facility | FacilityDepartment | 1 — 0..n | cascade |
| Facility | Referral | 1 — 0..n | set null |
| DrugChart | DrugChartItem | 1 — 0..n | cascade |
| DrugChartItem | DoseLog | 1 — 0..n | cascade |

## 3. Data rules (enforced in the API)

| Rule | Where |
|---|---|
| A caregiver's `firstName` and `lastName` must be set before babies can be created (FR-ACC-01). | `POST /babies` |
| Baby: `sex`, `dateOfBirth`, `gestationalAgeWeeks` (22–44), `birthWeightGrams` (300–7,000), `birthLengthCm` (25–65) and `birthHeadCircumferenceCm` (18–45) are required. `dateOfBirth` cannot be in the future; `dischargeDate` cannot be before birth. | `POST/PATCH /babies` |
| Creating a baby also creates its BIRTH `Measurement` in the same transaction (FR-MEAS-02). | Babies service |
| **Display name** = `givenName` if age ≥ 42 days and `givenName` set; otherwise "Baby {caregiver.lastName}", plus " 1/2/…" in birth order when the caregiver has several babies under 42 days. Computed on read. | `BabyPresenter` |
| `Observation.temperatureC` is required (30.0–43.0). `(babyId, clientRef)` is unique: re-sending the same `clientRef` returns the stored check (FR-CHK-11). | `POST /babies/:id/observations` |
| `Observation.riskReasons` = `{ findings: [{code, level}], actions: [code] }`. `riskEngineVer` records the rules version. | Triage engine |
| A `Recheck` is created when the engine returns `RECHECK_TEMP_30_MIN`. It becomes DONE when a check with `recheckOfId` is saved, or MISSED 2 h after `dueAt`. | Observations service, job J1 |
| Consultation money: `commissionXaf = round(fee × PLATFORM_COMMISSION_PERCENT / 100)`, `clinicianEarningXaf = fee − commission`. Fixed at booking. | Consultations service |
| A clinician cannot hold two active consultations whose 30-minute slots overlap (serializable transaction). | Booking |
| Message bodies are scanned and contact details masked before insert (`contactMasked = true`). | Messages service |
| Clinicians see `firstName`, `lastName` and the display name of the caregiver and baby, **never** `phone` or `email`. Caregivers see the clinician's public profile only. | Presenters |
| A `Review` is allowed once per COMPLETED consultation, by its caregiver; rating 1–5. `ClinicianProfile.ratingAvg/Count` are updated in the same transaction. | Reviews |
| `DoseLog (itemId, scheduledFor)` is unique, so logging the same dose again updates it. | Drug charts |
| `WebhookEvent (source, externalId)` is unique, so duplicate deliveries are ignored. | Webhooks |

## 4. Lifecycles

**Consultation status**

```
AWAITING_PAYMENT ──pay ok──▶ REQUESTED ──accept──▶ CONFIRMED ──start──▶ IN_PROGRESS ──complete──▶ COMPLETED
       │                         │  │                   │  │                  
   30 min unpaid             decline│ deadline       cancel  no-show
       ▼                         ▼  ▼                   ▼  ▼
   CANCELLED                 DECLINED  EXPIRED      CANCELLED  NO_SHOW
```

**Payment status** (`Consultation.paymentStatus`): `UNPAID → PENDING → PAID → (REFUND_PENDING → REFUNDED)`, or `PENDING → FAILED → (retry) PENDING`.

**Clinician verification**: `PENDING_DOCUMENTS → (3 documents) PENDING_REVIEW → VERIFIED | REJECTED`. `REJECTED → (re-upload) PENDING_REVIEW`. Any status → `SUSPENDED` (admin).

**Recheck**: `PENDING → DONE | MISSED`.

**Voice note**: `PENDING → TRANSCRIBED | FAILED | SKIPPED`.

**Job**: `QUEUED → RUNNING → DONE | (retry with backoff) QUEUED | FAILED` after `maxAttempts`.

## 5. Entities

Field tables below are generated from the Prisma schema. **Null** "—" means a list column (never null, may be empty).

### Identity & access

#### `User`

Every person with an account: caregiver, clinician or admin. Holds consents and the name used for the 42-day naming rule.

| Field | Type | Null | Key | Default | Notes |
|---|---|---|---|---|---|
| `id` | `String` | no | PK | uuid() |  |
| `phone` | `String` | no | UQ |  | E.164, e.g. +2376XXXXXXXX. Never exposed to the other party of a consultation. |
| `email` | `String` | yes | UQ |  |  |
| `firstName` | `String` | yes |  |  |  |
| `lastName` | `String` | yes |  |  | Used for the hospital naming convention "Baby <lastName>" |
| `role` | `Role` (enum) | no |  | CAREGIVER |  |
| `locale` | `Locale` (enum) | no |  | en |  |
| `region` | `String` | yes |  |  |  |
| `city` | `String` | yes |  |  |  |
| `isActive` | `Boolean` | no |  | true |  |
| `consentDataCollectionAt` | `DateTime` | yes |  |  |  |
| `consentClinicianShareAt` | `DateTime` | yes |  |  |  |
| `consentRecordingAt` | `DateTime` | yes |  |  |  |
| `deletionRequestedAt` | `DateTime` | yes |  |  | Account purge runs 30 days later (job J9) |
| `createdAt` | `DateTime` | no |  | now() |  |
| `updatedAt` | `DateTime` | no |  | auto (on update) |  |

**Relations:** `babies` → Baby (many); `clinician` → ClinicianProfile (optional); `refreshTokens` → RefreshToken (many); `consultations` → Consultation (many); `devices` → Device (many); `notifications` → Notification (many); `voiceNotes` → VoiceNote (many); `messages` → Message (many); `reviews` → Review (many); `auditLogs` → AuditLog (many)

#### `OtpCode`

One-time sign-in codes (stored as HMAC, never in clear).

| Field | Type | Null | Key | Default | Notes |
|---|---|---|---|---|---|
| `id` | `String` | no | PK | uuid() |  |
| `phone` | `String` | no |  |  |  |
| `codeHash` | `String` | no |  |  |  |
| `expiresAt` | `DateTime` | no |  |  |  |
| `attempts` | `Int` | no |  | 0 |  |
| `consumedAt` | `DateTime` | yes |  |  |  |
| `createdAt` | `DateTime` | no |  | now() |  |

**Constraints / indexes:** `@@index([phone, createdAt])`

#### `RefreshToken`

Rotating refresh tokens (stored as SHA-256 hash).

| Field | Type | Null | Key | Default | Notes |
|---|---|---|---|---|---|
| `id` | `String` | no | PK | uuid() |  |
| `userId` | `String` | no | FK → User |  |  |
| `tokenHash` | `String` | no | UQ |  |  |
| `expiresAt` | `DateTime` | no |  |  |  |
| `revokedAt` | `DateTime` | yes |  |  |  |
| `createdAt` | `DateTime` | no |  | now() |  |

**Relations:** `user` → User

**Constraints / indexes:** `@@index([userId])`

### Babies & growth

#### `Baby`

A baby followed by a caregiver, with the birth data required by FR-BABY-01. The display name is computed, never stored (FR-BABY-02).

| Field | Type | Null | Key | Default | Notes |
|---|---|---|---|---|---|
| `id` | `String` | no | PK | uuid() |  |
| `caregiverId` | `String` | no | FK → User |  |  |
| `givenName` | `String` | yes |  |  | Optional: hospitals call babies "Baby <mother>" until 42 days |
| `sex` | `Sex` (enum) | no |  |  |  |
| `dateOfBirth` | `DateTime` | no |  |  |  |
| `gestationalAgeWeeks` | `Int` | no |  |  | at birth; < 37 = preterm |
| `birthWeightGrams` | `Int` | no |  |  |  |
| `birthLengthCm` | `Decimal` (Decimal(4, 1)) | no |  |  |  |
| `birthHeadCircumferenceCm` | `Decimal` (Decimal(4, 1)) | no |  |  | "HC" in the hospital booklet |
| `birthFacilityId` | `String` | yes | FK → Facility |  |  |
| `birthFacilityName` | `String` | yes |  |  | free text when the facility is not in the directory |
| `careStatus` | `CareStatus` (enum) | no |  | AT_HOME |  |
| `dischargeDate` | `DateTime` | yes |  |  |  |
| `namePromptSentAt` | `DateTime` | yes |  |  | day-42 "add your baby's name" prompt (job J5) |
| `createdAt` | `DateTime` | no |  | now() |  |
| `updatedAt` | `DateTime` | no |  | auto (on update) |  |
| `deletedAt` | `DateTime` | yes |  |  |  |

**Relations:** `caregiver` → User; `birthFacility` → Facility (optional); `measurements` → Measurement (many); `observations` → Observation (many); `rechecks` → Recheck (many); `voiceNotes` → VoiceNote (many); `consultations` → Consultation (many); `drugCharts` → DrugChart (many); `referrals` → Referral (many)

**Constraints / indexes:** `@@index([caregiverId])`

#### `Measurement`

Weight / length / head circumference over time; the first row is the birth measurement (FR-MEAS-01..03).

| Field | Type | Null | Key | Default | Notes |
|---|---|---|---|---|---|
| `id` | `String` | no | PK | uuid() |  |
| `babyId` | `String` | no | FK → Baby |  |  |
| `measuredAt` | `DateTime` | no |  |  |  |
| `weightGrams` | `Int` | yes |  |  |  |
| `lengthCm` | `Decimal` (Decimal(4, 1)) | yes |  |  |  |
| `headCircumferenceCm` | `Decimal` (Decimal(4, 1)) | yes |  |  |  |
| `source` | `MeasurementSource` (enum) | no |  |  |  |
| `notes` | `String` | yes |  |  |  |
| `recordedById` | `String` | no |  |  |  |
| `createdAt` | `DateTime` | no |  | now() |  |

**Relations:** `baby` → Baby

**Constraints / indexes:** `@@index([babyId, measuredAt])`

### Checks & triage

#### `Observation`

One routine or unwell check: answers, complaints and the stored triage result (FR-CHK).

| Field | Type | Null | Key | Default | Notes |
|---|---|---|---|---|---|
| `id` | `String` | no | PK | uuid() |  |
| `babyId` | `String` | no | FK → Baby |  |  |
| `recordedById` | `String` | no |  |  |  |
| `checkType` | `CheckType` (enum) | no |  | ROUTINE |  |
| `complaints` | `Complaint[]` (enum) | — |  |  |  |
| `complaintText` | `String` | yes |  |  |  |
| `clientRef` | `String` | yes |  |  | client-generated id; makes offline re-submission idempotent |
| `recheckOfId` | `String` | yes | FK → Recheck |  | set when this check answers a Recheck |
| `observedAt` | `DateTime` | no |  | now() |  |
| `temperatureC` | `Decimal` (Decimal(4, 1)) | no |  |  |  |
| `temperatureSrc` | `TemperatureSource` (enum) | no |  | MANUAL |  |
| `feedingCount24h` | `Int` | yes |  |  |  |
| `feedingQuality` | `FeedingQuality` (enum) | yes |  |  |  |
| `stoolPattern` | `StoolPattern` (enum) | yes |  |  |  |
| `skinColor` | `SkinColor` (enum) | yes |  |  |  |
| `cry` | `CryDescription` (enum) | yes |  |  |  |
| `activity` | `ActivityLevel` (enum) | yes |  |  |  |
| `breathing` | `BreathingStatus` (enum) | yes |  |  |  |
| `respiratoryRate` | `Int` | yes |  |  | breaths per minute, from the guided 60-second counter |
| `chestIndrawing` | `Boolean` | yes |  |  |  |
| `breathingSound` | `BreathingSound` (enum) | yes |  |  |  |
| `jaundice` | `JaundiceLevel` (enum) | yes |  |  |  |
| `cordStatus` | `CordStatus` (enum) | yes |  |  |  |
| `vomiting` | `VomitingStatus` (enum) | yes |  |  |  |
| `roomFeel` | `RoomFeel` (enum) | yes |  |  |  |
| `clothing` | `ClothingLevel` (enum) | yes |  |  |  |
| `convulsions` | `Boolean` | yes |  |  |  |
| `notes` | `String` | yes |  |  |  |
| `photoKey` | `String` | yes |  |  |  |
| `voiceNoteId` | `String` | yes | UQ, FK → VoiceNote |  |  |
| `riskLevel` | `RiskLevel` (enum) | no |  |  |  |
| `riskReasons` | `Json` | no |  |  | { findings: [{code, level}], actions: [code] } |
| `riskEngineVer` | `String` | no |  |  |  |
| `createdAt` | `DateTime` | no |  | now() |  |

**Relations:** `baby` → Baby; `voiceNote` → VoiceNote (optional); `recheckOf` → Recheck (optional); `rechecks` → Recheck (many); `consultations` → Consultation (many)

**Constraints / indexes:** `@@unique([babyId, clientRef])`; `@@index([babyId, observedAt])`

#### `Recheck`

A follow-up temperature check requested by the risk engine (e.g. 30 minutes after cooling steps).

| Field | Type | Null | Key | Default | Notes |
|---|---|---|---|---|---|
| `id` | `String` | no | PK | uuid() |  |
| `babyId` | `String` | no | FK → Baby |  |  |
| `observationId` | `String` | no | FK → Observation |  |  |
| `reason` | `String` | no |  |  | finding code that triggered it, e.g. FEVER_MODERATE |
| `dueAt` | `DateTime` | no |  |  |  |
| `status` | `RecheckStatus` (enum) | no |  | PENDING |  |
| `notifiedAt` | `DateTime` | yes |  |  |  |
| `createdAt` | `DateTime` | no |  | now() |  |

**Relations:** `baby` → Baby; `observation` → Observation; `answers` → Observation (many)

**Constraints / indexes:** `@@index([status, dueAt])`

#### `VoiceNote`

Voice description recorded in the unwell flow, transcribed by the self-hosted speech service (FR-VOICE).

| Field | Type | Null | Key | Default | Notes |
|---|---|---|---|---|---|
| `id` | `String` | no | PK | uuid() |  |
| `ownerId` | `String` | no | FK → User |  |  |
| `babyId` | `String` | no | FK → Baby |  |  |
| `storageKey` | `String` | no |  |  |  |
| `mimeType` | `String` | no |  |  |  |
| `sizeBytes` | `Int` | no |  |  |  |
| `status` | `VoiceNoteStatus` (enum) | no |  | PENDING |  |
| `transcript` | `String` | yes |  |  |  |
| `language` | `String` | yes |  |  |  |
| `detectedComplaints` | `Complaint[]` (enum) | — |  |  |  |
| `createdAt` | `DateTime` | no |  | now() |  |
| `updatedAt` | `DateTime` | no |  | auto (on update) |  |

**Relations:** `owner` → User; `baby` → Baby; `observation` → Observation (optional)

### Facilities & referral

#### `Facility`

Health facility in the directory (also used as birth facility and referral destination).

| Field | Type | Null | Key | Default | Notes |
|---|---|---|---|---|---|
| `id` | `String` | no | PK | uuid() |  |
| `name` | `String` | no |  |  |  |
| `region` | `String` | yes |  |  |  |
| `city` | `String` | yes |  |  |  |
| `address` | `String` | yes |  |  |  |
| `latitude` | `Float` | no |  |  |  |
| `longitude` | `Float` | no |  |  |  |
| `services` | `FacilityService[]` (enum) | — |  |  |  |
| `mainPhone` | `String` | yes |  |  |  |
| `hours` | `String` | yes |  |  |  |
| `isActive` | `Boolean` | no |  | true |  |
| `createdAt` | `DateTime` | no |  | now() |  |
| `updatedAt` | `DateTime` | no |  | auto (on update) |  |

**Relations:** `departments` → FacilityDepartment (many); `births` → Baby (many); `referrals` → Referral (many)

**Constraints / indexes:** `@@index([latitude, longitude])`

#### `FacilityDepartment`

Department helpline (Neonatology, Paediatrics, …) of a facility.

| Field | Type | Null | Key | Default | Notes |
|---|---|---|---|---|---|
| `id` | `String` | no | PK | uuid() |  |
| `facilityId` | `String` | no | FK → Facility |  |  |
| `service` | `FacilityService` (enum) | no |  |  |  |
| `name` | `String` | no |  |  |  |
| `phone` | `String` | no |  |  |  |

**Relations:** `facility` → Facility

**Constraints / indexes:** `@@unique([facilityId, service])`

#### `Referral`

Clinician referral of a baby to a facility, with urgency and a short code (FR-CONS-11).

| Field | Type | Null | Key | Default | Notes |
|---|---|---|---|---|---|
| `id` | `String` | no | PK | uuid() |  |
| `consultationId` | `String` | no | UQ, FK → Consultation |  |  |
| `babyId` | `String` | no | FK → Baby |  |  |
| `facilityId` | `String` | yes | FK → Facility |  |  |
| `facilityName` | `String` | no |  |  |  |
| `urgency` | `ReferralUrgency` (enum) | no |  |  |  |
| `reason` | `String` | no |  |  |  |
| `code` | `String` | no | UQ |  | short code shown at the hospital, e.g. NW-7KQ2M |
| `acknowledgedAt` | `DateTime` | yes |  |  |  |
| `createdAt` | `DateTime` | no |  | now() |  |

**Relations:** `consultation` → Consultation; `baby` → Baby; `facility` → Facility (optional)

### Clinicians

#### `ClinicianProfile`

Professional profile, per-medium fees, availability flag, verification state and payout number.

| Field | Type | Null | Key | Default | Notes |
|---|---|---|---|---|---|
| `id` | `String` | no | PK | uuid() |  |
| `userId` | `String` | no | UQ, FK → User |  |  |
| `title` | `String` | no |  | "Dr" |  |
| `licenseNumber` | `String` | no | UQ |  |  |
| `specialties` | `String[]` | — |  |  |  |
| `bio` | `String` | yes |  |  |  |
| `currentFacility` | `String` | yes |  |  |  |
| `yearsExperience` | `Int` | yes |  |  |  |
| `photoKey` | `String` | yes |  |  | required before verification: trust (meeting decision) |
| `offersChat` | `Boolean` | no |  | true |  |
| `offersAudio` | `Boolean` | no |  | true |  |
| `offersVideo` | `Boolean` | no |  | true |  |
| `feeChatXaf` | `Int` | no |  |  |  |
| `feeAudioXaf` | `Int` | no |  |  |  |
| `feeVideoXaf` | `Int` | no |  |  |  |
| `availableNowUntil` | `DateTime` | yes |  |  | "available now" for ASAP consultations |
| `payoutProvider` | `PaymentProvider` (enum) | yes |  |  |  |
| `payoutPhone` | `String` | yes |  |  | visible to admins only |
| `verificationStatus` | `VerificationStatus` (enum) | no |  | PENDING_DOCUMENTS |  |
| `verificationNote` | `String` | yes |  |  |  |
| `verifiedAt` | `DateTime` | yes |  |  |  |
| `verifiedById` | `String` | yes |  |  |  |
| `ratingAvg` | `Decimal` (Decimal(3, 2)) | yes |  |  |  |
| `ratingCount` | `Int` | no |  | 0 |  |
| `createdAt` | `DateTime` | no |  | now() |  |
| `updatedAt` | `DateTime` | no |  | auto (on update) |  |

**Relations:** `user` → User; `documents` → ClinicianDocument (many); `availability` → ClinicianAvailability (many); `consultations` → Consultation (many); `reviews` → Review (many); `payouts` → Payout (many)

#### `ClinicianDocument`

Licence, degree and employment proof uploaded for verification (FR-CLIN-02).

| Field | Type | Null | Key | Default | Notes |
|---|---|---|---|---|---|
| `id` | `String` | no | PK | uuid() |  |
| `clinicianId` | `String` | no | FK → ClinicianProfile |  |  |
| `type` | `ClinicianDocumentType` (enum) | no |  |  |  |
| `storageKey` | `String` | no |  |  |  |
| `originalName` | `String` | no |  |  |  |
| `mimeType` | `String` | no |  |  |  |
| `sizeBytes` | `Int` | no |  |  |  |
| `uploadedAt` | `DateTime` | no |  | now() |  |

**Relations:** `clinician` → ClinicianProfile

**Constraints / indexes:** `@@index([clinicianId, type])`

#### `ClinicianAvailability`

Weekly recurring availability window, in local time (Africa/Douala, UTC+1).

| Field | Type | Null | Key | Default | Notes |
|---|---|---|---|---|---|
| `id` | `String` | no | PK | uuid() |  |
| `clinicianId` | `String` | no | FK → ClinicianProfile |  |  |
| `dayOfWeek` | `Int` | no |  |  | 0 = Sunday … 6 = Saturday |
| `startMinute` | `Int` | no |  |  | minutes from midnight |
| `endMinute` | `Int` | no |  |  |  |

**Relations:** `clinician` → ClinicianProfile

**Constraints / indexes:** `@@index([clinicianId])`

### Teleconsultation

#### `Consultation`

A paid teleconsultation: medium, timing, lifecycle, money split, pre-visit summary and outcome.

| Field | Type | Null | Key | Default | Notes |
|---|---|---|---|---|---|
| `id` | `String` | no | PK | uuid() |  |
| `babyId` | `String` | no | FK → Baby |  |  |
| `caregiverId` | `String` | no | FK → User |  |  |
| `clinicianId` | `String` | no | FK → ClinicianProfile |  |  |
| `observationId` | `String` | yes | FK → Observation |  | the check that led to this consultation |
| `medium` | `ConsultationMedium` (enum) | no |  |  |  |
| `timing` | `ConsultationTiming` (enum) | no |  | SCHEDULED |  |
| `status` | `ConsultationStatus` (enum) | no |  | AWAITING_PAYMENT |  |
| `scheduledAt` | `DateTime` | no |  |  |  |
| `acceptDeadline` | `DateTime` | yes |  |  | REQUESTED → EXPIRED after this (job J2) |
| `reason` | `String` | yes |  |  |  |
| `preConsultChecklist` | `Json` | yes |  |  | e.g. fever steps already tried (meeting decision) |
| `feeXaf` | `Int` | no |  |  |  |
| `commissionXaf` | `Int` | no |  |  |  |
| `clinicianEarningXaf` | `Int` | no |  |  |  |
| `paymentStatus` | `PaymentStatus` (enum) | no |  | UNPAID |  |
| `previsitSummary` | `Json` | yes |  |  |  |
| `recordingConsent` | `Boolean` | no |  | false |  |
| `roomName` | `String` | yes | UQ |  |  |
| `reminderSentAt` | `DateTime` | yes |  |  |  |
| `startedAt` | `DateTime` | yes |  |  |  |
| `endedAt` | `DateTime` | yes |  |  |  |
| `clinicianNotes` | `String` | yes |  |  |  |
| `diagnosisSummary` | `String` | yes |  |  |  |
| `cancelledById` | `String` | yes |  |  |  |
| `cancelReason` | `String` | yes |  |  |  |
| `payoutId` | `String` | yes | FK → Payout |  |  |
| `createdAt` | `DateTime` | no |  | now() |  |
| `updatedAt` | `DateTime` | no |  | auto (on update) |  |

**Relations:** `baby` → Baby; `caregiver` → User; `clinician` → ClinicianProfile; `observation` → Observation (optional); `payout` → Payout (optional); `payments` → Payment (many); `messages` → Message (many); `referral` → Referral (optional); `review` → Review (optional); `drugChart` → DrugChart (optional)

**Constraints / indexes:** `@@index([clinicianId, scheduledAt])`; `@@index([caregiverId])`; `@@index([status])`

#### `Message`

Chat message in a consultation; contact details masked (FR-CONS-07/08).

| Field | Type | Null | Key | Default | Notes |
|---|---|---|---|---|---|
| `id` | `String` | no | PK | uuid() |  |
| `consultationId` | `String` | no | FK → Consultation |  |  |
| `senderId` | `String` | yes | FK → User |  | null for SYSTEM / REPORT |
| `kind` | `MessageKind` (enum) | no |  |  |  |
| `body` | `String` | yes |  |  |  |
| `attachmentKey` | `String` | yes |  |  |  |
| `contactMasked` | `Boolean` | no |  | false | phone/email/link removed (anti-bypass, privacy) |
| `readAt` | `DateTime` | yes |  |  |  |
| `createdAt` | `DateTime` | no |  | now() |  |

**Relations:** `consultation` → Consultation; `sender` → User (optional)

**Constraints / indexes:** `@@index([consultationId, createdAt])`

#### `Review`

Caregiver rating of a completed consultation (FR-CONS-13).

| Field | Type | Null | Key | Default | Notes |
|---|---|---|---|---|---|
| `id` | `String` | no | PK | uuid() |  |
| `consultationId` | `String` | no | UQ, FK → Consultation |  |  |
| `caregiverId` | `String` | no | FK → User |  |  |
| `clinicianId` | `String` | no | FK → ClinicianProfile |  |  |
| `rating` | `Int` | no |  |  | 1–5 |
| `comment` | `String` | yes |  |  |  |
| `createdAt` | `DateTime` | no |  | now() |  |

**Relations:** `consultation` → Consultation; `caregiver` → User; `clinician` → ClinicianProfile

### Payments & payouts

#### `Payment`

Mobile-money collection or refund for a consultation (FR-PAY).

| Field | Type | Null | Key | Default | Notes |
|---|---|---|---|---|---|
| `id` | `String` | no | PK | uuid() |  |
| `consultationId` | `String` | no | FK → Consultation |  |  |
| `kind` | `PaymentKind` (enum) | no |  | COLLECTION |  |
| `provider` | `PaymentProvider` (enum) | no |  |  |  |
| `payerPhone` | `String` | no |  |  |  |
| `amountXaf` | `Int` | no |  |  |  |
| `status` | `PaymentStatus` (enum) | no |  | PENDING |  |
| `externalRef` | `String` | yes | UQ |  |  |
| `failureReason` | `String` | yes |  |  |  |
| `rawResponse` | `Json` | yes |  |  |  |
| `createdAt` | `DateTime` | no |  | now() |  |
| `updatedAt` | `DateTime` | no |  | auto (on update) |  |

**Relations:** `consultation` → Consultation

**Constraints / indexes:** `@@index([status, createdAt])`

#### `Payout`

Weekly grouping of a clinician's earnings, marked paid by admins (FR-CONS-14).

| Field | Type | Null | Key | Default | Notes |
|---|---|---|---|---|---|
| `id` | `String` | no | PK | uuid() |  |
| `clinicianId` | `String` | no | FK → ClinicianProfile |  |  |
| `periodStart` | `DateTime` | no |  |  |  |
| `periodEnd` | `DateTime` | no |  |  |  |
| `amountXaf` | `Int` | no |  |  |  |
| `status` | `PayoutStatus` (enum) | no |  | PENDING |  |
| `paidAt` | `DateTime` | yes |  |  |  |
| `reference` | `String` | yes |  |  |  |
| `createdAt` | `DateTime` | no |  | now() |  |

**Relations:** `clinician` → ClinicianProfile; `consultations` → Consultation (many)

### Drug chart

#### `DrugChart`

Medication plan prescribed in a consultation (FR-CONS-12).

| Field | Type | Null | Key | Default | Notes |
|---|---|---|---|---|---|
| `id` | `String` | no | PK | uuid() |  |
| `babyId` | `String` | no | FK → Baby |  |  |
| `consultationId` | `String` | yes | UQ, FK → Consultation |  |  |
| `prescribedById` | `String` | no |  |  |  |
| `startDate` | `DateTime` | no |  |  |  |
| `createdAt` | `DateTime` | no |  | now() |  |

**Relations:** `baby` → Baby; `consultation` → Consultation (optional); `items` → DrugChartItem (many)

#### `DrugChartItem`

One medicine with dose, route, times and duration.

| Field | Type | Null | Key | Default | Notes |
|---|---|---|---|---|---|
| `id` | `String` | no | PK | uuid() |  |
| `drugChartId` | `String` | no | FK → DrugChart |  |  |
| `drugName` | `String` | no |  |  |  |
| `dose` | `String` | no |  |  | e.g. "2.5 ml" |
| `route` | `String` | no |  |  | e.g. "oral", "eye drops" |
| `timesOfDay` | `String[]` | — |  |  | "HH:mm", local time |
| `durationDays` | `Int` | no |  |  |  |
| `instructions` | `String` | yes |  |  |  |

**Relations:** `drugChart` → DrugChart; `doseLogs` → DoseLog (many)

#### `DoseLog`

Caregiver's record that a scheduled dose was given or skipped (FR-DRUG-03).

| Field | Type | Null | Key | Default | Notes |
|---|---|---|---|---|---|
| `id` | `String` | no | PK | uuid() |  |
| `itemId` | `String` | no | FK → DrugChartItem |  |  |
| `scheduledFor` | `DateTime` | no |  |  |  |
| `status` | `DoseStatus` (enum) | no |  |  |  |
| `loggedAt` | `DateTime` | no |  | now() |  |

**Relations:** `item` → DrugChartItem

**Constraints / indexes:** `@@unique([itemId, scheduledFor])`

### Notifications

#### `Device`

Push-notification device (Expo push token) of a user (FR-ACC-05).

| Field | Type | Null | Key | Default | Notes |
|---|---|---|---|---|---|
| `id` | `String` | no | PK | uuid() |  |
| `userId` | `String` | no | FK → User |  |  |
| `expoPushToken` | `String` | no | UQ |  |  |
| `platform` | `String` | no |  |  | android / ios / web |
| `lastSeenAt` | `DateTime` | no |  | now() |  |
| `createdAt` | `DateTime` | no |  | now() |  |

**Relations:** `user` → User

#### `Notification`

In-app inbox entry; also tracks push/SMS delivery (FR-NOT).

| Field | Type | Null | Key | Default | Notes |
|---|---|---|---|---|---|
| `id` | `String` | no | PK | uuid() |  |
| `userId` | `String` | no | FK → User |  |  |
| `type` | `String` | no |  |  | e.g. CONSULT_CONFIRMED, RECHECK_DUE, NEW_MESSAGE |
| `title` | `String` | no |  |  |  |
| `body` | `String` | no |  |  |  |
| `data` | `Json` | yes |  |  |  |
| `readAt` | `DateTime` | yes |  |  |  |
| `pushedAt` | `DateTime` | yes |  |  |  |
| `smsAt` | `DateTime` | yes |  |  |  |
| `createdAt` | `DateTime` | no |  | now() |  |

**Relations:** `user` → User

**Constraints / indexes:** `@@index([userId, createdAt])`

### Platform

#### `Job`

Postgres-backed work queue (see docs/05-background-processes-specification.md).

| Field | Type | Null | Key | Default | Notes |
|---|---|---|---|---|---|
| `id` | `String` | no | PK | uuid() |  |
| `queue` | `String` | no |  |  |  |
| `payload` | `Json` | no |  |  |  |
| `status` | `JobStatus` (enum) | no |  | QUEUED |  |
| `runAt` | `DateTime` | no |  | now() |  |
| `attempts` | `Int` | no |  | 0 |  |
| `maxAttempts` | `Int` | no |  | 5 |  |
| `lastError` | `String` | yes |  |  |  |
| `lockedAt` | `DateTime` | yes |  |  |  |
| `finishedAt` | `DateTime` | yes |  |  |  |
| `createdAt` | `DateTime` | no |  | now() |  |

**Constraints / indexes:** `@@index([status, runAt])`

#### `WebhookEvent`

Every inbound webhook, stored before processing: idempotency + audit.

| Field | Type | Null | Key | Default | Notes |
|---|---|---|---|---|---|
| `id` | `String` | no | PK | uuid() |  |
| `source` | `String` | no |  |  | e.g. payments:SANDBOX, livekit |
| `externalId` | `String` | no |  |  |  |
| `signatureValid` | `Boolean` | no |  |  |  |
| `payload` | `Json` | no |  |  |  |
| `processedAt` | `DateTime` | yes |  |  |  |
| `error` | `String` | yes |  |  |  |
| `createdAt` | `DateTime` | no |  | now() |  |

**Constraints / indexes:** `@@unique([source, externalId])`

#### `AuditLog`

Who did what, when (FR-AUD). No request bodies.

| Field | Type | Null | Key | Default | Notes |
|---|---|---|---|---|---|
| `id` | `String` | no | PK | uuid() |  |
| `userId` | `String` | yes | FK → User |  |  |
| `action` | `String` | no |  |  | e.g. "POST /babies/:id/observations" |
| `entityType` | `String` | yes |  |  |  |
| `entityId` | `String` | yes |  |  |  |
| `statusCode` | `Int` | yes |  |  |  |
| `ip` | `String` | yes |  |  |  |
| `createdAt` | `DateTime` | no |  | now() |  |

**Relations:** `user` → User (optional)

**Constraints / indexes:** `@@index([userId, createdAt])`; `@@index([entityType, entityId])`


## 6. Enumerations

| Enum | Values | Notes |
|---|---|---|
| `Role` | `CAREGIVER`, `CLINICIAN`, `ADMIN` |  |
| `Locale` | `en`, `fr` |  |
| `Sex` | `FEMALE`, `MALE` |  |
| `CareStatus` | `AT_HOME`, `IN_HOSPITAL`, `KANGAROO_CARE` | IN_HOSPITAL / KANGAROO_CARE pause home checks (FR-BABY-05). |
| `MeasurementSource` | `BIRTH`, `HOSPITAL`, `CLINIC`, `HOME` |  |
| `CheckType` | `ROUTINE`, `UNWELL` |  |
| `Complaint` | `FEVER`, `FEELS_COLD`, `CRYING_A_LOT`, `NOT_CRYING_OR_WEAK`, `NOT_FEEDING`, `BREATHING_PROBLEM`, `TWITCHING_OR_FITS`, `VOMITING`, `DIARRHEA`, `YELLOW_SKIN_OR_EYES`, `SKIN_COLOUR_CHANGE`, `CORD_PROBLEM`, `OTHER` | Unwell-flow complaints (FR-CHK-03). |
| `RiskLevel` | `GREEN`, `YELLOW`, `RED` |  |
| `SkinColor` | `NORMAL`, `PALE`, `YELLOW`, `BLUE`, `MOTTLED`, `FLUSHED` |  |
| `FeedingQuality` | `GOOD`, `REDUCED`, `UNABLE` |  |
| `StoolPattern` | `NORMAL`, `REDUCED`, `NONE`, `DIARRHEA`, `BLOODY` |  |
| `CryDescription` | `NORMAL`, `WEAK`, `HIGH_PITCHED`, `INCONSOLABLE`, `NONE` |  |
| `ActivityLevel` | `NORMAL`, `REDUCED`, `LETHARGIC` |  |
| `BreathingStatus` | `NORMAL`, `FAST`, `DIFFICULT` |  |
| `BreathingSound` | `QUIET`, `WHEEZING`, `GRUNTING`, `NOISY` |  |
| `JaundiceLevel` | `NONE`, `FACE_CHEST`, `PALMS_SOLES` |  |
| `CordStatus` | `NORMAL`, `RED_OR_DISCHARGE`, `SPREADING_REDNESS_OR_PUS` |  |
| `VomitingStatus` | `NONE`, `SOMETIMES`, `REPEATED`, `FORCEFUL_OR_GREEN` |  |
| `RoomFeel` | `COLD`, `COMFORTABLE`, `HOT` |  |
| `ClothingLevel` | `LIGHT`, `NORMAL`, `HEAVY` |  |
| `TemperatureSource` | `MANUAL`, `BLE_THERMOMETER`, `VOICE` |  |
| `RecheckStatus` | `PENDING`, `DONE`, `MISSED` |  |
| `VoiceNoteStatus` | `PENDING`, `TRANSCRIBED`, `FAILED`, `SKIPPED` |  |
| `FacilityService` | `NEONATOLOGY`, `PAEDIATRICS`, `OPD`, `MATERNITY`, `EMERGENCY`, `KANGAROO_CARE` |  |
| `VerificationStatus` | `PENDING_DOCUMENTS`, `PENDING_REVIEW`, `VERIFIED`, `REJECTED`, `SUSPENDED` |  |
| `ClinicianDocumentType` | `MEDICAL_LICENSE`, `MEDICAL_DEGREE`, `EMPLOYMENT_PROOF` |  |
| `PaymentProvider` | `SANDBOX`, `MTN_MOMO`, `ORANGE_MONEY` |  |
| `ConsultationMedium` | `CHAT`, `AUDIO`, `VIDEO` |  |
| `ConsultationTiming` | `SCHEDULED`, `ASAP` |  |
| `ConsultationStatus` | `AWAITING_PAYMENT`, `REQUESTED`, `CONFIRMED`, `IN_PROGRESS`, `COMPLETED`, `CANCELLED`, `DECLINED`, `EXPIRED`, `NO_SHOW` | See the lifecycle diagram in §4. |
| `PaymentStatus` | `UNPAID`, `PENDING`, `PAID`, `REFUND_PENDING`, `REFUNDED`, `FAILED` | Consultation-level and payment-level money state. |
| `MessageKind` | `TEXT`, `IMAGE`, `REPORT`, `SYSTEM` |  |
| `ReferralUrgency` | `EMERGENCY`, `SAME_DAY`, `ROUTINE` |  |
| `PaymentKind` | `COLLECTION`, `REFUND` |  |
| `PayoutStatus` | `PENDING`, `PAID` |  |
| `DoseStatus` | `GIVEN`, `SKIPPED` |  |
| `JobStatus` | `QUEUED`, `RUNNING`, `DONE`, `FAILED` |  |

## 7. Retention

| Data | Retention |
|---|---|
| OTP codes | Deleted 24 h after creation (job J8) |
| Refresh tokens | Deleted 30 days after expiry or revocation (J8) |
| Finished jobs | Deleted after 14 days; failed jobs after 90 days (J8) |
| Webhook events | 90 days (J8) |
| Account deletion | After 30 days: user, babies, measurements, checks, voice notes, devices and notifications deleted. Consultations, messages and drug charts kept with caregiver identity removed. (J9) |
| Audit log | 2 years (to be confirmed with local regulation) |

## 8. Planned: clinical knowledge base (FR-KB, awaiting the product owner's spreadsheet)

| Table | Fields |
|---|---|
| `Condition` | `id`, `code` (unique), `nameEn`, `nameFr`, `severity` (1–5), `management` (HOME / HOSPITAL / HOME_THEN_HOSPITAL), `canMotherIdentify` (bool), `source`, `signedOffBy`, `signedOffAt` |
| `ConditionSign` | `conditionId`, `questionField` (question-bank field), `value`, `weight` |
| `HomeRemedy` | `conditionId`, `order`, `textEn`, `textFr`, `minAgeDays` |

These tables are added by a later migration together with an import script for the spreadsheet columns: *condition · how identified · can the mother identify it · home or hospital · home remedies · severity*.
