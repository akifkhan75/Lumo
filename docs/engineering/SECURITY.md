# Security & Privacy

A personal safety app holds the most sensitive data a consumer app can hold: where
someone is, who they would call if afraid, their blood type and allergies, and a
record of when they felt unsafe. A breach here does not leak preferences — it can
put someone in physical danger, including from a person who already has access to
their phone.

That framing should drive every decision in this document.

---

## Current posture

### What is in place

| Control           | Implementation                                                       |
| ----------------- | -------------------------------------------------------------------- |
| Password hashing  | **argon2id** (`argon2` v0.45), library defaults                      |
| Session tokens    | HS256 JWT, `{ email, sub }`, **7-day** expiry                        |
| Route protection  | `JwtAuthGuard` on settings, hazard reports, and all AI routes        |
| Input validation  | Global `ValidationPipe({ whitelist: true, transform: true })` + DTOs |
| Ownership scoping | Every service query is filtered by `req.user.id`                     |
| Secrets in git    | `.gitignore` excludes `.env*` except `.env.example`                  |
| Login enumeration | Same `401 Invalid credentials` for unknown email and wrong password  |

argon2id and whitelisted validation are good choices — better than most projects
at this stage.

### What is not

| Gap                                                                  | Risk                                                                                                                                                 | Ref                              |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| `JWT_SECRET` falls back to `'super-secret-default-key'` in two files | A deploy that forgets the env var ships a publicly-known signing key: **every token forgeable, every account accessible**                            | [KI-9](../audit/KNOWN_ISSUES.md) |
| `app.enableCors()` with no options                                   | Any origin may call the API with a bearer token                                                                                                      |                                  |
| HTTP, not HTTPS                                                      | The client hardcodes `http://192.168.100.81:3005`; tokens and locations in cleartext                                                                 | [KI-1](../audit/KNOWN_ISSUES.md) |
| Token in a module-level variable                                     | Not in secure storage; no clear-on-logout                                                                                                            | [KI-4](../audit/KNOWN_ISSUES.md) |
| No refresh token, no revocation                                      | A stolen token is valid for up to 7 days with no way to invalidate it                                                                                |                                  |
| No rate limiting anywhere                                            | `/auth/login` is openly brute-forceable; `/ai/*` is a billing-abuse vector                                                                           |                                  |
| `PUT /settings` takes `body: any`                                    | Bypasses the global pipe; unvalidated input reaches Prisma                                                                                           | [KI-7](../audit/KNOWN_ISSUES.md) |
| `MinLength(6)` is the only password rule                             | No complexity check, no breach-list check                                                                                                            |                                  |
| No email verification                                                | Anyone can register any address                                                                                                                      |                                  |
| No password reset                                                    | Account recovery is impossible                                                                                                                       |                                  |
| Seed credentials prefilled in the UI                                 | `josim@example.com` / `password` in `AuthScreen.tsx`                                                                                                 |                                  |
| No audit log                                                         | No record of logins, settings changes, or SOS activations — and for a safety app that log _is_ evidence                                              |                                  |
| No exception filter                                                  | Stack traces may leak in error responses                                                                                                             |                                  |
| No request logging or correlation ids                                | An incident cannot be reconstructed                                                                                                                  |                                  |
| Prompt injection surface                                             | `safetyChat` interpolates the user message into the prompt. Low impact today (output is only displayed); it matters the moment the assistant can act | [API.md](API.md)                 |

---

## Threat model

### T1 — The device is in the hands of the person the user fears

The most likely and most dangerous scenario for this category of app, and the one
mainstream security checklists ignore.

Today: no app lock; the SOS screen is reachable from the dashboard and is
unmistakable; "Voice Guard Active" is displayed in the header; settings show the
full trusted-contacts list; a prefilled login makes re-entry trivial.

Needed: a biometric/PIN app lock, a **stealth mode** (disguised app icon, a
discreet trigger, no visible alert state), a panic wipe of local traces, and no
notification content on the lock screen.

### T2 — Stolen or intercepted token

7-day HS256 JWTs with no revocation, sent over HTTP, stored outside secure
storage. Compromise yields full read of the user's profile, contacts, and (once
implemented) live location.

Needed: HTTPS only, short-lived access tokens + rotating refresh tokens, secure
storage, server-side revocation, and device binding.

### T3 — Malicious or spammed hazard reports

`POST /hazard-reports` now has a DTO (coordinates required, description bounded,
links and contact details rejected), a global rate limit, and a per-type expiry.
It still has **no moderation**. One
script can flood the community map, which degrades the feature for everyone and
could be used to _steer_ people toward a location.

Needed: rate limiting per user, community confirmation counts, report decay, a
reputation signal, and moderation tooling.

### T4 — Location data as a surveillance tool

"Follow Me" is exactly the mechanism an abuser would want. A link-based share with
no expiry, no revocation and no visible audit of who viewed it is dangerous by
design.

Needed: expiring tokens, one-tap revocation, a visible list of active shares and
viewers, and explicit per-journey consent — never a persistent background share.

### T5 — Insider / database access

Email, full name, blood type, allergies and contact phone numbers are all
plaintext. Needed: encryption at rest for medical fields and phone numbers,
least-privilege database roles, and no PII in logs.

### T6 — Denial of a safety feature

If the API is unreachable, SOS silently does nothing (and today it does nothing
regardless). Needed: an offline queue, SMS as a fallback transport, and a local
siren/alarm that never depends on the network. The AI fallbacks already follow
this principle — extend it to the whole response path.

---

## Hardening checklist

### Before any public deployment (blocking)

- [ ] Remove both `JWT_SECRET` fallbacks; validate env at boot with `@nestjs/config` + a schema, and crash if absent
- [ ] HTTPS only; terminate TLS at the load balancer and reject HTTP
- [ ] Restrict CORS to known origins
- [ ] Rate-limit `/auth/*` (`@nestjs/throttler`) and `/ai/*`
- [ ] Store the token in `expo-secure-store`; clear it on logout
- [ ] `UpdateSettingsDto` with nested validation; transactional contact updates
- [x] A DTO on `POST /hazard-reports`
- [ ] Remove the prefilled credentials from `AuthScreen.tsx`
- [ ] A global exception filter that never returns stack traces
- [ ] Rotate every credential currently in `.env.example`
- [ ] Prisma migrations instead of `db push` ([KI-5](../audit/KNOWN_ISSUES.md))

### Before the real SOS ships (blocking for that feature)

- [ ] Access + refresh tokens with revocation
- [ ] An immutable audit log for SOS activations, settings changes and location shares
- [ ] Expiring, revocable journey-share tokens
- [ ] Rate limits and abuse controls on SOS and reporting
- [ ] A permissions rationale screen before each OS prompt, explaining the "why"
- [ ] Offline/SMS fallback so an alert survives no connectivity

### Then

- [ ] Biometric app lock and stealth mode (T1)
- [ ] Encryption at rest for medical data and phone numbers
- [ ] Secrets in a managed store (AWS Secrets Manager / GCP Secret Manager)
- [ ] Dependency and secret scanning in CI
- [ ] Certificate pinning in the mobile client
- [ ] An external security review before public launch

---

## Privacy principles for this product

1. **Collect the minimum.** Continuous background location is a liability. Capture
   location at an SOS, during an explicitly started journey, and nowhere else.
2. **Short retention by default.** Location history expires in days, not forever.
   Let the user delete it, and honour the deletion through to backups.
3. **Every share is visible and revocable.** The user can always see who can see
   them, and stop it in one tap.
4. **No secondary use.** Safety data is never sold, used for ads, or used to train
   a model. Say so in the store listing — it is also the strongest honest
   differentiator against an ad-funded competitor.
5. **Consent at the moment of use.** Explain each permission where it is needed,
   not in a wall at onboarding.
6. **Export and delete.** GDPR/CCPA require it, and a safety app should want it.
7. **The dangerous-by-design features get extra friction.** Location sharing,
   recording and stealth mode each deserve a confirmation and an audit entry.

---

## Compliance to plan for

| Regime                  | Applies because                                                | Implication                                                                                                                         |
| ----------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| GDPR (EU/UK)            | Location + health data = Article 9 special category            | Explicit consent, DPIA, export/erasure, a DPO contact                                                                               |
| CCPA/CPRA (California)  | Precise geolocation is "sensitive personal information"        | Opt-out rights, disclosure                                                                                                          |
| Google Play / App Store | Location, microphone, and emergency-adjacent claims            | A Data Safety / Privacy Nutrition Label that matches reality; background location needs a documented justification and a demo video |
| HIPAA                   | **Probably not** — direct-to-consumer, no covered entity       | Revisit if integrating with health providers or dispatch                                                                            |
| Emergency services      | Claiming to contact 911/112 is regulated and varies by country | Get legal advice before any dispatch integration; never imply it works if it does not                                               |

A safety app that over-promises is a legal problem as well as an ethical one.
[FEATURES.md](../audit/FEATURES.md) exists so no one accidentally ships that claim.

---

## Reporting a vulnerability

No disclosure policy exists yet. Before launch, add a `SECURITY.md` with a contact
address, a response-time commitment, and a safe-harbour statement.
