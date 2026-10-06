# NeoWell — Backend API

NeoWell helps mothers and caregivers in Cameroon monitor their newborn at home. This API serves the NeoWell mobile app ([`Cheneba/neowell-app`](https://github.com/Cheneba/neowell-app)). It covers:
- **Routine checks.** Guided checks scored instantly as 🟢 Green / 🟡 Yellow / 🔴 Red with safe advice.
- **"My baby is unwell now" checks.** Follow-up questions specific to the complaint.
- **Growth tracking.** Against the WHO standards.
- **Nearest facilities** for referral.
- **Paid teleconsultations** with verified clinicians by chat, audio or video, paid with MTN MoMo or Orange Money.

Built with **NestJS 11 + TypeScript**, **PostgreSQL 16** and **Prisma 7**.

## 📚 Design documents

All design documents are in [`docs/`](docs/README.md):

| # | Document |
|---|---|
| 01 | [Requirements Specification](docs/01-requirements-specification.md), including the triage rules (§6) and the decisions from the product meeting |
| 02 | [Database Schema Specification](docs/02-database-schema-specification.md) |
| 03 | [Database Diagram (Excalidraw)](docs/03-database-diagram.excalidraw), with an [SVG preview](docs/03-database-diagram.svg) |
| 04 | [API Endpoint Specification](docs/04-api-endpoint-specification.md) |
| 05 | [Background Processes Specification](docs/05-background-processes-specification.md) |
| 06 | [Technology Stack and Assets](docs/06-technology-stack-and-assets.md) |
| 07 | [Front-End Design Guide v1.0](docs/07-frontend-design-guide-v1.0.md) |

## Quick start

```bash
docker compose up -d                    # PostgreSQL
cp .env.example .env
npm install                             # also generates the Prisma client
npm run db:deploy                       # apply migrations
SEED_ADMIN_PHONE=+2376XXXXXXXX SEED_DEMO_CLINICIAN_PHONE=+2376YYYYYYYY npm run db:seed
npm run start:dev
```

- **API:** http://localhost:3000
- **Swagger:** http://localhost:3000/docs (outside production)
- **Health:** `GET /health`
- **Sign-in codes:** printed in the server log while `SMS_PROVIDER=console`.
- **Payments:** the `SANDBOX` provider confirms automatically after about 3 seconds. Payer numbers ending in `000` fail.
- **Demo doctor:** `SEED_DEMO_CLINICIAN_PHONE` creates a verified doctor who is "available now", so you can try a consultation end to end.
- **Calls:** need `LIVEKIT_*`.
- **Voice notes:** transcribed when `STT_URL` points to a self-hosted Whisper server. See [doc 06](docs/06-technology-stack-and-assets.md).

| Command | What it does |
| --- | --- |
| `npm run start:dev` | Run with hot reload (includes background jobs) |
| `npm test` | Unit tests: triage engine, WHO growth, naming rule, question bank, scheduling, contact masking, transitions |
| `npm run test:e2e` | End-to-end API tests against the database in `DATABASE_URL` (migrated) |
| `npm run lint` / `npm run typecheck` / `npm run format` | Code quality |
| `npm run db:migrate` | Create a migration after editing `prisma/schema.prisma`, then regenerate docs 02/03 (`python3 scripts/docs/gen_schema_doc.py && python3 scripts/docs/gen_diagram.py`) |

## Architecture

```
src/
├── auth/            Phone + OTP sign-in, JWT, rotating refresh tokens
├── users/           Profile (first/last name), consents, data export, account deletion
├── babies/          Baby profiles, 42-day naming rule, risk factors, KMC/hospital pause (baby-facts.ts)
├── growth/          Measurements + WHO growth z-scores (who-lms.json)
├── checks/          Question bank, routine & unwell check plans, observations, rechecks
├── triage/          ★ Risk engine v0.2 + check schedule (pure, unit-tested)
├── voice/           Voice notes → self-hosted speech-to-text → complaint keywords
├── reports/         3/7-day summary (JSON + PDF)
├── facilities/      Directory, search, nearest facilities
├── clinicians/      Profiles, fees per medium, documents, photo, availability, slots, earnings
├── consultations/   Booking, payments, lifecycle, chat (contact masking), calls (LiveKit), referral,
│                    drug chart, review, payment & LiveKit webhooks
├── drug-charts/     Caregiver medicines and dose logs
├── payments/        Payment gateway interface + sandbox provider
├── notifications/   Inbox, devices, Expo push, SMS fallback, bilingual templates
├── jobs/            Postgres job queue (SKIP LOCKED)
├── scheduler/       Cron jobs J1–J10 and maintenance (retention, purge, payouts…)
├── admin/           Clinician review, users, payouts, stats, failed jobs
├── files/, storage/ Private storage + expiring signed file links
└── common/, config/, prisma/, health/
```

## Status

**Built in v2:** everything in the requirements marked M or S. The details are in the specs.

**Waiting on external input:**
- **Clinical sign-off** of the triage rules and advice text. Open questions are in [requirements §6.5](docs/01-requirements-specification.md).
- **The product owner's disease spreadsheet**, which feeds the knowledge base (FR-KB).
- **A live payment aggregator account.** The sandbox works today; the live adapter plugs into `PaymentGateway`.
- **SMS gateway, LiveKit and speech-to-text server credentials.**
- **A verified facility dataset for Cameroon.**
- **The correct emergency numbers** in `EMERGENCY_PHONE_NUMBERS`.
