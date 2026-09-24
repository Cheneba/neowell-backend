# NeoWell — Backend API

NeoWell helps mothers and caregivers in Cameroon watch their newborn at home. Caregivers record a guided daily check. The app spots danger signs early and gives an instant **Green / Yellow / Red** result. It then points the family to the nearest suitable facility, or lets them book a paid teleconsultation with a verified paediatric or neonatal clinician. The clinician gets a pre-visit summary before the call.

This repository holds the API. It is built with **NestJS 11 + TypeScript**, **PostgreSQL** and **Prisma 7**.

---

## Quick start

```bash
# 1. Start PostgreSQL (or point DATABASE_URL at your own instance)
docker compose up -d

# 2. Install dependencies (also generates the Prisma client)
cp .env.example .env
npm install

# 3. Create the schema, and optionally seed an admin + a demo facility
npm run db:deploy
SEED_ADMIN_PHONE=+2376XXXXXXXX npm run db:seed

# 4. Run
npm run start:dev
```

- API: http://localhost:3000
- Interactive API docs (Swagger): http://localhost:3000/docs (disabled in production)
- Health check: `GET /health`

With `SMS_PROVIDER=console`, sign-in codes are **printed in the server log** instead of being sent by SMS.

### Scripts

| Command | What it does |
| --- | --- |
| `npm run start:dev` | Run with hot reload |
| `npm run build` / `npm run start:prod` | Compile to `dist/` / run the compiled app |
| `npm test` | Unit tests (triage engine, schedule, geo, scheduling) |
| `npm run test:e2e` | End-to-end API tests. Needs a migrated database in `DATABASE_URL` |
| `npm run lint` / `npm run typecheck` / `npm run format` | Code quality |
| `npm run db:migrate` | Create and apply a new migration after editing `prisma/schema.prisma` |
| `npm run db:deploy` | Apply pending migrations (CI / production) |

---

## Architecture

```
src/
├── auth/            Phone + OTP sign-in, JWT access tokens, rotating refresh tokens
├── users/           /me profile, locale and explicit consents
├── babies/          Baby profiles and the per-age check schedule
├── observations/    Daily wellbeing checks → risk assessment
├── triage/          ★ Rule-based risk engine + check schedule (pure, fully unit-tested)
├── reports/         3-day / 7-day clinician summary
├── facilities/      Facility directory and nearest-facility search
├── clinicians/      Clinician registration, document upload, availability, admin review
├── consultations/   Teleconsultation booking and status workflow
├── storage/         Private file storage (local disk now; S3/GCS later)
├── notifications/   SMS gateway abstraction (console driver now)
├── common/          Auth guards, role decorators, audit interceptor
└── prisma/          Database client
prisma/schema.prisma The full data model
```

Cross-cutting behaviour:
- **Auth by default.** Every route needs a bearer token unless it is marked `@Public()`. `@Roles(...)` restricts a route to `CAREGIVER`, `CLINICIAN` or `ADMIN`.
- **Validation.** Every request body is validated. Unknown fields are rejected.
- **Audit log.** Every successful write is logged with user, route, entity, status and IP. Request bodies are not logged because they can contain health data (PDR §5).
- **Rate limiting.** 120 requests/min in general, 10/min on the auth routes. Separately, there is a per-phone OTP cooldown and an hourly cap on codes.
- **Consent gates.** Recording checks requires data-collection consent. Booking a clinician requires consent to share data with clinicians. Recording a call requires recording consent.

## API overview

| Area | Endpoints |
| --- | --- |
| Auth | `POST /auth/otp/request`, `POST /auth/otp/verify`, `POST /auth/refresh`, `POST /auth/logout` |
| Me | `GET /me`, `PATCH /me`, `PUT /me/consents` |
| Babies | `POST/GET /babies`, `GET/PATCH/DELETE /babies/:id`, `GET /babies/:id/check-schedule` |
| Checks | `POST/GET /babies/:babyId/observations` |
| Reports | `GET /babies/:babyId/summary?days=3\|7` |
| Facilities | `GET /facilities/nearby?lat=&lon=&radiusKm=&service=`, `GET /facilities/:id`, `POST /facilities` (admin) |
| Clinicians | `GET /clinicians`, `GET /clinicians/:id`, `POST/GET/PATCH /clinicians/me`, `POST /clinicians/me/documents`, `PUT /clinicians/me/availability` |
| Admin | `GET /clinicians/review-queue`, `POST /clinicians/:id/review` |
| Consultations | `POST/GET /consultations`, `GET /consultations/:id`, `PATCH /consultations/:id/status` |

Full request and response schemas are in Swagger at `/docs`.

## Triage rules (v0.1.0)

The engine is in `src/triage/risk-engine.ts`. It is deliberately **conservative**: when in doubt, it recommends care (PDR §12). Thresholds are in `DEFAULT_RISK_CONFIG`. Each stored check records the engine version that scored it.

| Result | Triggers |
| --- | --- |
| 🔴 **RED — seek care now** | Temperature ≥ 38.0 °C or < 36.0 °C · convulsions · unable to feed · lethargic · fast or difficult breathing · blue skin · spreading cord redness or pus · bloody stool · high-pitched cry · jaundice on palms/soles, or any jaundice before 24 h · **3 or more Yellow findings together** · **any Yellow finding in a preterm (< 37 wk) or low-birth-weight (< 2.5 kg) baby in the first week** |
| 🟡 **YELLOW — monitor** | 37.5–37.9 °C · 36.0–36.4 °C · reduced feeding or < 8 feeds/24 h · reduced activity · weak or inconsolable cry · pale or mottled skin · jaundice on face/chest · local cord redness or discharge · diarrhoea, reduced stool or no stool |
| 🟢 **GREEN** | None of the above |

Results are returned as stable codes (`FEVER`, `SEEK_CARE_NOW`, …) so the mobile app can show localized text and icons in English, French and local languages. RED responses include the emergency numbers set in `EMERGENCY_PHONE_NUMBERS`.

Check schedule by age: **3 checks/day** under 1 week, **2/day** from 1 week to 3 months, **1/day** after that.

> ⚠️ **Clinical sign-off required.** These rules and thresholds are a starting point based on common newborn danger signs. The partner neonatology team must review and approve them before any real use. Change the rules only together with tests, and bump `RISK_ENGINE_VERSION` each time.

## Roadmap

**Done in this first iteration:** accounts with phone OTP · baby profiles · daily checks with instant triage · age-based check schedule · 3-day/7-day summaries · facility directory with nearest-facility search · clinician registration with the three required documents and admin verification · clinician availability · teleconsultation booking with a pre-visit summary snapshot, commission split and double-booking protection · consents · audit log · CI.

**Next (MVP):**
- [ ] Real SMS gateway for OTPs and alerts, plus SMS fallback (PDR §12)
- [ ] MTN MoMo / Orange Money payments: `Payment` model is ready; needs gateway integration and webhooks
- [ ] Teleconsultation calls: WebRTC provider tokens and chat/file sharing
- [ ] Drug chart API: `DrugChart`/`DrugChartItem` models are ready; needs a clinician prescribing endpoint and a dose reminder calendar
- [ ] Push notifications and reminder scheduler for checks, immunisations and follow-ups
- [ ] PDF export of the clinician summary
- [ ] Neo AI assistant (rule-based tips + small language model) and voice input for mothers with low literacy
- [ ] Data export and deletion endpoints, and a retention job (PDR §9)
- [ ] S3/GCS storage with server-side encryption, and signed URLs for admins to view documents
- [ ] Verified facility dataset for Cameroon (the seed contains only one clearly fake demo facility)

**Near-term:** BLE thermometer input (`TemperatureSource.BLE_THERMOMETER` exists) · offline sync with idempotent uploads · clinician triage inbox · travel-time facility ranking · ratings.
