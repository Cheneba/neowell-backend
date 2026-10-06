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

The schema has {{COUNTS}}, grouped into ten domains:

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
| Baby: `sex`, `dateOfBirth`, `gestationalAgeWeeks` (22–44), `birthWeightGrams` (300–7,000), `birthLengthCm` (25–65) and `birthHeadCircumferenceCm` (18–45) are required by the API. The columns are nullable only so that babies registered before v2 survive the migration; the app asks for the missing values (risk factor `MISSING_BIRTH_DATA`). `dateOfBirth` cannot be in the future; `dischargeDate` cannot be before birth. | `POST/PATCH /babies` |
| Creating a baby also creates its BIRTH `Measurement` in the same transaction (FR-MEAS-02). | Babies service |
| **Display name** = `givenName` if age ≥ 42 days and `givenName` set; otherwise "Baby {caregiver.lastName}", plus " 1/2/…" in birth order when several of the caregiver's babies use that name. Computed on read. | `babies/baby-facts.ts` |
| `Observation.temperatureC` is required by the API (30.0–43.0); the column is nullable only for checks recorded before v2. `(babyId, clientRef)` is unique: re-sending the same `clientRef` returns the stored check (FR-CHK-11). | `POST /babies/:id/observations` |
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

{{ENTITY_TABLES}}

## 6. Enumerations

{{ENUMS}}

## 7. Migrations

| Migration | What it does |
|---|---|
| `20260924154858_init` | v1 schema |
| `20261006090000_v2_enum_values` | New enum values (kept separate: PostgreSQL cannot use a new enum value in the transaction that adds it) |
| `20261006090100_v2_schema` | v2 tables and columns, **carrying v1 data over**: `fullName` → `firstName`/`lastName`; baby `name` → `givenName`; `birthHospital` → `birthFacilityName`; sex `UNKNOWN` → null; the single clinician fee → all three medium fees; consultation `type` → `medium`; `clinicianEarningXaf = feeXaf − commissionXaf` |

## 8. Retention

| Data | Retention |
|---|---|
| OTP codes | Deleted 24 h after creation (job J8) |
| Refresh tokens | Deleted 30 days after expiry or revocation (J8) |
| Finished jobs | Deleted after 14 days; failed jobs after 90 days (J8) |
| Webhook events | 90 days (J8) |
| Account deletion | After 30 days: user, babies, measurements, checks, voice notes, devices and notifications deleted. Consultations, messages and drug charts kept with caregiver identity removed. (J9) |
| Audit log | 2 years (to be confirmed with local regulation) |

## 9. Planned: clinical knowledge base (FR-KB, awaiting the product owner's spreadsheet)

| Table | Fields |
|---|---|
| `Condition` | `id`, `code` (unique), `nameEn`, `nameFr`, `severity` (1–5), `management` (HOME / HOSPITAL / HOME_THEN_HOSPITAL), `canMotherIdentify` (bool), `source`, `signedOffBy`, `signedOffAt` |
| `ConditionSign` | `conditionId`, `questionField` (question-bank field), `value`, `weight` |
| `HomeRemedy` | `conditionId`, `order`, `textEn`, `textFr`, `minAgeDays` |

These tables are added by a later migration together with an import script for the spreadsheet columns: *condition · how identified · can the mother identify it · home or hospital · home remedies · severity*.
