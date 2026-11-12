# CLAUDE.md — Agent Context for Lumo

> **Read this first.** It is the fastest path to a correct change in this repo.
> Deeper detail lives in [`docs/`](docs/README.md), now organised as
> `product/` `specs/` `design/` `engineering/` `audit/` `gtm/` `adr/`.
> **[`docs/product/PRD.md`](docs/product/PRD.md) is the root document** — scope,
> requirement IDs and success metrics come from there.
> If this file and a `docs/` file disagree, the code wins — then fix both.

---

## 1. What this app is

A **personal safety app** for Android/iOS: community-reported hazard
reports, a one-tap SOS, hands-free SOS triggers (shake / voice / crash detection),
a fake-call escape tool, journey sharing, a check-in timer, and an AI safety
assistant.

It is positioned as a **more capable alternative to Google's Personal Safety
app** — see [`docs/COMPETITIVE_ANALYSIS.md`](docs/gtm/COMPETITIVE_ANALYSIS.md) for the
feature-by-feature gap and [`docs/ROADMAP.md`](docs/product/ROADMAP.md) for the plan.

**Naming:** the product is **Lumo**, decided 2026-10-26 and applied throughout —
packages are `@lumo/*`, the bundle id is `com.lumo.app`, and the wake word is
**"Hey Lumo"**. The repo previously carried three names (NeuroShield / InSafe /
"hey guardian"); if you find a straggler, fix it. Rationale and the executed
checklist are in [`docs/BRANDING.md`](docs/gtm/BRANDING.md) and
[ADR-0007](docs/adr/0007-name-the-product-lumo.md).

> The repo directory, the GitHub repo (`akifkhan75/Lumo`) and the git remote have
> all been renamed too. GitHub redirects the old URLs, but that redirect breaks if
> a new repo named `NeuroShield` is ever created under the same account.

---

## 2. Repo shape

Turborepo + pnpm workspaces. Node >= 18, pnpm 9.

```
apps/api        NestJS 12 REST API, Prisma 5, PostgreSQL        (the backend)
apps/mobile     Expo 58 / React Native 0.88, styled-components  (the app)
packages/types        shared TS domain types  (@lumo/types)
packages/api-client   typed fetch client      (@lumo/api-client)
packages/tsconfig     shared tsconfig base    (@lumo/tsconfig)
android/        stray top-level Gradle output, not the app's android project
docker/         EMPTY
metadata.json   leftover from the original AI Studio scaffold; unused
```

The real Android project is **`apps/mobile/android/`**, not `/android/`.

---

## 3. Commands you will actually need

```bash
pnpm install                       # once, from the repo root

docker compose up -d postgres      # Postgres 15 on host port 5434
pnpm --filter api exec prisma generate
pnpm --filter api exec prisma migrate deploy   # migrations are the source of truth
pnpm --filter api exec prisma db seed      # creates josim@example.com / password

pnpm --filter api start:dev        # API — reads API_PORT, defaults to 3005
pnpm --filter mobile start         # Metro / Expo dev server
pnpm --filter mobile android       # expo run:android (needs a dev build)

pnpm build                         # turbo: builds packages then apps
pnpm test                          # turbo: vitest (api, api-client) + jest (mobile)
pnpm --filter api test:e2e         # supertest e2e — needs a live database
pnpm lint
pnpm typecheck                     # ⚠️ CURRENTLY A NO-OP — see below
```

> **`pnpm typecheck` is real** as of Phase 0. It used to resolve all 8 turbo tasks
> to `<NONEXISTENT>` and exit 0 having verified nothing (STD-1 in
> [`docs/audit/TECHNICAL_AUDIT.md`](docs/audit/TECHNICAL_AUDIT.md)). Every package
> defines the script now, test files included, and CI runs it.

**Build order matters.** `packages/types` → `packages/api-client` → `apps/*`.
Turbo handles it via `dependsOn: ["^build"]`. If the mobile app cannot resolve
`@lumo/api-client`, run `pnpm build` — the package ships from `dist/`, not
source.

---

## 4. The facts that trip everyone up

1. **The API port is 3005** everywhere: `getPort()` defaults to it, `.env.example`
   sets it, and the mobile app falls back to it. It used to default to 3001 in
   `main.ts` while the app hardcoded 3005, so nothing connected (KI-1, fixed).

2. **The API base URL is configuration.** `apps/mobile/services/apiService.ts`
   reads `EXPO_PUBLIC_API_URL`, then `EXPO_PUBLIC_API_PORT` against the Metro
   bundler's host, then `localhost:3005`. It used to be a hardcoded LAN IP, so the
   app only worked on one developer's network (KI-1, fixed). A release build with
   no `EXPO_PUBLIC_API_URL` logs an error — set it.

3. **Hazard reports have real coordinates; the map does not.** `HazardReport`
   stores `latitude`/`longitude` with an optional `accuracyMetres`, and the server
   stores what the client sends. There is still **no map SDK** — the dashboard is a
   static JPEG (`apps/mobile/assets/images/map_bg.jpg`) with no projection, so
   reports are listed rather than pinned, and the device cannot read its own
   position yet, so **submitting a report is unavailable** rather than guessing a
   point. The predecessor stored CSS percentages the server invented with
   `Math.random()` (KI-2, ADR-0010).

4. **The SOS screen does not contact anyone, and now says so.**
   `EmergencyModal.tsx` leads with "Nothing has been sent" and offers the phone
   dialler. No call, no SMS, no push, no location upload is wired up, and
   `shareLocationOnSos` / `sendSmsOnSos` are persisted to Postgres and **never
   read**. This is still the biggest gap between the demo and a safety product —
   [KI-3](docs/audit/KNOWN_ISSUES.md).

5. **Auth does not survive a restart.** The JWT lives in a module-level variable
   in `apiService.ts` and `isAuthenticated` is `useState` in `App.tsx`. No
   AsyncStorage, no SecureStore, no refresh token, and logout never clears the
   token — [KI-4](docs/audit/KNOWN_ISSUES.md).

Read [`docs/KNOWN_ISSUES.md`](docs/audit/KNOWN_ISSUES.md) before planning any feature.
It separates _mock_ from _real_ and is kept prioritized.

---

## 5. Conventions

**Backend (`apps/api`)**

- One directory per domain: `auth/`, `settings/`, `hazard-reports/`, `ai/`,
  `prisma/`. Each has `*.module.ts`, `*.controller.ts`, `*.service.ts`, and a
  co-located `*.spec.ts`.
- Controllers own the route string in full: `@Controller('api/v1/settings')`.
  There is **no** global prefix or versioning helper — add the prefix yourself.
- Protect routes with `@UseGuards(JwtAuthGuard)`. `req.user` is `{ id, email }`,
  shaped by `JwtStrategy.validate`.
- Validate input with a DTO in `dto/` + `class-validator`. The pipeline lives in
  `src/app.setup.ts` (`configureApp`) and is shared with the e2e suite, so tests
  run the same validation production does. It uses
  `{ transform: true, whitelist: true, forbidNonWhitelisted: true }` — an unknown
  property is **rejected with a 400**, not stripped. Every endpoint has a DTO.
- Services return **API-shaped objects, not Prisma rows** (see
  `HazardReportsService.toApi`, which derives `confirmationCount` from a relation
  count and `influencesRouting` from the confirmation floor).

**Mobile (`apps/mobile`)**

- Every component is a single `.tsx` with its `styled-components/native` styles
  declared at the top of the same file. The dashboard is the exception: its
  styles live in `App.styled.ts`.
- Icons come from `constants.tsx` (`IconSOS`, `IconAlert`, …) wrapping
  `@expo/vector-icons`. Add new icons there, never import the icon set directly
  in a screen.
- **There is no state manager.** No Redux, no Zustand, no Context. Settings and
  callbacks are passed through React Navigation **route params**
  (`navigation.navigate('Settings', { currentSettings, onSave })`). Non-
  serializable params are a deliberate trade-off here; preserve the pattern or
  replace it wholesale, don't mix.
- Sensor logic belongs in a hook in `hooks/`, shaped like the existing three:
  `(callback, enabled) => void | status`, always cleaning up its subscription.
- Screens talk to the server through `services/apiService.ts` only — never
  `fetch` from a component.

**Shared types**

- `packages/types/src/index.ts` is the source of truth.
- `apps/mobile/types.ts` **duplicates all of it** and adds the navigation param
  lists. The two copies have already drifted once. Edit `packages/types` first,
  then mirror — or collapse them ([KI-6](docs/audit/KNOWN_ISSUES.md)).

**Commits** — Conventional Commits, as in the existing history:
`feat(mobile): …`, `fix: …`, `chore: …`, `test: …`, `docs: …`.

---

## 6. Request path, end to end

```
Screen → services/apiService.ts → @lumo/api-client (ApiClient)
       → HTTP  Bearer <jwt>  → NestJS controller → JwtAuthGuard
       → service → PrismaService → PostgreSQL
```

With one wrinkle: **`login` and `signup` bypass `ApiClient`** and use raw `fetch`
inside `apiService.ts`, duplicating logic that already exists in
`ApiClient.login`/`.signup`. `ApiClient` is used for everything else.

---

## 7. Database

Prisma 5.22, PostgreSQL 15 (Docker, **host port 5434**). Models: `User`,
`TrustedContact`, `HazardReport`, `HazardConfirmation` + enums `HazardType`,
`HazardReportSource`.

**Migrations are the source of truth.** `apps/api/prisma/migrations/` holds a
baseline plus the HazardReport replacement, and CI fails if the history and
`schema.prisma` disagree. Use `prisma migrate deploy`, not `db push` (KI-5, fixed).

**No `@map` on enums.** Members are SCREAMING_SNAKE in Prisma, in Postgres and on
the wire, and the human label lives in `HAZARD_TYPE_LABELS` in `@lumo/types`.
The predecessor `@map`'d `Poor_Lighting` to `"Poor Lighting"` and hand-translated
it in `mapInputType`/`mapOutputType`, so a new member silently fell through to a
default unless all three places were edited. Do not reintroduce that.

**Hazard reports expire.** `expiresAt` is set from a per-type TTL
(`HAZARD_TTL_DAYS`) and list queries filter on it, so a report stops being served
without a cleanup job. A confirmation re-arms it.

Details: [`docs/DATABASE.md`](docs/engineering/DATABASE.md).

---

## 8. AI features

`apps/api/src/ai/ai.service.ts` calls **Google Gemini** via `@google/genai`,
model string `gemini-1.5-flash` (dated — worth upgrading). Reads `process.env.API_KEY`.

Every method returns a **hardcoded fallback** when the key is missing or the call
fails, so the app is fully usable with no key set. Preserve that property: an
emergency feature must never depend on a network AI call succeeding.

---

## 9. Testing

| Target                | Runner             | Command                                      |
| --------------------- | ------------------ | -------------------------------------------- |
| `apps/api` unit       | Vitest             | `pnpm --filter api test`                     |
| `apps/api` e2e        | Vitest + supertest | `pnpm --filter api test:e2e` (needs live DB) |
| `packages/api-client` | Vitest             | `pnpm --filter @lumo/api-client test`        |
| `apps/mobile`         | Jest + `jest-expo` | `pnpm --filter mobile test`                  |

Native modules are mocked globally in `apps/mobile/jest-setup.js`
(`expo-sensors`, `@react-native-voice/voice`, `@expo/vector-icons`). A new native
dependency needs a mock there or the whole suite fails to boot.

More: [`docs/TESTING.md`](docs/engineering/TESTING.md).

---

## 10. Native build notes

- Expo **prebuild/dev-client** workflow. `@react-native-voice/voice` does not work
  in Expo Go — voice activation needs a custom dev build (`expo run:android`).
  `useVoiceActivation` detects this via `NativeModules.Voice` and degrades quietly.
- `@react-native-voice/voice@3.2.4` is **patched** for modern Gradle:
  `patches/@react-native-voice__voice@3.2.4.patch`, wired through `pnpm.patchedDependencies`.
  Do not bump that package without re-checking the patch.
- `apps/mobile/metro.config.js` adds the workspace root to `watchFolders` and both
  `node_modules` paths to `nodeModulesPaths` — required for pnpm hoisting. Don't
  simplify it.

---

## 11. Before you call a change done

- [ ] `pnpm typecheck` and `pnpm lint` pass
- [ ] Tests pass; new behavior has a test next to the code it tests
- [ ] A new endpoint has a DTO, a guard, and a line in [`docs/API.md`](docs/engineering/API.md)
- [ ] A schema change updates `schema.prisma`, the enum mappers (if touched),
      `packages/types`, `apps/mobile/types.ts`, and [`docs/DATABASE.md`](docs/engineering/DATABASE.md)
- [ ] Anything you discovered that contradicts these docs is written back into them
- [ ] A gap you created or confirmed is added to [`docs/KNOWN_ISSUES.md`](docs/audit/KNOWN_ISSUES.md)

## 12. Project skills

Seven skills in `.claude/skills/` encode the safety discipline. Invoke the relevant
one rather than re-deriving the rules:

| Skill                  | When                                                                                           |
| ---------------------- | ---------------------------------------------------------------------------------------------- |
| `emergency-review`     | Any diff touching SOS, triggers, notifications, escalation, location, evidence, or safety copy |
| `safety-spec`          | Writing or changing anything in `docs/specs/` or the PRD                                       |
| `delivery-ledger`      | Notification states, channel capabilities, incident rollup                                     |
| `region-profile`       | Adding or validating a market                                                                  |
| `safety-state-machine` | `packages/safety-domain`, sessions, incidents, idempotency                                     |
| `a11y-safety`          | Any safety-critical UI                                                                         |
| `lumo-docs`            | After editing docs — ID, link and format checks                                                |

## 13. The four invariants

These override convenience, and a change that breaks one is rejected:

1. **No success state without a verified record** (PLAT-9). Enforced by
   `scripts/check-no-fake-success.mjs` in CI; the escape hatch
   (`lumo-verified-claim`) makes you name the record that proves the claim.
2. **AI emits signals; a deterministic engine decides** ([ADR-0013](docs/adr/0013-ai-never-decides.md)).
3. **Distinguish attempted / delivered / acknowledged** — never one tick
   ([ADR-0012](docs/adr/0012-delivery-ledger.md)).
4. **No configuration may track someone without a visible, revocable indicator on
   their own device** (T2). Instant rejection.

## 14. Do not

- Commit secrets. `JWT_SECRET` has no fallback and the API refuses to boot without
  a real one (KI-9); do not reintroduce a default. `API_KEY` is still optional
  because every AI method has a hardcoded fallback — see §8.
- Trust `docs/archive/*`. Those are historical snapshots with claims that were
  never true; [`docs/KNOWN_ISSUES.md`](docs/audit/KNOWN_ISSUES.md) supersedes them.
- Describe a mock as a shipped feature. Half of the UI is a prototype, and a user
  trusting a fake SOS is the worst outcome this project can produce.
