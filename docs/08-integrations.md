# Third-party integrations

Every external service sits behind a **port**: an abstract class used as the Nest injection
token. Business code only ever depends on the port. A **driver** implements it, and a factory
provider in the owning module picks the driver from an env var. Swapping a vendor means
writing one driver class and adding one `case` to that factory. No other code changes.

| Port | Module | Env switch | Drivers |
|---|---|---|---|
| `SmsService` | notifications | `SMS_PROVIDER` | `console`, `twilio` |
| `EmailService` | notifications | `EMAIL_PROVIDER` | `console`, `smtp` (any SMTP server) |
| `PushService` | notifications | `PUSH_DRIVER` | `log`, `expo`, `fcm` |
| `Realtime` | realtime | none | WebSocket gateway at `/ws` |
| `StorageService` | storage | `STORAGE_DRIVER` | `local`, `r2` (Cloudflare R2) |
| `PaymentGateway` | payments | `PAYMENT_PROVIDER` | `SANDBOX`, `CAMPAY` |
| `CallProvider` | consultations | `LIVEKIT_*` set or not | `livekit`, disabled |
| `SpeechToText` | voice | `STT_URL` set or not | OpenAI-compatible, disabled |

Env is validated at boot (`src/config/env.ts`): choosing a real driver without its credentials
fails startup with a message naming the missing variables.

## Adding a driver

1. Create `<thing>.<vendor>.ts` extending the port. Take config and an optional `fetch` or client
   in the constructor, so a unit test can mock the network.
2. Add the new value to the enum in `env.ts`, plus its variables and a `need(...)` line.
3. Add a `case` to the factory in the module.
4. Add the variables to `.env.example` and a test with a mocked `fetch` (see `src/integrations.spec.ts`).

## Notifications flow

`NotificationsService.notify()` queues a job. `deliver` then writes the inbox row and
1. emits a `notification` event over WebSocket to any live connection,
2. queues a push per registered device (`push.send`),
3. queues `email.send` if the call asked for `email: true` and the user has an address,
4. queues `sms.send` as a fallback when there is no device and the call asked for `sms: true`.

### WebSocket protocol

Connect to `wss://<host>/ws`, then send `{"event":"auth","data":{"token":"<access JWT>"}}` within
10 s. The server replies `{"event":"ready"}`, then sends frames like
`{"event":"notification","data":{...}}`. Bad token or no auth: closed with code `4401`.

### Push tokens

`POST /me/devices {pushToken, platform}`. For `fcm` the token must be the native FCM token
(`getDevicePushTokenAsync` in Expo), not an Expo token. `expoPushToken` is still accepted as an alias.

## Provider notes

- **Twilio**: set `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` and either `TWILIO_FROM` or
  `TWILIO_MESSAGING_SERVICE_SID`. Trial accounts only reach verified numbers.
- **SMTP**: for Gmail use `smtp.gmail.com`, port 587, `SMTP_SECURE=false`, and an app password.
- **FCM**: Firebase console → Project settings → Service accounts → Generate key. Paste the JSON
  (or its base64) into `FIREBASE_SERVICE_ACCOUNT`.
- **R2**: create a private bucket and an API token with Object Read & Write. Set `R2_ACCOUNT_ID`,
  `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` and `R2_BUCKET`.
- **Campay**: `CAMPAY_BASE_URL` is `https://demo.campay.net/api` for testing and
  `https://www.campay.net/api` for live. Auth is `CAMPAY_PERMANENT_TOKEN`, or `CAMPAY_APP_USERNAME` + `CAMPAY_APP_PASSWORD`. Status is polled by the `payment.status` job, so Campay's webhook is not used.

## Live testing (admin)

`GET /admin/integrations` shows the active driver for each port.
`POST /admin/integrations/test {channel: "sms"|"email"|"push"|"realtime"|"storage", to}` fires a real
test through that driver and returns the vendor error text if it fails. Push and realtime go to the
calling admin's own devices and connections.
