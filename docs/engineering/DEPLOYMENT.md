# Deployment

**Nothing is deployed today, and the repo is not yet deployable.** This document
is the plan plus the blockers, so nobody discovers them on launch day.

---

## Blockers (all of Phase 0 in [ROADMAP.md](../product/ROADMAP.md))

| Blocker                                      | Why it blocks a deploy                                             | Ref                                    |
| -------------------------------------------- | ------------------------------------------------------------------ | -------------------------------------- |
| No Prisma migrations                         | No safe way to evolve a production schema; `db push` can drop data | [KI-5](../audit/KNOWN_ISSUES.md)       |
| `JWT_SECRET` has an insecure fallback        | A missing env var silently ships a public signing key              | [KI-9](../audit/KNOWN_ISSUES.md)       |
| API base URL hardcoded to a LAN IP over HTTP | A built app points at someone's router                             | [KI-1](../audit/KNOWN_ISSUES.md)       |
| No `Dockerfile` for the API                  | `docker/` is empty; only Postgres is containerised                 | [KI-11](../audit/KNOWN_ISSUES.md)      |
| No CI                                        | Nothing verifies a build before it ships                           | [KI-11](../audit/KNOWN_ISSUES.md)      |
| CORS fully open                              | Any origin can use a bearer token                                  | [SECURITY_AND_PRIVACY.md](SECURITY.md) |
| SOS is a mock                                | Shipping it as real is the one unacceptable outcome                | [KI-3](../audit/KNOWN_ISSUES.md)       |

---

## Target topology

```
          Mobile app (EAS build, store or internal distribution)
                            │ HTTPS
                  ┌─────────▼──────────┐
                  │ Load balancer / TLS│    cert + HSTS, HTTP rejected
                  └─────────┬──────────┘
                  ┌─────────▼──────────┐
                  │ apps/api container │    N replicas, stateless
                  │ node dist/main     │
                  └──┬──────────┬──────┘
         ┌───────────▼──┐  ┌────▼──────────────┐
         │ PostgreSQL 15│  │ Google Gemini     │
         │ managed, PITR│  │ (optional)        │
         └──────────────┘  └───────────────────┘
                  later: Redis (rate limits, queues) · SMS provider · push
```

The API is stateless — no session store, no in-process cache — so it scales
horizontally as soon as it is containerised.

---

## API

### Dockerfile to add (`apps/api/Dockerfile`)

A pnpm-monorepo build needs the workspace manifests before the source, so the
install layer caches:

```dockerfile
# ---- build ----
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY patches ./patches
COPY packages ./packages
COPY apps/api ./apps/api
RUN pnpm install --frozen-lockfile --filter api... --filter @lumo/...
RUN pnpm --filter @lumo/types build \
 && pnpm --filter @lumo/api-client build \
 && pnpm --filter api exec prisma generate \
 && pnpm --filter api build

# ---- run ----
FROM node:22-alpine
RUN corepack enable
WORKDIR /repo
ENV NODE_ENV=production
COPY --from=build /repo ./
EXPOSE 3005
CMD ["node", "apps/api/dist/main"]
```

Notes:

- `prisma generate` must run **in the image**; the client is platform-specific.
- `argon2` is a native module — build on the same base image you run on, or it
  will fail to load.
- Run `prisma migrate deploy` as a release step **before** the new version starts
  taking traffic, not in `CMD`.
- Add a `HEALTHCHECK` once `GET /` is a real health endpoint (today it returns a
  hello string, which is enough for liveness but not readiness).

### Production environment

| Variable       | Value                                   | Notes                                                                                                     |
| -------------- | --------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL` | managed Postgres, TLS                   | Append `?sslmode=require`. Consider a pooler (PgBouncer) if replicas × pool size exceeds the server limit |
| `API_PORT`     | `3005`                                  | Fix the `main.ts` default of 3001 at the same time                                                        |
| `JWT_SECRET`   | 32+ random bytes, from a secret manager | **Never** a literal. Rotating it invalidates every session — plan for refresh tokens first                |
| `API_KEY`      | Gemini key                              | Optional; absence degrades to fallbacks                                                                   |
| `NODE_ENV`     | `production`                            |                                                                                                           |

Use AWS Secrets Manager / GCP Secret Manager / Doppler — not environment variables
in a dashboard, and never in the repo. Rotate everything currently in
`.env.example`; treat those values as compromised.

### Pre-deploy changes in code

- [ ] `@nestjs/config` with a schema that **throws at boot** on a missing secret
- [ ] `app.enableCors({ origin: [...] })`
- [ ] A global exception filter that never leaks stack traces
- [ ] `@nestjs/throttler` on `/auth/*` and `/ai/*`
- [ ] Structured request logging with a correlation id
- [ ] Graceful shutdown (`app.enableShutdownHooks()`) so Prisma disconnects cleanly
- [ ] A real `GET /health` that checks the database

### Database

- Managed Postgres 15 with automated backups and point-in-time recovery
- `prisma migrate deploy` in the release pipeline
- **Never** `db push` or `db seed` against production
- Test the restore path before launch, not after an incident

---

## Mobile

### EAS Build

Not configured yet — there is no `eas.json`. The app is Expo 58 prebuild/dev-client
with a patched native dependency, so EAS (or a self-hosted equivalent) is the
realistic path.

```bash
pnpm add -g eas-cli
eas login
eas build:configure          # creates eas.json
eas build --platform android --profile preview
eas build --platform ios --profile production
eas submit --platform android
```

### Monorepo + patched dependency

Two things that will bite on a remote builder:

1. The build must run from the **repo root** so pnpm can resolve the workspace;
   point EAS at `apps/mobile` and let it install from the root lockfile.
2. `@react-native-voice/voice@3.2.4` is patched via `pnpm.patchedDependencies`.
   The remote install **must** apply `patches/` or the Android build fails. Verify
   on the first remote build — it is the most likely failure.

### Profiles to define in `eas.json`

| Profile       | Purpose                 | Notes                                       |
| ------------- | ----------------------- | ------------------------------------------- |
| `development` | Dev client              | Points at a LAN API; cleartext HTTP allowed |
| `preview`     | Internal APK/TestFlight | Staging API over HTTPS                      |
| `production`  | Store builds            | Production API; HTTPS enforced              |

Set the API URL per profile via `EXPO_PUBLIC_API_URL` — which first requires
fixing [KI-1](../audit/KNOWN_ISSUES.md), since nothing reads it today.

### Store submission

- **Permissions need justification.** Microphone is declared. Location — including
  background location for Follow Me — is not yet, and background location requires
  a written justification plus a demo video on Google Play. Budget time for it.
- **Data Safety / Privacy Nutrition Label must match reality.** Declaring location
  collection the app does not do, or omitting what it does, gets builds rejected.
- **Safety claims are scrutinised.** Do not state the app contacts emergency
  services unless it does. See the credibility rules in
  [COMPETITIVE_ANALYSIS.md](../gtm/COMPETITIVE_ANALYSIS.md).
- **A changed `android.package` or iOS bundle id is a new app, not an update.** If
  the rename in [BRANDING.md](../gtm/BRANDING.md) happens, do it _before_ the first
  store submission.

---

## Release process (once CI exists)

```
PR → CI: lint, typecheck, test, e2e → review → merge to main
  ├─ API:    build image → push → migrate deploy → rolling deploy → smoke test
  └─ Mobile: eas build (preview) → internal test → eas build (production) → submit
```

Keep the API backward-compatible for at least one release: app store review takes
days, and users update slowly. **Additive changes only** — a removed field breaks
every phone still on the old build. This is the main discipline difference from a
web deploy.

### Rollback

- **API:** redeploy the previous image. Note that migrations do not roll back
  automatically — write reversible migrations, and never drop a column in the same
  release that stops using it.
- **Mobile:** you cannot recall a shipped build. Halt the staged rollout, submit a
  fix, and keep the API tolerant of the broken version in the meantime.

---

## Monitoring to add before launch

| Layer  | What                                                         | Why                                                    |
| ------ | ------------------------------------------------------------ | ------------------------------------------------------ |
| API    | Error tracking (Sentry), uptime, p95 latency                 | —                                                      |
| API    | **SOS success rate and per-contact delivery rate**           | The only metric that really matters once Phase 2 ships |
| API    | SMS/push provider failures and spend                         | A safety alert failing silently is the worst bug class |
| Mobile | Crash reporting                                              | —                                                      |
| Mobile | Trigger telemetry: shakes, voice, crash — fired vs cancelled | False-positive rate is a product-critical number       |
| DB     | Connection count, slow queries, disk                         | —                                                      |

Privacy constraint: **no coordinates and no contact details in logs or analytics
events.** Aggregate counts only. See [SECURITY_AND_PRIVACY.md](SECURITY.md).
