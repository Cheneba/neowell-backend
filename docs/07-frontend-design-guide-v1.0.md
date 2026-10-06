# NeoWell — Front-End Design Guide v1.0

| | |
|---|---|
| **Version** | 1.0 (covers app release 2.0) |
| **App** | [`Cheneba/neowell-app`](https://github.com/Cheneba/neowell-app): React Native + Expo SDK 57, Expo Router, TypeScript |
| **Related** | [01 Requirements](01-requirements-specification.md) · [04 API](04-api-endpoint-specification.md) · [06 Stack & assets](06-technology-stack-and-assets.md) |

---

## 1. Design principles

1. **Calm, warm, trustworthy.** The logo's soft blue and pink on white; rounded shapes; a heart as the brand accent.
2. **One thing per screen.** Tired parents with one hand free: big targets, short questions, one primary action at the bottom.
3. **Never colour alone.** Triage results always use **colour + icon + words**.
4. **Plain language.** No jargon. Where a medical term is unavoidable (e.g. "HC"), explain it in place.
5. **Safe by default.** Danger is red and always comes with "what to do now". Advice never names a diagnosis.
6. **Works on cheap phones and bad networks.** Light screens, compressed images, offline-safe checks, local reminders.

## 2. Brand

### 2.1 Logo
- Full logo (mark + "NeoWell" + "Track. Care. Thrive.") on the sign-in screen (width 280) and the home header (width 150). Aspect ratio 3.52 : 1.
- The mark alone ("nw" + heart) is used for the app icon, splash and favicon.
- Logo backgrounds are white only. Keep clear space of at least the heart's height around it. Never recolour or stretch it.

### 2.2 Colour tokens (`src/theme/index.ts`)

| Token | Hex | Use |
|---|---|---|
| `blue` | `#62A6EA` | Logo blue: borders, icons, selected outlines, decoration |
| `blueDeep` | `#2C6CB5` | Primary buttons, links, header tint, text on white (5.2 : 1) |
| `blueSoft` | `#EAF3FD` | Tinted cards, selected chips, icon bubbles |
| `pink` | `#F0849F` | Logo pink: hearts, accents, avatars |
| `pinkDeep` | `#C2446A` | Secondary/emotional buttons (consent, "unwell"), tags (4.7 : 1) |
| `pinkSoft` | `#FDEEF2` | Soft pink cards, due pills, avatars |
| `white` / `background` | `#FFFFFF` | Screens are always white |
| `ink` | `#1E2B3C` | Body text |
| `muted` | `#5E6E82` | Secondary text, hints |
| `border` | `#DDE7F2` | Card and input borders |
| `green` / `greenSoft` | `#1E8A4C` / `#E6F5EC` | GREEN result only |
| `yellow` / `yellowBright` / `yellowSoft` | `#9A6A00` / `#F2B705` / `#FFF5D6` | YELLOW result only |
| `red` / `redSoft` | `#C62828` / `#FDE7E7` | RED result, errors, danger options, emergency buttons |

Rules: brand colours (blue/pink) are for **navigation and decoration**; traffic-light colours are reserved for **health status and errors**.

### 2.3 Typography

Nunito (rounded, matches the logo).

| Style | Font | Size / line | Use |
|---|---|---|---|
| Display | Nunito ExtraBold | 44 | Temperature value |
| Title | Nunito ExtraBold | 26 / 32 | Screen titles |
| Heading | Nunito Bold | 19–22 | Card titles, section headers |
| Body | Nunito Regular | 17 / 24 | Text |
| Label | Nunito Bold | 16 | Field labels, question labels |
| Button | Nunito Bold | 18 | Buttons |
| Small | Nunito SemiBold | 13–15 | Hints, tags, timestamps |

Minimum text size is 13; body text is never below 16.

### 2.4 Spacing, radius, elevation
- Spacing scale: `xs 4 · sm 8 · md 16 · lg 24 · xl 32`. Screen padding is 16.
- Radius: `sm 10` (errors), `md 16` (inputs, rows), `lg 24` (cards), `pill` (buttons, chips, badges).
- No drop shadows: use 1.5 px borders and soft tints, which are cheaper to render and clearer on low-end screens.
- Touch targets: primary buttons 56 px tall, chips 48 px, icon buttons 48 px.

### 2.5 Iconography
Ionicons. Outline icons for questions and navigation; filled icons for status. Canonical mapping:

| Concept | Icon |
|---|---|
| Temperature | `thermometer` |
| Feeding / feeds | `water-outline` / `nutrition-outline` |
| Breathing | `pulse-outline` |
| Skin / jaundice | `color-palette-outline` / `eye-outline` |
| Cry | `volume-medium-outline` |
| Stool | `ellipse-outline` |
| Cord | `bandage-outline` |
| Fits | `flash-outline` |
| Vomiting | `water` |
| Room / clothing | `home-outline` / `shirt-outline` |
| GREEN / YELLOW / RED | `checkmark-circle` / `alert-circle` / `warning` |
| Unwell | `medkit` |
| Doctor | `person-circle-outline` |
| Chat / audio / video | `chatbubbles` / `call` / `videocam` |
| Growth | `trending-up` |
| Medicines | `medical` |

### 2.6 Voice and tone
- Speak to the mother as "you", and to the baby by display name: "Is Baby Christian feeding well?"
- Short, kind, direct: "Go to a health facility now. Do not wait."
- Never blame ("You should have…"). Never diagnose ("Your baby has…").
- French is natural French, not a literal translation. Neutral gender where possible ("en cas d'inquiétude").

## 3. Accessibility checklist
- Contrast ≥ 4.5 : 1 for text (tokens above are pre-checked).
- Every `Pressable` has `accessibilityRole` and a label; groups use `radiogroup`/`radio`/`checkbox` roles with `accessibilityState`.
- Results: colour + icon + text; the live result region is announced.
- Supports system font scaling up to 130% without clipping (wrap, no fixed heights on text).
- No essential information in images only.

## 4. Components (`src/components`)

| Component | Purpose | Key props / behaviour |
|---|---|---|
| `Screen` | Safe-area page with scroll and a sticky footer for the primary action | `scroll`, `footer` |
| `Title`, `Body`, `Label`, `ErrorText` | Typography primitives | `muted` |
| `Button` | Large pill button | `variant: primary \| pink \| outline \| ghost \| danger`, `icon`, `loading`, `disabled` |
| `Field` | Labelled text input | `label`, `hint`, all `TextInput` props |
| `Card` | Bordered or tinted container | `tint` |
| `ChoiceGroup` | Single-choice chips for one question | `options[{value,label}]`, `danger[]` values shown red when selected |
| `RiskBadge` | Traffic-light pill (colour + icon + text) | `level`, `size: sm \| lg` |
| `Logo` | Brand logo | `width` |
| `LanguageSwitch` | English / Français segmented control | — |
| `StepButton` | Round +/− button | `icon`, `onPress` |
| `TemperatureInput` | Big value with ±0.1 steppers, comma/dot decimals, 30–43 °C validation | `value`, `onChange` |
| `Counter` | Integer ± counter | `min`, `max` |
| `BreathCounter` | Modal 60-second timer; "tap for each breath"; shows rate; restart | `onDone(rate)` |
| `QuestionRenderer` | Renders a server check-plan question by `kind` (TEMPERATURE, COUNTER, SINGLE, BOOLEAN, BREATH_COUNTER) and evaluates `showIf` | `question`, `value`, `onChange` |
| `ComplaintGrid` | Multi-select tiles with icons for the unwell flow | `selected`, `onToggle` |
| `MeasurementInputs` | Weight (g) / length (cm) / HC (cm) with helper text ("HC = head circumference, in the baby's booklet") and pre-fill | `values`, `onChange`, `required` |
| `GrowthRow` | One measurement with value, date and flag pill | `label`, `item` |
| `Banner` | Inline notice (info / warning / danger) | `tone`, `icon`, `action` |
| `EmptyState` | Heart icon + message + optional action | — |
| `Avatar` | Initial in a pink circle, or photo | `name`, `uri`, `size` |
| `StatusPill` | Consultation status in brand colours | `status` |
| `ChatBubble` | Message bubble (mine = blue, theirs = white bordered, REPORT = card, SYSTEM = centred muted) | `message` |
| `Composer` | Text input + send + photo buttons | `onSend`, `onImage`, `disabled` |
| `SlotPicker` | Day chips + time chips from `/clinicians/:id/slots` | `slots`, `value` |
| `ListRow` | Tappable row with icon, title, subtitle, chevron | — |

## 5. Navigation map

```
Root (Stack, guards in src/app/_layout.tsx)
├── (auth)                 when signed out
│   ├── sign-in            phone number
│   └── verify             6-digit code
├── onboarding             when signed in but profile/consent incomplete
│   ├── profile            first + last name, language (all roles)
│   └── consent            caregivers only
├── (caregiver)            role = CAREGIVER
│   ├── (tabs)             Home · Doctors · Inbox · Me
│   ├── baby/new · baby/[id] · baby/[id]/edit · baby/[id]/growth · baby/[id]/measure
│   ├── baby/[id]/check (ROUTINE | UNWELL) · baby/[id]/history · baby/[id]/medicines
│   ├── result · facilities
│   ├── doctors/[id] · doctors/[id]/book
│   └── consultation/[id] · consultation/[id]/pay · consultation/[id]/review
└── (clinician)            role = CLINICIAN
    ├── setup              register profile (until profile exists)
    ├── (tabs)             Consultations · Earnings · Me
    ├── documents · availability
    └── consultation/[id] · consultation/[id]/refer · consultation/[id]/prescribe · consultation/[id]/patient
```

Guards: `Stack.Protected` with `guard` = signed out / needs profile / needs consent / caregiver / clinician. Deep links from notifications use `data.url` (e.g. `/consultation/abc`).

## 6. Screens

Each screen lists: **purpose · content · primary action · states · API**.

### 6.1 Shared

| Screen | Purpose & content | Primary action | States | API |
|---|---|---|---|---|
| **Sign in** | Logo, welcome line, language switch, phone field ("6 70 00 00 00"), SMS hint | Send code | invalid number; network; 429 wait | `POST /auth/otp/request` |
| **Verify** | "Enter your code", sent-to number, big 6-digit field, resend, change number | Verify | wrong/expired code | `POST /auth/otp/verify` (role from sign-in toggle "I am a doctor") |
| **Profile (onboarding)** | First name, last name (required), language. Caregivers see why: "Doctors and hospitals use the mother's name; your baby will be called *Baby {last name}* for the first 42 days." | Continue | validation | `PATCH /me` |
| **Consent** (caregiver) | Two checkboxes (store checks — required; share with doctors), disclaimer card | I agree (pink) | must tick first | `PUT /me/consents` |

### 6.2 Caregiver

| Screen | Purpose & content | Primary action | States | API |
|---|---|---|---|---|
| **Home** (tab) | Header logo + inbox bell with unread dot. "Hello, {first name}!". Pending-recheck banner. One card per baby: avatar, **display name**, age (+ corrected age), "needs extra care" tag, care status (hospital/KMC banner), last result badge, checks due pill, buttons **Start check** and **Baby is unwell** (pink). Daily tip card. "Add a baby", "Nearest health facilities". | Start check | loading; empty ("Add your baby…"); error + retry; pull to refresh | `GET /babies`, `GET …/check-schedule`, `GET …/observations?limit=1` |
| **Add baby** | 3 steps with progress dots. **1. About**: sex, date of birth (DD/MM/YYYY), given name (optional) with an explanation of the "Baby {last name}" rule. **2. Birth measurements**: weeks of pregnancy, weight (g), length (cm), **HC** (cm), all required, with "Find these in the hospital booklet" and a note that a nurse can help. **3. Where**: birth facility search or typed name; "Where is the baby now?": at home / in hospital / in kangaroo care. | Next / Save | per-step validation; future date; out-of-range values | `GET /facilities?q`, `POST /babies` |
| **Baby overview** | Hero: avatar, display name, given name (if different), age + corrected age, term status, weight category, risk-factor list. Sections: **Today** (schedule, checks due, pending recheck), **Growth** (latest weight/length/HC with flags → Growth), **Recent checks** (last 3 → History), **Medicines** (active charts → Medicines), **Consultations**. KMC/hospital banner with "My baby is home now" (sets AT_HOME + discharge date). | Start check | paused state for hospital/KMC; needs-name banner at ≥ 42 days | `GET /babies/:id`, schedule, growth, observations, drug charts |
| **Edit baby** | Same fields as Add baby | Save | | `PATCH /babies/:id` |
| **Growth** | Latest measurements with WHO flag pills ("Usual range" green, "Outside usual range – show a health worker" yellow, "Far outside – consult soon" red). Table of all measurements. | Update measurements | | `GET …/growth`, `GET …/measurements` |
| **Update measurements** | Date, source (hospital/clinic/home), weight/length/HC **pre-filled with the latest values**, note | Save | at least one value | `POST …/measurements` |
| **Check — routine** | Questions from the **check plan**, one card each: temperature first (big input), then the other core questions, then the rotating ones. Context questions (room, clothing) appear when the temperature is raised or low. A breath-count card opens the BreathCounter. Danger options turn red when chosen. | See result | offline: saved to the queue → "Saved — will send when online" | `GET …/check-plan?type=ROUTINE`, `POST …/observations` |
| **Check — unwell** | Step 1: "What is worrying you?": ComplaintGrid (12 complaints + Other), a free-text box and a **voice note** recorder (≤ 60 s). Step 2: questions for those complaints (from the plan). | See result | | `…/check-plan?type=UNWELL&complaints=…`, `POST …/voice-notes`, `POST …/observations` |
| **Result** | Big traffic light + display name + badge + one-line meaning. "What we noticed" (finding list with icons). "What to do" (actions; **no-medicines warning** for under 42 days; cooling steps). **Recheck card** with a countdown and "Remind me" (local notification). Seizure explainer when relevant. Emergency call buttons (RED). Buttons: Find nearest facility (RED/YELLOW), **Talk to a doctor** (YELLOW/RED, pre-fills booking with this check), Back to home. | Depends on level | | — (result passed in memory) |
| **History** | All checks, newest first: date/time, temperature, badge, findings, photo thumbnail, check type (routine/unwell icon) | — | empty | `GET …/observations` |
| **Medicines** | Active drug charts: each item with dose, route, times today and **Given / Skipped** buttons per dose. Past charts collapsed. Alarms are scheduled automatically. | Mark given | | `GET …/drug-charts`, `POST /drug-chart-items/:id/doses` |
| **Facilities** | Location permission → nearest facilities: name, distance, services, department rows with a call button | Call | locating; permission denied; none found | `GET /facilities/nearby` |
| **Doctors** (tab) | My consultations at the top (active), then "Find a doctor": filters (Chat / Audio / Video, Available now), doctor cards: photo, "Dr Amina N.", verified tick, specialties, rating, fees per medium, "Available now" dot | Open doctor | empty | `GET /consultations`, `GET /clinicians` |
| **Doctor profile** | Photo, name, verified badge, bio, experience, facility, rating, fees per medium, weekly availability. Privacy note: "You talk inside NeoWell. Phone numbers are never shared." | Book | | `GET /clinicians/:id` |
| **Book** | Baby, medium (cards with price), when (ASAP if available now, or SlotPicker), reason. **If the linked check had fever**: checklist "Before you book, have you…" (removed extra clothes, cooled the room, sponged with lukewarm water, rechecked temperature). Summary with fee. | Continue to payment | slot taken (409) → refresh slots | `GET …/slots`, `POST /consultations` |
| **Pay** | Fee, provider choice (MTN MoMo / Orange Money), payer phone (pre-filled), "Approve the payment on your phone" waiting state with spinner, then success → consultation | Pay | pending; failed → retry; sandbox note in dev | `POST /consultations/:id/payments`, poll `GET /consultations/:id` |
| **Consultation room** | Header: doctor, status pill, time. Banner by status (waiting for the doctor / confirmed at … / in progress / completed). **Chat**: REPORT card first, bubbles, photos; composer (disabled when closed). Call button (audio/video) when the window is open → opens the call page. Cards: referral (facility, urgency, code, call buttons), drug chart (→ Medicines), cancel button (with refund rule), review prompt when completed. | Send / Join call | polling every 5 s while open | `GET /consultations/:id`, messages, `POST …/messages`, `…/image`, `…/call`, `…/cancel` |
| **Review** | 5 hearts + comment | Submit | once only | `POST …/review` |
| **Inbox** (tab) | Notifications list, unread bold, tap → deep link; "Mark all read" | — | empty | `GET /me/notifications`, `POST …/read` |
| **Me** (tab) | Profile (name, phone), language, consents toggles, **Export my data** (share JSON), **Delete my account** (confirm dialog explaining the 30-day purge), sign out | — | | `GET/PATCH /me`, `PUT /me/consents`, `GET /me/export`, `DELETE /me` |

### 6.3 Clinician

| Screen | Purpose & content | Primary action | States | API |
|---|---|---|---|---|
| **Setup** | Title, first/last name, licence number, specialties, bio, facility, years of experience; media offered with fees (chat < audio < video hint); payout provider + number | Save | 409 licence exists | `POST /clinicians/me` |
| **Verification (documents)** | Status card (Pending documents / In review / Verified / Rejected + note). Checklist: profile photo, medical licence, medical degree, proof of employment, each with upload (camera, gallery or PDF) and a tick | Upload | uploading; rejected note | `GET /clinicians/me`, `POST …/photo`, `POST …/documents` |
| **Consultations** (tab) | "Available now" switch (1 h / 2 h / 4 h). Sections: **New requests** (accept/decline, countdown to deadline), **Today & upcoming**, **Past**. Cards show baby display name, age, medium, reason, latest result badge from the summary. | Accept | not verified → banner to Verification | `GET /consultations`, `PUT …/available-now` |
| **Consultation room (clinician)** | Same room as the caregiver plus: patient button (→ Patient), actions by status: Accept/Decline · Start · Complete (notes + diagnosis summary sheet) · No-show; Refer; Prescribe. The pre-consultation checklist is shown at the top when present. | Start / Complete | | consultation endpoints, `…/summary` |
| **Patient** | Baby profile, risk factors, growth flags, 7-day summary: result counts, temperature range, findings, check list | — | | `GET /consultations/:id/summary` |
| **Refer** | Facility search (directory) or typed name, urgency, reason | Send referral | | `GET /facilities?q`, `POST …/referral` |
| **Prescribe** | Item rows: drug, dose, route, times of day (chips 06:00…22:00 + custom), days, instructions; add/remove rows | Save drug chart | | `POST …/drug-chart` |
| **Availability** | Per weekday: on/off + start/end times | Save | | `PUT /clinicians/me/availability` |
| **Earnings** (tab) | Pending and paid totals, completed count, payouts list | — | | `GET /clinicians/me/earnings` |
| **Me** (tab) | Public profile preview, edit profile, availability, verification, language, sign out | — | | |

## 7. Interaction patterns

| Pattern | Rule |
|---|---|
| Primary action | Always in the sticky footer; only one primary per screen. |
| Destructive actions | Confirmation dialog with plain consequences (refund rule, 30-day deletion). |
| Loading | Centred spinner in brand blue with a short label; keep the previous data during refresh. |
| Errors | Inline red `ErrorText` with a Retry button; network errors say "Check your internet connection". |
| Offline checks | A check that cannot be sent is queued (AsyncStorage-equivalent secure storage), shown as "Waiting to send" in History, and re-sent with the same `clientRef`. |
| Polling | Chat: every 5 s while the room is focused. Payment pending: every 3 s up to 2 min. |
| Notifications | On sign-in: ask permission, register the Expo push token (`POST /me/devices`), reschedule local check reminders. Tapping a notification deep-links via `data.url`. |
| Images | Picked with `expo-image-picker` at quality 0.6, max 1,280 px, before upload. |
| Numbers | Accept comma or dot decimals; show units next to the field (g, cm, °C). |
| Dates | `DD/MM/YYYY` fields for birth dates; relative labels in lists ("Today 14:05"). |

## 8. Content
- **Translations.** `src/i18n/en.ts` is the source; `fr.ts` must match it exactly (TypeScript type plus unit test). Plurals use `_one`/`_other` keys.
- **Server-provided text.** Check-plan question labels and options come from the server in the requested language, so new questions need no app update. Finding and action texts live in the app (codes from the server).
- **Tips.** `src/content/tips.ts`, EN/FR, keyed by age band (0–7 d, 8–28 d, 29–90 d, 90+ d); one per day, rotating.

## 9. Code structure

```
neowell-app/
├── app.json                 Expo config (name, icons, splash, plugins, permissions)
├── assets/images/           logo, icons, splash
├── src/
│   ├── app/                 Routes only (Expo Router); thin screens that compose features
│   │   ├── _layout.tsx      fonts, providers, guards
│   │   ├── (auth)/ onboarding/ (caregiver)/ (clinician)/
│   ├── api/                 client.ts (fetch + refresh), types.ts (API shapes)
│   ├── components/          UI kit (§4); no API calls here
│   ├── features/            Domain logic + feature components
│   │   ├── checks/          QuestionRenderer, BreathCounter, ComplaintGrid, offline queue
│   │   ├── consultation/    ConsultationRoom, ChatBubble, Composer, status helpers
│   │   ├── growth/          MeasurementInputs, GrowthRow
│   │   └── notifications/   push registration, local reminders, dose alarms
│   ├── i18n/                en.ts, fr.ts, translate()
│   ├── lib/                 session, storage, config, dates, phone, format, use-async
│   ├── content/             tips
│   └── theme/               tokens
└── src/__tests__/           unit tests
```

Rules:
- Screens in `src/app` stay thin: fetch with `useFocusData`, render components, call `api.*`.
- One API client instance from `useSession()`; never call `fetch` directly elsewhere.
- No global state library. Session state lives in React context; screen data is fetched on focus. A small in-memory handoff (`lastResult`) carries the result screen data.
- All user-visible strings go through `t()`. No hard-coded text.
- Lint, type check and tests must pass before merge (CI).

## 10. Testing
- **Unit:** translations (key parity, placeholders, backend codes covered), API client (refresh, errors), helpers (phone, dates, temperature), check-plan `showIf` evaluation, offline queue, display-name formatting.
- **Walkthrough:** a Playwright script drives the web build against a local backend (sign in → profile → consent → add baby → routine check → unwell check → result → facilities → book → pay (sandbox) → chat) and saves screenshots for review.
