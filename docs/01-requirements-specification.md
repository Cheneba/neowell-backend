# NeoWell — Requirements Specification

| | |
|---|---|
| **Version** | 2.0 |
| **Status** | Approved for implementation; clinical rules pending sign-off (see §6) |
| **Sources** | NeoWell Preliminary Design Review (PDR); product meeting with the clinical lead (transcripts 1 and 2); NeoWell v1 build |
| **Related** | [02 Database schema](02-database-schema-specification.md) · [04 API](04-api-endpoint-specification.md) · [05 Background processes](05-background-processes-specification.md) · [07 Front-end design guide](07-frontend-design-guide-v1.0.md) |

---

## 1. Purpose and scope

Many mothers in Cameroon leave hospital with little support for spotting danger signs in their newborn. As a result, they recognise illness late and reach care late. Neonatal mortality was about 25 per 1,000 live births in 2023.

**NeoWell** is a mobile app and API. It lets caregivers:
- monitor a baby at home with guided checks
- get an immediate **Green / Yellow / Red** triage result with safe advice
- find the nearest facility that can care for newborns
- consult a verified paediatric or neonatal clinician by chat, audio or video, paid with mobile money

Clinicians get a structured pre-visit summary. The platform earns a commission on consultations.

**In scope for v2:** everything in this document unless it is marked *Planned*.

**Out of scope for v2:**
- an admin web dashboard (admins use the API through Swagger)
- Bluetooth (BLE) thermometers
- full offline sync of every screen (only checks are queued offline)
- local languages other than English and French
- in-app native video (v2 opens a secure call page in the phone's browser)

## 2. Users and roles

| Role | Who | Main goals |
|---|---|---|
| **Caregiver** | Mother or other caregiver. Primary persona: discharged from Regional Hospital Bamenda, limited time, intermittent internet. | Check the baby daily, act early on danger signs, reach a clinician quickly. |
| **Clinician** | Paediatrician, neonatologist or other licensed doctor offering paid consultations. | Get verified, set availability and fees, consult with good information, refer when needed, get paid. |
| **Admin** | NeoWell operations staff. | Verify clinicians, maintain the facility directory, run payouts, support users. |
| *Nurse (assisting)* | Maternity or KMC nurse helping a mother install the app and enter birth data before discharge. | No account of their own: they use the mother's phone. |

## 3. Glossary

| Term | Meaning |
|---|---|
| **42-day rule** | Until 42 days of life (end of the postnatal period), hospitals file a baby under the mother's name, e.g. "Baby Christian". |
| **Display name** | Name the app shows for a baby. It follows the 42-day rule (FR-BABY-02). |
| **Term / preterm** | Gestational age at birth: term = 37–41 weeks; preterm = under 37 weeks (WHO). Sub-groups: extremely < 28, very 28–31, moderate/late 32–36; post-term ≥ 42. |
| **LBW** | Low birth weight, < 2,500 g. VLBW < 1,500 g; ELBW < 1,000 g. |
| **HC** | Head circumference, written "HC" in hospital booklets. |
| **KMC** | Kangaroo Mother Care: hospital-based care for preterm/LBW babies, usually until about 2.5 kg. |
| **Corrected age** | For preterm babies: chronological age minus (40 − gestational weeks). Used for growth until 24 months. |
| **Routine check** | Scheduled wellbeing check (3, 2 or 1 per day by age). |
| **Unwell check** | Check started by the caregiver because the baby seems ill now. |
| **Recheck** | Follow-up temperature check requested by the triage engine, e.g. 30 minutes after cooling steps. |
| **Medium** | Consultation channel: CHAT, AUDIO or VIDEO. |

## 4. Functional requirements

Each requirement has an ID that the API and background-process specs refer to. **Priority** is M (must, v2), S (should, v2) or P (planned, after v2).

### 4.1 Authentication — AUTH

| ID | Requirement | Pri |
|---|---|---|
| FR-AUTH-01 | Users sign in with a phone number (E.164) and a 6-digit SMS code (OTP). Codes expire after 5 minutes and allow 5 attempts. Resend has a 30 s cooldown, with at most 5 codes per hour per number. | M |
| FR-AUTH-02 | Sessions use a 15-minute access token plus a 30-day refresh token. Refresh rotates the token; reuse of a rotated token revokes every session of that user. | M |
| FR-AUTH-03 | On first sign-in the user chooses Caregiver or Clinician. Admin can never be self-assigned. | M |
| FR-AUTH-04 | Sign-out revokes the refresh token. | M |
| FR-AUTH-05 | Deactivated or deleted accounts cannot sign in or use existing tokens. | M |

### 4.2 Account and profile — ACC

| ID | Requirement | Pri |
|---|---|---|
| FR-ACC-01 | Caregivers must complete a profile before using the app: **first name and last name (required)**, language (en/fr), optional region and city. Doctors use the mother's name for referral and diagnosis (meeting decision). | M |
| FR-ACC-02 | Explicit, withdrawable consents with timestamps: (a) storing the baby's checks, required to record checks; (b) sharing data with clinicians the caregiver books, required to book; (c) recording calls, optional. | M |
| FR-ACC-03 | A caregiver can export all their data (profile, babies, measurements, checks, consultations) as JSON. | M |
| FR-ACC-04 | A caregiver can delete their account. Access ends immediately and data is purged after 30 days. Consultation records needed for clinical continuity are kept with the caregiver's identity removed. | M |
| FR-ACC-05 | Each device registers for push notifications. A user may have several devices. | M |
| FR-ACC-06 | An in-app notification inbox lists notifications and lets the user mark them read. | M |
| FR-ACC-07 | Users can edit their profile and language at any time. | M |

### 4.3 Baby profile — BABY

| ID | Requirement | Pri |
|---|---|---|
| FR-BABY-01 | Creating a baby **requires**: sex, date of birth, gestational age at birth (weeks, 22–44), **birth weight (g)**, **birth length (cm)** and **birth head circumference "HC" (cm)**. The form explains each value and that it is in the hospital booklet. The given name is **optional**. Birth facility (picked from the directory or typed), care status and discharge date are optional. *(Meeting: weight must not be optional; length and HC must be collected.)* | M |
| FR-BABY-02 | **Display name (42-day rule).** Under 42 days the baby is shown as "Baby {mother's last name}". If the caregiver has more than one baby under 42 days (e.g. twins), they become "Baby {last name} 1", "… 2" in birth order. From 42 days the given name is shown if set; otherwise the "Baby …" name stays and the app asks for a name. Clinicians always see the display name and the given name. | M |
| FR-BABY-03 | The system classifies term status (extremely / very / moderate-late preterm, term, post-term) and birth-weight category (ELBW, VLBW, LBW, normal, high > 4,000 g). | M |
| FR-BABY-04 | **Risk factors.** Preterm (< 37 w), LBW, and birth length or HC outside the normal WHO range (FR-MEAS-04) are shown as "needs extra care" with plain-language reasons. The triage engine uses them (FR-CHK-06). | M |
| FR-BABY-05 | **Hospital / KMC mode.** If care status is IN_HOSPITAL or KANGAROO_CARE: routine home checks and reminders are paused; the app shows KMC guidance and a weight log; recording "discharged" switches the baby to AT_HOME and starts home checks. *(Meeting: preterm babies stay in KMC until ~2.5 kg; home follow-up starts at discharge.)* | M |
| FR-BABY-06 | For preterm babies the app shows corrected age next to actual age until 24 months corrected age. | M |
| FR-BABY-07 | Caregivers can edit or remove a baby. Removal is soft-deleted, then purged by the retention job. | M |
| FR-BABY-08 | A caregiver can have several babies. | M |

### 4.4 Measurements and growth — MEAS

| ID | Requirement | Pri |
|---|---|---|
| FR-MEAS-01 | Caregivers record new measurements (weight, length, HC — at least one), with date, source (birth, hospital, clinic, home) and a note. | M |
| FR-MEAS-02 | The birth measurements entered at registration are stored as the first measurement (source BIRTH). | M |
| FR-MEAS-03 | The update form is pre-filled with the latest values, so a caregiver only changes what the hospital re-measured. A history of measurements is shown. *(Meeting: values must be updatable after hospital visits.)* | M |
| FR-MEAS-04 | **Growth assessment** uses the WHO Child Growth Standards: weight-for-age, length-for-age and head-circumference-for-age z-scores by sex and age (corrected age for preterm babies). \|z\| > 2 → *outside the usual range, show to a health worker*; \|z\| > 3 → *far outside the usual range, consult soon*. The app never names a condition. | M |
| FR-MEAS-05 | Weight more than 10% below birth weight in the first 14 days is flagged *(excess early weight loss)*. | M |

### 4.5 Checks and triage — CHK

| ID | Requirement | Pri |
|---|---|---|
| FR-CHK-01 | **Schedule.** Routine checks per day by age: < 7 days → 3; 7 days – 3 months → 2; ≥ 3 months → 1, each with reminder times. Paused while the baby is in hospital or KMC. | M |
| FR-CHK-02 | **Check plan.** Routine questions come from a server-side question bank, so content can grow without an app release. Every routine check has **core** questions: temperature (required), feeding, feeds in 24 h, breathing, activity, fits/twitching. It also has **up to 3 rotating questions**: skin colour, jaundice, cry, stool, cord (until day 21), vomiting, chest indrawing, breathing sounds. Rotating questions are chosen least-recently-answered first, so anything not asked today comes up next. *(Meeting: rotate questions to keep each check short.)* | M |
| FR-CHK-03 | **"My baby is unwell now".** A separate flow, reachable at any time. The caregiver picks one or more complaints (fever, feels cold, crying a lot, not crying/weak, not feeding, breathing problem, twitching/fits, vomiting, diarrhoea, yellow skin/eyes, skin colour change, cord problem, other) and may type or record a description. The follow-up questions are those relevant to the chosen complaints, with temperature always required. *(Meeting: emergency section separate from routine; questions follow the complaint.)* | M |
| FR-CHK-04 | **Temperature context.** When temperature ≥ 37.5 °C or < 36.5 °C, or the complaint is fever or feels cold, the app also asks how the room feels (cold/comfortable/hot) and how the baby is dressed (light/normal/heavy or wrapped in blankets). *(Meeting: overdressing and hot weather explain many raised temperatures.)* | M |
| FR-CHK-05 | **Breath counter.** A guided 60-second counter: the caregiver taps once per breath while the baby is calm or asleep. The rate is stored. Chest indrawing and breathing sounds (wheezing, grunting, noisy/obstructed) are separate questions. | M |
| FR-CHK-06 | **Triage.** Each check is scored by the versioned rule engine (§6) into GREEN / YELLOW / RED, with finding codes and action codes. The result, the engine version and all inputs are stored. | M |
| FR-CHK-07 | **No home medicines for newborns.** For babies under 42 days, every YELLOW or RED result tells the caregiver not to give any medicine, syrup or herbal/traditional mixture, and to go to a health facility. *(Meeting: newborns' livers cannot process oral drugs; "country mixtures" are a known risk.)* | M |
| FR-CHK-08 | **Fever steps and recheck.** For a moderate fever where the rules allow home steps first (§6.2), the result shows cooling steps: remove extra clothing, cool the room, sponge the body and limbs with lukewarm water. A **recheck** is created 30 minutes later, with a reminder. If the recheck is still ≥ 38 °C, the result becomes RED. | M |
| FR-CHK-09 | **Seizure education.** The fits question explains that in babies, seizures look like twitching, jerking of a limb, lip-smacking, staring or "cycling" legs, not the adult kind. Any fits → RED. | M |
| FR-CHK-10 | Every RED result shows "Go to a health facility now", the configured emergency numbers and a link to the nearest facilities. | M |
| FR-CHK-11 | Checks can be recorded offline and sent later. Each check carries a client reference so a re-send never creates a duplicate. | M |
| FR-CHK-12 | An optional photo (e.g. skin, cord, stool) can be attached to a check. | S |
| FR-CHK-13 | Caregivers can see the check history with results and findings. | M |

### 4.6 Voice — VOICE

| ID | Requirement | Pri |
|---|---|---|
| FR-VOICE-01 | In the unwell flow a caregiver can record a voice note (≤ 60 s) describing the problem, for mothers who find reading or typing hard. | S |
| FR-VOICE-02 | Voice notes are transcribed by a **self-hosted** speech-to-text service. Complaint keywords (English and French) are detected and suggested as complaints. With no service configured, the note is kept and shown to clinicians as audio. *(Meeting: hosted LLM APIs cost about $0.5–1 per user per day; models must be self-hosted.)* | S |
| FR-VOICE-03 | No per-request third-party AI API is used for core features. | M |

### 4.7 Reports — RPT

| ID | Requirement | Pri |
|---|---|---|
| FR-RPT-01 | 3-day and 7-day summary: baby details and risk factors, latest measurements and growth flags, check counts by result, temperature range, finding counts, and every check. | M |
| FR-RPT-02 | The same summary as a PDF download. | M |

### 4.8 Facilities — FAC

| ID | Requirement | Pri |
|---|---|---|
| FR-FAC-01 | Nearest newborn-capable facilities (neonatology/paediatrics by default) by GPS within a radius, with department helplines. | M |
| FR-FAC-02 | Searching facilities by name (used to pick the birth facility). | M |
| FR-FAC-03 | Admins create, edit and deactivate facilities and their departments. | M |

### 4.9 Clinicians — CLIN

| ID | Requirement | Pri |
|---|---|---|
| FR-CLIN-01 | A clinician profile has: title, first and last name, licence number, specialties, bio, current facility, years of experience, **profile photo (required for verification)**, the media offered, and a **fee per medium** (chat < audio < video recommended). | M |
| FR-CLIN-02 | Clinicians upload a medical licence, a medical degree and proof of current/recent employment. With all three present, the profile moves to review. | M |
| FR-CLIN-03 | Admins review clinicians (verify / reject / suspend) and view their documents through short-lived links. Only verified, active clinicians are listed or bookable. | M |
| FR-CLIN-04 | Clinicians set weekly availability windows and can switch "available now" on for up to 4 hours, for ASAP consultations. | M |
| FR-CLIN-05 | **Public profile** shows title, first name and last initial, photo, verified badge, specialties, experience, rating and fees. It **never shows phone or email**. *(Meeting: trust needs face + credentials; contact details stay private.)* | M |
| FR-CLIN-06 | Clinicians see their consultation inbox (requests, upcoming, active, past) and earnings (pending, paid). | M |
| FR-CLIN-07 | Clinicians set a mobile money number for payouts (visible to admins only). | M |

### 4.10 Consultations — CONS

| ID | Requirement | Pri |
|---|---|---|
| FR-CONS-01 | **Booking.** Choose baby, clinician, medium (CHAT/AUDIO/VIDEO), timing (a slot in the clinician's availability, or **ASAP** with an "available now" clinician), reason, and optionally the check that prompted it. | M |
| FR-CONS-02 | **Fee** is the clinician's fee for the medium. Platform commission is a configurable % (default 15). Fee, commission and clinician earning are fixed at booking. | M |
| FR-CONS-03 | **Pay first.** A booking starts as AWAITING_PAYMENT. Paying with MTN MoMo or Orange Money moves it to REQUESTED and notifies the clinician. Unpaid bookings are cancelled after 30 minutes. | M |
| FR-CONS-04 | **Accept or decline.** The clinician must accept before the slot starts (scheduled) or within 15 minutes (ASAP). Otherwise the request EXPIRES and is refunded. A decline is refunded. | M |
| FR-CONS-05 | **Pre-consultation checklist.** For fever-related bookings, before paying, the caregiver confirms what was tried: clothes removed, room cooled, lukewarm sponging, temperature rechecked. The answers go to the clinician. *(Meeting: "Have you done this already?")* | M |
| FR-CONS-06 | **Pre-visit summary.** On payment, a 7-day summary is attached. It opens the chat as a REPORT message. | M |
| FR-CONS-07 | **Chat** (text and photos) is open from CONFIRMED until 24 h after completion, for every medium. | M |
| FR-CONS-08 | **Contact masking.** Phone numbers, e-mail addresses and messaging/social links in chat are replaced by "[contact hidden]", and the message is flagged. Phone numbers are never returned by the API to the other party. *(Meeting: no offline/phone calls, for privacy and to stop bypassing the platform.)* | M |
| FR-CONS-09 | **Calls.** For AUDIO/VIDEO, each participant gets a short-lived call link from 10 minutes before the start until completion. v2 opens a secure call page in the phone browser (WebRTC). Calls are not recorded in v2. | M |
| FR-CONS-10 | **Lifecycle.** Clinician actions: accept → start → complete (notes + diagnosis summary), decline, no-show. Caregiver cancels: full refund if ≥ 1 h before start or still REQUESTED; no refund later. Clinician cancellations are always refunded. | M |
| FR-CONS-11 | **Referral.** The clinician can refer the baby to a facility with an urgency (emergency, same day, routine) and a reason. The caregiver sees it with the facility's helplines and a short referral code to show at the hospital. | M |
| FR-CONS-12 | **Drug chart.** The clinician can attach a drug chart (drug, dose, route, times of day, duration, instructions). | M |
| FR-CONS-13 | **Review.** After completion the caregiver can rate (1–5) and comment once. The clinician's average rating updates. | M |
| FR-CONS-14 | **Earnings and payouts.** Completed, paid consultations become clinician earnings. A weekly job groups them into payouts, which admins mark as paid. | M |

### 4.11 Payments — PAY

| ID | Requirement | Pri |
|---|---|---|
| FR-PAY-01 | Collect XAF payments from a mobile money number (MTN MoMo, Orange Money) through a certified aggregator. Status goes PENDING → PAID / FAILED via webhook, with polling as backup. | M |
| FR-PAY-02 | Refunds are sent back to the payer's number through the aggregator. | M |
| FR-PAY-03 | Webhooks are signature-checked, stored, and processed idempotently. | M |
| FR-PAY-04 | A **sandbox** provider confirms payments automatically, for development and testing. | M |

### 4.12 Medication — DRUG

| ID | Requirement | Pri |
|---|---|---|
| FR-DRUG-01 | Caregivers see active drug charts per baby. | M |
| FR-DRUG-02 | The app schedules **local alarms** for every dose time for the chart's duration, which also works offline. | M |
| FR-DRUG-03 | Caregivers mark each dose as given or skipped. Clinicians see the log. | M |

### 4.13 Notifications — NOT

| ID | Requirement | Pri |
|---|---|---|
| FR-NOT-01 | Push notifications for: consultation requested/accepted/declined/expired/starting soon, new chat message, recheck due, referral created, payment result, day-42 naming prompt. | M |
| FR-NOT-02 | Routine-check reminders and dose alarms are **local** notifications scheduled on the device, so they work without internet. | M |
| FR-NOT-03 | Critical notifications (consultation accepted/starting soon, recheck due) fall back to **SMS** when the user has no push device. | S |
| FR-NOT-04 | All notifications are stored in the user's inbox (FR-ACC-06). | M |
| FR-NOT-05 | Caregivers of babies under 28 days with no check in 24 h get a gentle push nudge. | S |

### 4.14 Education — TIP

| ID | Requirement | Pri |
|---|---|---|
| FR-TIP-01 | Home shows a daily newborn-care tip for the baby's age, in the user's language (bundled content). | S |

### 4.15 Administration — ADM

| ID | Requirement | Pri |
|---|---|---|
| FR-ADM-01 | Clinician review queue and decisions (FR-CLIN-03). | M |
| FR-ADM-02 | Facility management (FR-FAC-03). | M |
| FR-ADM-03 | Payouts: list, mark paid with reference. | M |
| FR-ADM-04 | Suspend or reactivate any user. | M |
| FR-ADM-05 | Platform statistics: users, babies, checks by result, consultations by status, revenue. | S |

### 4.16 Audit — AUD

| ID | Requirement | Pri |
|---|---|---|
| FR-AUD-01 | Every successful write is logged (user, action, entity, status, IP), never with request bodies. | M |
| FR-AUD-02 | Clinician reads of a consultation (and so of a baby's data) are logged. | M |

### 4.17 Clinical knowledge base — KB *(Planned, awaiting product owner input)*

| ID | Requirement | Pri |
|---|---|---|
| FR-KB-01 | Import the product owner's spreadsheet, with one row per condition affecting newborns/children in Cameroon. Columns: condition · how it is identified · can the mother identify it · managed at home or in hospital · home remedies · severity. | P |
| FR-KB-02 | Use the knowledge base to drive unwell-flow follow-up questions and condition-specific advice, mapped to question-bank fields. All content is clinically signed off before release. | P |

## 5. Non-functional requirements

| ID | Category | Requirement |
|---|---|---|
| NFR-SEC-01 | Security | TLS everywhere; HSTS and security headers; JWT secrets ≥ 32 chars; OTPs stored as HMACs, refresh tokens as SHA-256 hashes. |
| NFR-SEC-02 | Security | Role- and ownership-based access on every endpoint. A caregiver only reaches their own babies; a clinician only reaches babies in their own consultations. |
| NFR-SEC-03 | Security | Personal health information encrypted at rest (managed Postgres disk encryption; object storage with server-side encryption). Files are only served through signed links that expire in ≤ 10 minutes. |
| NFR-SEC-04 | Security | Rate limits: 120 requests/min per IP generally; 10/min on auth routes. Inputs validated, unknown fields rejected. |
| NFR-SEC-05 | Security | Webhooks verified by signature. Unverified events are stored but never acted on. |
| NFR-PRIV-01 | Privacy | Collect the minimum data. Consent before collection and sharing. Users can export and delete their data. |
| NFR-PRIV-02 | Privacy | Phone numbers and e-mails are never exposed between caregiver and clinician; chat contact details are masked. |
| NFR-PRIV-03 | Privacy | Hosting region and data-residency to be confirmed with Cameroonian health authorities before launch. |
| NFR-SAFE-01 | Clinical safety | Triage is conservative (escalate when unsure), deterministic, versioned and unit-tested. Every rule change bumps the engine version. |
| NFR-SAFE-02 | Clinical safety | Rules and advice text need written sign-off from the clinical lead before production. |
| NFR-SAFE-03 | Clinical safety | Every result screen carries the disclaimer; every RED result carries emergency guidance. The app never names a diagnosis. |
| NFR-PERF-01 | Performance | p95 latency < 500 ms for core endpoints at 1,000 concurrent users. A check submission is < 10 KB. |
| NFR-PERF-02 | Low bandwidth | Images compressed on device (≤ 1,280 px, JPEG ~0.6, typically < 300 KB). Lists are paginated. Chat polls (≤ 1 request / 5 s while open) instead of streaming. |
| NFR-OFF-01 | Offline | Checks can be recorded offline (FR-CHK-11). Reminders and dose alarms are local. |
| NFR-AVAIL-01 | Availability | 99.5% monthly for the API. Stateless API instances scale horizontally. Background jobs survive restarts (Postgres queue). |
| NFR-OBS-01 | Observability | Health endpoint; structured logs; audit log; a failed-jobs view. |
| NFR-A11Y-01 | Accessibility | Touch targets ≥ 48 px (primary 56 px). Body text ≥ 16 px. WCAG AA contrast. Results always shown as colour + icon + text. Screen-reader labels on all controls. |
| NFR-I18N-01 | Languages | English and French, complete and type-checked. Local languages planned. |
| NFR-COMPAT-01 | Devices | Android 8+ on low-end phones (2 GB RAM) first; iOS supported. |
| NFR-COST-01 | Cost | No per-request paid AI APIs. Self-hosted speech-to-text. Push notifications through free Expo push; SMS only as fallback. |
| NFR-MAINT-01 | Maintainability | TypeScript end to end. Lint, type check, unit and end-to-end tests in CI on every change. |

## 6. Clinical rules — triage engine v0.2 *(pending clinical sign-off)*

Rules are applied in order. The overall result is the most severe finding, with the composite rules applied last. Codes are stable identifiers; the app maps them to translated text.

### 6.1 Danger signs → RED

| Code | Condition |
|---|---|
| FEVER_VERY_HIGH | Temperature ≥ 40.0 °C (also adds WATCH_FOR_FITS) |
| FEVER_YOUNG_INFANT | Temperature ≥ 38.0 °C and age < 90 days |
| FEVER_HIGH | Temperature 39.0–39.9 °C, age ≥ 90 days |
| FEVER_PERSISTENT | Recheck after cooling steps still ≥ 38.0 °C |
| HYPOTHERMIA_SEVERE | Temperature < 36.0 °C |
| CONVULSIONS | Fits / twitching reported |
| UNABLE_TO_FEED | Feeding = unable |
| LETHARGIC | Very sleepy, hard to wake |
| DIFFICULT_BREATHING | Breathing = struggling |
| FAST_BREATHING | Rate ≥ 60/min (or "fast") and age < 60 days |
| SLOW_BREATHING | Rate < 30/min (age < 12 months) or < 20/min (≥ 12 months) |
| CHEST_INDRAWING | Chest pulls in with each breath |
| GRUNTING / NOISY_BREATHING | Breathing sound = grunting / noisy (obstruction) |
| CYANOSIS | Blue lips or skin |
| JAUNDICE_SEVERE / JAUNDICE_EARLY | Yellow palms/soles; any yellow skin before 24 h of age |
| CORD_INFECTION_SEVERE | Spreading redness or pus |
| BLOODY_STOOL | Blood in stool |
| HIGH_PITCHED_CRY | High-pitched cry |
| VOMITING_GREEN_OR_FORCEFUL | Forceful or green vomiting |

### 6.2 Early concerns → YELLOW

| Code | Condition |
|---|---|
| FEVER_MODERATE | 38.0–38.9 °C, age ≥ 90 days, first reading → actions COOLING_STEPS + RECHECK_TEMP_30_MIN (creates a Recheck) |
| TEMPERATURE_RAISED | 37.5–37.9 °C (adds OVERHEATING_LIKELY when the room is hot or clothing is heavy; creates a Recheck) |
| HYPOTHERMIA_MILD | 36.0–36.4 °C |
| FAST_BREATHING_INFANT | Rate ≥ 50/min (2–12 months) or ≥ 40/min (≥ 12 months), or "fast" at ≥ 60 days |
| WHEEZING | Breathing sound = wheezing |
| FEEDING_REDUCED / FEEDING_INFREQUENT | Feeding less; < 6 feeds in 24 h under 3 months *(clinical lead: "at least 6"; advice still aims for 8–12)* |
| ACTIVITY_REDUCED · WEAK_CRY · INCONSOLABLE_CRY · NOT_CRYING | As named *(meeting: not crying at all is also a problem)* |
| PALLOR · MOTTLED_SKIN · FLUSHED_SKIN | Skin colour |
| JAUNDICE / PROLONGED_JAUNDICE | Face/chest jaundice; any jaundice after 14 days of age |
| CORD_INFECTION_LOCAL | Cord red or oozing |
| DIARRHEA · NO_STOOL · STOOL_REDUCED · VOMITING_REPEATED | As named |

### 6.3 Composite rules

| Code | Rule |
|---|---|
| MULTIPLE_CONCERNS | ≥ 3 YELLOW findings → RED |
| HIGH_RISK_BABY_WITH_CONCERN | Any YELLOW finding in a preterm or LBW baby in the first 7 days → RED. For very preterm (< 32 weeks) or VLBW babies, the window is the first 28 days. |

### 6.4 Actions

`SEEK_CARE_NOW`, `SHOW_EMERGENCY_NUMBERS`, `SHOW_NEAREST_FACILITIES`, `NO_HOME_MEDICINES` (under 42 days, any non-GREEN), `COOLING_STEPS`, `REMOVE_EXTRA_CLOTHING`, `COOL_ROOM`, `RECHECK_TEMP_30_MIN`, `WATCH_FOR_FITS`, `WARM_SKIN_TO_SKIN`, `WARM_SKIN_TO_SKIN_ON_THE_WAY`, `KEEP_BREASTFEEDING_IF_ABLE`, `FEED_MORE_OFTEN`, `KEEP_CORD_CLEAN_AND_DRY`, `CHECK_JAUNDICE_IN_DAYLIGHT`, `RECHECK_IN_HOURS`, `CONSIDER_TELECONSULT`, `CONTINUE_ROUTINE_CARE`.

### 6.5 Points for the clinical lead to confirm

1. **Fever in young infants.** WHO guidance treats any fever under 2–3 months as a reason to seek care, so v0.2 makes it RED with cooling steps done *on the way*. The "cool, then recheck in 30 minutes" path applies from 3 months.
2. **Lukewarm sponging** is included at the clinical lead's request. WHO does not recommend sponging as a fever treatment, so the advice wording should be confirmed.
3. **Minimum feeds** is set to 6 per 24 h, per the clinical lead.
4. **Preterm definition** uses WHO < 37 weeks. The meeting mentioned < 36.
5. **Growth flags** use WHO ± 2 / ± 3 SD. The meeting's "HC 30–35 cm" matches the WHO birth range (girls 31.5–36.2, boys 31.9–37.0).

## 7. Meeting decisions — traceability

| Decision from the meeting | Requirement(s) |
|---|---|
| Doctor refers to the mother by her name; mother gives first and last name | FR-ACC-01 |
| Baby called "Baby {mother}" until 42 days; numbered when several | FR-BABY-02, FR-NOT-01 (day-42 prompt) |
| Birth weight is mandatory (LBW < 2,500 g is a key risk) | FR-BABY-01, FR-BABY-04 |
| Length and HC collected from the hospital booklet; abbreviation "HC" explained | FR-BABY-01 |
| Measurements updatable after re-measuring; shown pre-filled | FR-MEAS-01..03 |
| Abnormal measurements flag a possible abnormality | FR-MEAS-04 |
| Nurse helps the mother install the app and fill the data at the hospital | §2 roles, FR-BABY-01 helper text |
| Temperature is the key, mandatory vital (axillary) | FR-CHK-02 |
| Separate emergency ("unwell") flow with complaint-specific questions | FR-CHK-03 |
| Rotate questions across checks | FR-CHK-02 |
| Count breaths (normal top 60); fast and slow both a problem; chest indrawing; breath sounds | FR-CHK-05, §6 |
| Ask about environment heat and clothing before concluding fever | FR-CHK-04 |
| Cooling steps and "have you done this?" before seeking a clinician | FR-CHK-08, FR-CONS-05 |
| Infant seizures look like twitches | FR-CHK-09 |
| No oral medicines or herbal mixtures under 42 days; go to hospital | FR-CHK-07 |
| Audio AI via self-hosted model, not paid LLM APIs | FR-VOICE-02, NFR-COST-01 |
| Consultation media: text, audio call, video call; price varies by medium | FR-CONS-01, FR-CONS-02, FR-CLIN-01 |
| Chat can start from the system's report and include photos | FR-CONS-06, FR-CONS-07 |
| Video for emergencies (doctor guides first aid on the way) | FR-CONS-01 (ASAP), FR-CONS-09 |
| No offline/phone calls; contact details private | FR-CONS-08, FR-CLIN-05 |
| Doctor shows face, short name, verified status (trust) | FR-CLIN-01, FR-CLIN-05 |
| Preterm (< 37 w) is high risk; KMC until ~2.5 kg; home follow-up after discharge | FR-BABY-03..06 |
| Disease spreadsheet from the product owner | FR-KB-01..02 (planned) |
