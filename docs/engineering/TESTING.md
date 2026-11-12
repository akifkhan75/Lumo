# Testing

Three suites, two runners — because the API/packages run on Node with Vitest and
the mobile app needs the React Native transform pipeline, which `jest-expo`
provides. Don't try to unify them.

| Target                | Runner                | Config                                 | Command                               |
| --------------------- | --------------------- | -------------------------------------- | ------------------------------------- |
| `apps/api` unit       | Vitest 4              | `apps/api/vitest.config.ts`            | `pnpm --filter api test`              |
| `apps/api` e2e        | Vitest + supertest    | `apps/api/vitest.config.e2e.ts`        | `pnpm --filter api test:e2e`          |
| `packages/api-client` | Vitest 4              | `packages/api-client/vitest.config.ts` | `pnpm --filter @lumo/api-client test` |
| `apps/mobile`         | Jest 30 + `jest-expo` | `apps/mobile/jest.config.js`           | `pnpm --filter mobile test`           |

`pnpm test` at the root runs all of them through Turbo, after building
dependencies (`test` has `dependsOn: ["^build"]`).

---

## API

Specs sit next to the code they test: `auth.service.spec.ts` beside
`auth.service.ts`. Keep that.

```
apps/api/src/
├── app.controller.spec.ts
├── auth/      auth.controller.spec.ts  auth.service.spec.ts  jwt.strategy.spec.ts
├── settings/  settings.controller.spec.ts  settings.service.spec.ts
├── hazard-reports/ hazard-reports.controller.spec.ts  hazard-reports.service.spec.ts
│                   dto/create-hazard-report.dto.spec.ts
├── ai/        ai.controller.spec.ts  ai.service.spec.ts
└── prisma/    prisma.service.spec.ts
```

Pattern: `Test.createTestingModule` with `PrismaService` replaced by a mock
provider, so unit tests need no database.

```bash
pnpm --filter api test
pnpm --filter api test:watch
pnpm --filter api test:cov       # v8 coverage
pnpm --filter api test:debug
```

### What to cover on a new endpoint

- the happy path
- each validation failure the DTO can produce
- unauthorized (no token) and, where relevant, another user's resource
- the not-found branch
- for anything touching Gemini: **the fallback path** — assert that a thrown
  client still returns `200` with the fallback body. That property is a product
  requirement, not an implementation detail.

---

## API e2e

`apps/api/test/api.e2e-spec.ts` and `app.e2e-spec.ts`. They boot the real
`AppModule` with the same `ValidationPipe` as production and drive it with
supertest.

```bash
docker compose up -d postgres
pnpm --filter api test:e2e
```

**These hit a real database.** The suite avoids collisions by generating a unique
user per run (``email: `e2e_${Date.now()}@example.com` ``) and then signing up to
obtain a token for the protected routes. That also means **the suite leaves rows
behind** — each run adds a user and any zones it creates. Periodically reset:

```bash
docker compose down -v && docker compose up -d postgres
pnpm --filter api exec prisma db push && pnpm --filter api exec prisma db seed
```

Covered: root health, signup/login, rejecting unauthenticated access to protected
routes, settings round-trip, hazard-report create/list/confirm, AI endpoints.
It runs the same request pipeline as production via `configureApp` from
`src/app.setup.ts` — it used to build a looser `ValidationPipe` of its own, so an
unknown property was accepted in tests and rejected in production.

---

## Mobile

```
apps/mobile/__tests__/
├── App.test.tsx                 root render / navigation
├── authComponents.test.tsx
├── commonComponents.test.tsx
├── featureScreens.test.tsx      the modal screens
├── settingsComponents.test.tsx
├── apiService.test.ts           fetch/ApiClient mocked
├── useShakeDetector.test.tsx
├── useAccidentDetector.test.tsx
└── useVoiceActivation.test.tsx
```

```bash
pnpm --filter mobile test
pnpm --filter mobile test -- --coverage
pnpm --filter mobile test -- useShakeDetector
```

### Global native mocks — read this before adding a dependency

`apps/mobile/jest-setup.js` mocks the native surface for the whole suite:

| Mocked                              | Why                                                                              |
| ----------------------------------- | -------------------------------------------------------------------------------- |
| `@expo/vector-icons` (+ `/Feather`) | Icon fonts don't exist in a Node test env                                        |
| `expo-sensors` `Accelerometer`      | `addListener` returns `{ remove }`; availability and permissions resolve granted |
| `@react-native-voice/voice`         | Full stub with all `onSpeech*` handlers                                          |

**A new native module without a mock here fails the entire suite at boot, not just
its own test.** Add the mock in the same commit as the dependency.

### transformIgnorePatterns

`jest.config.js` whitelists the packages that ship untranspiled ESM — React
Native, Expo, React Navigation, and crucially `@lumo/.*`:

```js
"node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|…|@lumo/.*)";
```

A new workspace package consumed by the app must match that pattern, or you get
`SyntaxError: Cannot use import statement outside a module`.

### Coverage scope

```js
collectCoverageFrom: [
  "hooks/**",
  "services/**",
  "components/**",
  "!**/__tests__/**",
];
```

`App.tsx` and `App.styled.ts` are **outside** the collection scope, so
`DashboardScreen` — which owns all the app's state — does not register in the
coverage number. Treat the mobile figure as partial.

---

## Gaps

| Missing                                          | Impact                                                                                                                                                                |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **No CI**                                        | Nothing runs on a PR. Everything above is opt-in. ([KI-11](../audit/KNOWN_ISSUES.md))                                                                                 |
| No device/E2E tests                              | No Detox or Maestro; navigation and sensors are only unit-tested                                                                                                      |
| Sensors tested via mocks only                    | A real 2.5 G shake threshold has never been validated on hardware — and for a trigger that summons help, false-negative and false-positive rates are product-critical |
| No contract test between client and API          | `ApiClient` tests assert against hand-written mock responses, so the API could change shape without failing a test. The e2e suite is the only real guard              |
| No load or soak testing                          | —                                                                                                                                                                     |
| `apps/mobile/types.ts` vs `packages/types` drift | No test would catch it ([KI-6](../audit/KNOWN_ISSUES.md))                                                                                                             |

### The CI workflow to add first

```yaml
# .github/workflows/ci.yml
name: CI
on: [pull_request, push]
jobs:
  verify:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:15-alpine
        env:
          POSTGRES_USER: lumo
          POSTGRES_PASSWORD: lumo_password
          POSTGRES_DB: lumo_db
        ports: ["5434:5432"]
        options: >-
          --health-cmd "pg_isready -U lumo -d lumo_db"
          --health-interval 5s --health-timeout 5s --health-retries 5
    env:
      DATABASE_URL: postgresql://lumo:lumo_password@localhost:5434/lumo_db?schema=public
      JWT_SECRET: ci-test-secret
      API_PORT: "3005"
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm build
      - run: pnpm lint
      - run: pnpm typecheck
      - run: pnpm test
      - run: pnpm --filter api exec prisma db push
      - run: pnpm --filter api test:e2e
```

---

## Conventions

- Co-locate API specs with their source; mobile tests go in `__tests__/`.
- One behavior per `it`, named as a sentence: `it('rejects a duplicate email')`.
- Mock at the boundary — `PrismaService` on the server, `fetch` on the client.
  Don't mock the code under test.
- A bug fix lands with the test that would have caught it.
- A new endpoint lands with: a unit test, an e2e case, an `ApiClient` test, and a
  line in [API.md](API.md).
