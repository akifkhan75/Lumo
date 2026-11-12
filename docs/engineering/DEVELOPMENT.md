# Development Setup

## Prerequisites

| Tool           | Version    | Notes                                                            |
| -------------- | ---------- | ---------------------------------------------------------------- |
| Node           | >= 18      | `engines` in the root `package.json`                             |
| pnpm           | 9          | `packageManager: pnpm@9.0.0`; `corepack enable` is the easy path |
| Docker         | any recent | For PostgreSQL only                                              |
| Android Studio | current    | SDK + an emulator, or a physical device                          |
| Xcode          | current    | macOS only, for iOS                                              |
| JDK            | 17         | Required by the Gradle setup                                     |

---

## First run, start to finish

```bash
# 1 — install
git clone <repo> && cd Lumo
pnpm install

# 2 — build the shared packages (the mobile app imports dist/, not src/)
pnpm build

# 3 — environment
cp .env.example apps/api/.env
#    then EDIT apps/api/.env and set API_PORT=3005   ← see the gotcha below

# 4 — database
docker compose up -d postgres
pnpm --filter api exec prisma generate
pnpm --filter api exec prisma db push
pnpm --filter api exec prisma db seed

# 5 — API
pnpm --filter api start:dev        # http://localhost:3005

# 6 — point the app at your machine
#    EDIT apps/mobile/services/apiService.ts → LAN_IP = '<your LAN IP>'
#    macOS:  ipconfig getifaddr en0

# 7 — app (new terminal)
pnpm --filter mobile start         # Metro
pnpm --filter mobile android       # or: ios
```

Log in with **`josim@example.com` / `password`** (already prefilled).

---

## The two gotchas that will cost you an hour

### 1. The port default disagrees with everything else

`apps/api/src/main.ts` falls back to **3001**:

```ts
const port = process.env.API_PORT || 3001;
```

`.env.example` says `3005`, and `apps/mobile/services/apiService.ts` hardcodes
`3005`. If you forget `API_PORT=3005`, the API starts on 3001, the app gets
`Network request failed`, and the dashboard shows _"Failed to load application
data"_ with no hint as to why.

### 2. The API address is a hardcoded constant, not an env var

```ts
// apps/mobile/services/apiService.ts
const LAN_IP = "192.168.100.81";
export const API_BASE_URL = `http://${LAN_IP}:3005`;
```

`EXPO_PUBLIC_API_URL` is in `.env.example` but **nothing reads it**. You must edit
the source for your network. ([KI-1](../audit/KNOWN_ISSUES.md))

What to use for `LAN_IP`:

| Target           | Value                                            |
| ---------------- | ------------------------------------------------ |
| Android emulator | `10.0.2.2` (the host, as seen from the emulator) |
| iOS simulator    | `localhost`                                      |
| Physical device  | your machine's LAN IP, same Wi-Fi                |

A cleartext HTTP URL to a LAN IP also needs Android's
`usesCleartextTraffic`/network-security-config to stay permissive in debug builds;
the current dev build allows it.

---

## Environment variables

Copy `.env.example`. Nothing here is loaded automatically by the API — there is no
`@nestjs/config` module, so values are read straight from `process.env` and the
file must be in `apps/api/.env` (or exported in your shell).

### API — `apps/api/.env`

| Variable       | Used by         | Default if unset                  | Notes                                                                      |
| -------------- | --------------- | --------------------------------- | -------------------------------------------------------------------------- |
| `DATABASE_URL` | Prisma          | —                                 | Required; port **5434**                                                    |
| `API_PORT`     | `config/env.ts` | `3005`                            | Rejected if it is not a valid port                                         |
| `JWT_SECRET`   | `config/env.ts` | **none — the API will not start** | Must be ≥32 characters and not an example value. `openssl rand -base64 48` |
| `CORS_ORIGINS` | `config/env.ts` | empty → no browser origin         | Comma-separated. The mobile app is not subject to CORS                     |
| `API_KEY`      | `ai.service.ts` | none → fallback responses         | Google Gemini key. Optional: the app works without it                      |

`JWT_SECRET` has no fallback by design (KI-9): a safety API that boots
misconfigured and looks healthy is worse than one that refuses to start.

### Mobile — `apps/mobile/.env`

| Variable               | Used by                  | Default if unset                    | Notes                                                   |
| ---------------------- | ------------------------ | ----------------------------------- | ------------------------------------------------------- |
| `EXPO_PUBLIC_API_URL`  | `services/apiService.ts` | derived from the Metro bundler host | Required for any build not run against a local bundler  |
| `EXPO_PUBLIC_API_PORT` | `services/apiService.ts` | `3005`                              | Used by the development fallback; must match `API_PORT` |

---

## Command reference

### Root (Turborepo — runs across the graph)

```bash
pnpm build        # types → api-client → apps
pnpm dev          # every dev task, persistent, uncached
pnpm test
pnpm lint
pnpm typecheck    # real since Phase 0: tsc --noEmit in every package
pnpm format       # prettier over **/*.{ts,tsx,md}
pnpm check:honesty # PLAT-9 — fails on UI copy claiming an unproven outcome
```

### Database

```bash
docker compose up -d                   # postgres on host port 5434
pnpm --filter api db:deploy            # apply migrations
pnpm --filter api db:migrate           # create a migration from schema changes
pnpm --filter api db:status
pnpm --filter api db:seed
```

### API container

```bash
docker build -f apps/api/Dockerfile -t lumo-api .   # context is the repo root
docker run -p 3005:3005 -e JWT_SECRET=... -e DATABASE_URL=... lumo-api
```

Migrations are **not** run on container start. Apply them as a separate step
before rollout: a crash-looping container must not re-run schema changes.

### API

```bash
pnpm --filter api start:dev            # watch mode
pnpm --filter api start:debug
pnpm --filter api start:prod           # node dist/main
pnpm --filter api build                # nest build
pnpm --filter api lint                 # oxlint
pnpm --filter api test                 # vitest
pnpm --filter api test:cov
pnpm --filter api test:e2e             # needs a live database
pnpm --filter api exec prisma studio   # data browser
```

### Mobile

```bash
pnpm --filter mobile start      # expo start
pnpm --filter mobile android    # expo run:android  (builds native)
pnpm --filter mobile ios        # expo run:ios
pnpm --filter mobile test       # jest
pnpm --filter mobile lint
```

### Packages

```bash
pnpm --filter @lumo/types build
pnpm --filter @lumo/api-client build
pnpm --filter @lumo/api-client dev     # tsc -w
pnpm --filter @lumo/api-client test
```

---

## Native builds

This is an **Expo prebuild / dev-client** project, not Expo Go.

`@react-native-voice/voice` is a native module with no Expo Go support, so voice
activation requires a custom development build:

```bash
pnpm --filter mobile android      # or ios
```

`useVoiceActivation` checks `NativeModules.Voice` and silently disables itself in
Expo Go rather than crashing — so the app runs in Expo Go, just without voice.

### The patched dependency

`@react-native-voice/voice@3.2.4` is patched for modern Gradle via
`patches/@react-native-voice__voice@3.2.4.patch`, wired through
`pnpm.patchedDependencies` in the root `package.json`. **Bumping that package
without regenerating the patch will break the Android build.**

### Metro and pnpm

`apps/mobile/metro.config.js` must keep both additions or workspace packages will
not resolve under pnpm's symlinked layout:

```js
config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];
```

### Permissions

Declared in `apps/mobile/app.json`: Android `RECORD_AUDIO`; iOS
`NSMicrophoneUsageDescription` + `NSSpeechRecognitionUsageDescription`. The
`@react-native-voice/voice` config plugin sets the same strings.

**Not yet declared:** location (`ACCESS_FINE_LOCATION`, `NSLocationWhenInUse…`),
SMS, contacts, or notifications — all needed for the planned real SOS.

---

## Troubleshooting

| Symptom                                                         | Cause                                                    | Fix                                                                                                                                                 |
| --------------------------------------------------------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Failed to load application data"                               | Wrong `LAN_IP`, or API on 3001                           | §"two gotchas"                                                                                                                                      |
| `Cannot find module '@lumo/api-client'`                         | Package not built                                        | `pnpm build`                                                                                                                                        |
| Types stale after editing `packages/types`                      | Consumers read `dist/`                                   | `pnpm --filter @lumo/types build`, or run `dev` (`tsc -w`)                                                                                          |
| Metro can't resolve a workspace package                         | `metro.config.js` edited                                 | Restore `watchFolders` / `nodeModulesPaths`                                                                                                         |
| Prisma: `Can't reach database server`                           | Container down, or port 5432 vs 5434                     | `docker compose up -d postgres`; check `DATABASE_URL`                                                                                               |
| `PrismaClientInitializationError` after a schema edit           | Client not regenerated                                   | `pnpm --filter api exec prisma generate`                                                                                                            |
| Voice activation never starts                                   | Running in Expo Go                                       | Build a dev client                                                                                                                                  |
| Android build fails in `react-native-voice`                     | Patch not applied                                        | `pnpm install` from the root                                                                                                                        |
| `ERR_PNPM_INVALID_PATCH` / `hunk header integrity check failed` | The patch file's `@@` line counts disagree with its body | Count the hunk's `-`/context vs `+`/context lines and correct the header; a stale `node_modules` hides this until a reinstall forces re-application |
| Jest fails to boot on a native import                           | Missing mock                                             | Add it to `apps/mobile/jest-setup.js`                                                                                                               |
| A body field is `undefined` in a controller                     | `whitelist: true` stripped it                            | Add the `class-validator` decorator to the DTO                                                                                                      |
| Logged out after reloading the app                              | Expected                                                 | [KI-4](../audit/KNOWN_ISSUES.md)                                                                                                                    |

### Resetting the database

```bash
docker compose down -v        # destroys the postgres_data_v2 volume
docker compose up -d postgres
pnpm --filter api exec prisma db push
pnpm --filter api exec prisma db seed
```

### Clean rebuild

```bash
pnpm -r exec rm -rf dist .turbo node_modules
rm -rf node_modules .turbo
pnpm install && pnpm build
```

---

## Editor

`.vscode/` is committed. Prettier is the formatter (`pnpm format`); the API lints
with **oxlint** (`apps/api/oxlint.json`) and the mobile app with **ESLint**
(`@react-native/eslint-config`). Two linters, by design of the respective
toolchains — don't try to unify them without a reason.
