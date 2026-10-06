# NeoWell — Technology Stack and Assets

| | |
|---|---|
| **Version** | 2.0 |
| **Repositories** | [`Cheneba/neowell-backend`](https://github.com/Cheneba/neowell-backend) (API, docs) · [`Cheneba/neowell-app`](https://github.com/Cheneba/neowell-app) (mobile) |
| **Related** | [05 Background processes](05-background-processes-specification.md) · [07 Front-end design guide](07-frontend-design-guide-v1.0.md) |

---

## 1. Overview

```
 Android / iOS phone                      Cloud (single region, close to Cameroon)
 ┌───────────────────────┐   HTTPS/JSON   ┌──────────────────────────────────────┐
 │ NeoWell app (Expo RN) │ ─────────────▶ │ NeoWell API (NestJS, Docker, ×N)      │──▶ PostgreSQL 16 (managed)
 │  local notifications  │ ◀── push ───── │  cron + Postgres job queue            │──▶ Object storage (S3-compatible)
 │  secure token store   │                │  webhooks                             │──▶ Self-hosted speech-to-text (GPU)
 └───────────┬───────────┘                └───┬──────────┬──────────┬─────────────┘
             │ browser call page (WebRTC)     │          │          │
             ▼                                ▼          ▼          ▼
        LiveKit (Cloud or self-hosted)   Expo Push   SMS gateway   Mobile-money aggregator (MTN MoMo, Orange Money)
```

## 2. Backend (`neowell-backend`)

| Area | Choice | Version | Notes |
|---|---|---|---|
| Runtime | Node.js | 22 LTS (≥ 20.19) | |
| Language | TypeScript | 5.9 | `strict` |
| Framework | NestJS | 11 | Modules per domain; guards for auth and roles |
| HTTP | Express (`@nestjs/platform-express`) | 11 | `helmet`, CORS, raw body for webhooks |
| Database | PostgreSQL | 16 | Managed service in production |
| ORM | Prisma ORM + `@prisma/adapter-pg` (`pg`) | 7.10 | Schema in `prisma/schema.prisma`; SQL migrations in `prisma/migrations` |
| Validation | `class-validator`, `class-transformer` | 0.15 / 0.5 | Global `ValidationPipe` (whitelist, forbid unknown) |
| Config | `@nestjs/config` + `zod` | 4 / 4 | Environment validated at boot |
| Auth | `@nestjs/jwt`, `@nestjs/passport`, `passport-jwt` | 11 / 11 / 4 | Access JWT (HS256) + opaque rotating refresh tokens |
| Rate limiting | `@nestjs/throttler` | 6 | |
| API docs | `@nestjs/swagger` | 11 | `/docs` outside production |
| Scheduling | `@nestjs/schedule` | 6 | Cron jobs J1–J10 |
| Queue | Own Postgres queue (`Job` table, `SKIP LOCKED`) | — | No Redis needed (doc 05) |
| Uploads | `multer` (memory storage) | 2 | Size/type limits per endpoint |
| PDF | `pdfkit` | 0.20 | Summary PDF (FR-RPT-02) |
| Video/audio calls | `livekit-server-sdk` | 2.19 | Access tokens + webhook verification |
| Growth standards | WHO Child Growth Standards LMS tables (`src/growth/who-lms.json`) | 2006 | Generated from the `pygrowup` tables (BSD, UNICEF) |
| Testing | Jest 29, `ts-jest`, Supertest 7, `@nestjs/testing` | | Unit + e2e against real Postgres |
| Lint/format | ESLint 9 + `typescript-eslint`, Prettier 3 | | |
| Container | Docker (node:22-alpine, multi-stage) | | `Dockerfile`, `docker-compose.yml` (Postgres for dev) |
| CI | GitHub Actions | | lint · typecheck · build · unit · migrate · e2e |

## 3. Mobile app (`neowell-app`)

| Area | Choice | Version | Notes |
|---|---|---|---|
| Framework | Expo SDK | 57 | Managed workflow (Continuous Native Generation) |
| UI runtime | React Native / React | 0.86 / 19.2 | React Compiler enabled |
| Language | TypeScript | 6.0 | `strict` |
| Navigation | Expo Router | 57 | File-based routes in `src/app`, `Stack.Protected` guards |
| Secure storage | `expo-secure-store` | 57 | Tokens, settings (localStorage on web preview) |
| Location | `expo-location` | 57 | Nearest facilities |
| Localization | `expo-localization` + own i18n | 57 | EN/FR, plural-aware, type-checked |
| Notifications | `expo-notifications` | 57 | Push (Expo push token) + local reminders/alarms |
| Camera/gallery | `expo-image-picker` | 57 | Chat photos, check photos, clinician photo/documents |
| Documents | `expo-document-picker` | 57 | Clinician PDF documents |
| Audio | `expo-audio` | 57 | Voice notes in the unwell flow |
| Images | `expo-image` | 57 | |
| Browser | `expo-web-browser` | 57 | Opens the secure call page |
| Icons | `@expo/vector-icons` (Ionicons) | 15 | |
| Font | Nunito (`@expo-google-fonts/nunito`) | 0.4 | Rounded, matches the logo |
| Testing | `jest-expo`, Jest | 57 / 29 | |
| Lint | `eslint-config-expo` | 57 | |
| Builds | EAS Build / EAS Submit | — | Android first (Play Store), development builds for push testing |

## 4. Third-party services

| Service | Used for | Status | Cost model | Notes |
|---|---|---|---|---|
| **Expo Push** | Push notifications | Ready (needs an EAS project id for real devices) | Free | Push needs a development/production build. Expo Go supports local notifications only. |
| **SMS gateway** | OTP codes, critical fallbacks | Interface ready; console driver in dev | Per SMS | Choose a local Cameroonian aggregator (better delivery and price on MTN/Orange) or Twilio. Must support alphanumeric sender "NeoWell". |
| **Mobile-money aggregator** | Collections and refunds (MTN MoMo, Orange Money) | Adapter interface + sandbox ready; live adapter to be written against the chosen aggregator's API | % per transaction | Candidates: aggregators certified for both MTN and Orange in Cameroon (e.g. Campay, CinetPay, Notch Pay). Requires a registered business account. |
| **LiveKit** | Audio/video calls | Implemented (tokens, webhooks, call page) | LiveKit Cloud free tier, then usage-based; or self-host (open source) | Self-hosting keeps call media in our region. |
| **Speech-to-text (self-hosted)** | Voice notes (FR-VOICE) | Implemented client; server to deploy | GPU server, fixed monthly cost | Run `faster-whisper` behind an OpenAI-compatible API (e.g. Speaches) with the `small` or `medium` multilingual model. No per-request API fees (meeting decision). |
| **Object storage** | Documents, photos, voice notes | Local-disk driver now; S3-compatible driver next | Per GB | AWS S3 / Cloudflare R2 with server-side encryption; private bucket. |
| **Hosting** | API + Postgres | — | Monthly | Render or Railway for the pilot; move to AWS/GCP (af-south-1 / europe-west) for scale. Data residency to confirm (NFR-PRIV-03). |
| **Maps** | Facility locations | GPS + own distance ranking | Free | Travel-time ranking later (OpenStreetMap/OSRM or Google Distance Matrix). |
| **jsDelivr CDN** | `livekit-client` script on the call page | In use | Free | Pinned version. |

## 5. Assets

| Asset | Location | Notes |
|---|---|---|
| Logo (full: mark + "NeoWell" + tagline) | `neowell-app/assets/images/logo.png`, `logo-small.png` | Provided by the product owner |
| App icon, adaptive icon (foreground, background, monochrome), splash, favicon | `neowell-app/assets/images/` | Generated from the "nw" mark with heart |
| Brand colours | `neowell-app/src/theme/index.ts` | Blue `#62A6EA`, pink `#F0849F`, white; deep text variants `#2C6CB5`, `#C2446A` |
| Font | Nunito 400/600/700/800 | Google Fonts, OFL licence |
| Icons | Ionicons | MIT |
| WHO growth standard tables | `neowell-backend/src/growth/who-lms.json` | Weight/length/HC-for-age, boys and girls, weekly 0–13 w and monthly 0–60 m (length 0–24 m) |
| Question bank (check questions, EN/FR) | `neowell-backend/src/checks/question-bank.ts` | Versioned with the triage engine |
| Translations (findings, actions, UI) | `neowell-app/src/i18n/en.ts`, `fr.ts` | Type-checked for completeness |
| Newborn care tips (EN/FR) | `neowell-app/src/content/tips.ts` | Bundled content |
| Screenshots | `neowell-app/docs/screenshots.png` | |
| Clinical knowledge base | — | **Awaiting the product owner's spreadsheet** (FR-KB) |

## 6. Environments

| Environment | API | Database | Payments | Calls | Speech-to-text |
|---|---|---|---|---|---|
| Local | `npm run start:dev` | Docker Postgres | SANDBOX | optional LiveKit dev server | optional |
| Staging | Render/Railway | Managed Postgres | SANDBOX / aggregator test mode | LiveKit Cloud (free) | small CPU model |
| Production | Container service ×2+ | Managed Postgres + backups (PITR) | Live aggregator | LiveKit | GPU server |

## 7. Environment variables (backend)

See `.env.example`. Groups:
- server: `NODE_ENV`, `PORT`, `CORS_ORIGINS`, `PUBLIC_BASE_URL`
- database: `DATABASE_URL`
- auth: `JWT_*`, `OTP_*`
- SMS: `SMS_PROVIDER`
- storage: `STORAGE_*`, `FILE_URL_SECRET`, `MAX_UPLOAD_MB`
- business: `PLATFORM_COMMISSION_PERCENT`, `EMERGENCY_PHONE_NUMBERS`
- payments: `PAYMENT_PROVIDER`, `PAYMENTS_WEBHOOK_SECRET`
- calls: `LIVEKIT_*`
- speech: `STT_URL`, `STT_MODEL`
- push: `EXPO_ACCESS_TOKEN`
- jobs: `JOBS_ENABLED`, `JOBS_POLL_MS`

## 8. Licences and compliance notes

- All libraries are MIT/Apache/BSD/OFL. The WHO growth standards may be used freely with attribution.
- Before production: sign-off of clinical content (NFR-SAFE-02), data-processing agreements with hosting/SMS/payment providers, and confirmation of data residency with health authorities.
