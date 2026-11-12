# Technical Audit

> 27 findings across six dimensions, verified against the source 2026-10-26/27.
> Open items are tracked in [`KNOWN_ISSUES.md`](KNOWN_ISSUES.md) as `KI-n`.

## Verdict against a top-tier bar

**Structure and boundaries are genuinely good:** domain-sliced modules, shared types,
co-located specs, a correct `PrismaService` lifecycle, `strict: true` everywhere, and
AI-fallback discipline better than most production code.

**What is missing is the entire operational layer:** no CI, no working typecheck, no
migrations, no rate limiting, no observability, no pagination, no accessibility. This
is prototype-grade infrastructure under well-organised application code.

## Correctness

| ID    | Sev | Finding                                                                                                                                                                                                                                                                                                            |
| ----- | --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| APP-1 | 🔴  | **Unbounded alert + request loop.** `App.tsx:140-151` — the effect depends on `userSettings` and its body calls `handleSaveSettings`, which replaces `userSettings` → the effect re-runs. `voiceError` never clears. Result: an infinite `Alert` queue and infinite `PUT /settings`, in the hands-free safety path |
| APP-2 | 🟠  | **Sensor re-subscription churn.** `handleActivateEmergency` is keyed on `userSettings` and passed to all three hooks, so every settings save tears down the accelerometer listeners and **destroys/restarts speech recognition**                                                                                   |
| APP-3 | 🟡  | **Two independent accelerometer subscriptions** at 100 Hz computing the same magnitude. Battery doubled for no benefit                                                                                                                                                                                             |
| APP-4 | 🟡  | `exhaustive-deps` not enforced, so APP-1-class bugs are invisible to lint                                                                                                                                                                                                                                          |

## API

| ID    | Sev | Finding                                                                                                                                                                                                 |
| ----- | --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API-1 | 🟠  | No `helmet`, no `compression`, no throttler. `/auth/login` is openly brute-forceable; `/ai/*` is an uncapped cost vector                                                                                |
| API-2 | 🟠  | No global exception filter. Validation returns `message` as an **array**, plain exceptions as a **string** — arrays reach the UI stringified                                                            |
| API-3 | ✅  | ~~**No pagination anywhere.** `GET /danger-zones` is an unbounded `findMany` over every row ever created~~ — `GET /hazard-reports` takes `take`, default 50, capped at 200 (2026-10-27)                 |
| API-4 | 🟡  | No request logging, correlation ID, or real health endpoint (`GET /` returns a hello string)                                                                                                            |
| API-5 | ✅  | ~~`mapInputType` has no error branch — an unrecognised `type` silently becomes `Suspicious_Activity`~~ — the mappers are gone; one enum spelling everywhere and `@IsEnum` rejects the rest (2026-10-27) |

## Database

| ID   | Sev | Finding                                                                                                                                                             |
| ---- | --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DB-0 | 🔴  | `top`/`left` as CSS-percentage strings; no lat/lng; **the server fabricates every position**. Blocks the entire prevention half of the product (ADR-0006, ADR-0010) |
| DB-1 | 🟡  | **No explicit indexes at all** — not even on `reportedAt`, the sole sort key                                                                                        |
| DB-2 | 🟡  | No soft delete, audit trail or retention policy. For a safety app an incident record **is evidence**                                                                |
| DB-3 | 🟡  | All PII plaintext: email, name, blood type, allergies, contact phones                                                                                               |
| DB-4 | 🟠  | **No migrations have ever existed.** Schema applied with `db push`; the archived audit's claim is false                                                             |
| DB-5 | 🟠  | Contact save = `deleteMany` + `createMany`, **not transactional**. A failure between them leaves the user with **zero emergency contacts**                          |

## Performance

| ID     | Sev | Finding                                                                                                                                                    |
| ------ | --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PERF-1 | 🟠  | 100 Hz accelerometer ×2 plus continuous ASR with a 500 ms restart loop. No duty cycling, no motion gating. **The main reason safety apps get uninstalled** |
| PERF-2 | 🟡  | Hazard pins: `map()` with a per-pin `Animated.loop`. Unvirtualised — N pins = N infinite animations. Degrades past ~50                                     |
| PERF-3 | 🟡  | No list virtualisation; `ScrollView` for variable-length content                                                                                           |
| PERF-4 | ⚪  | No image optimisation; assets bundled raw                                                                                                                  |

## Security

| ID    | Sev | Finding                                                                                                                                                           |
| ----- | --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SEC-0 | 🔴  | `JWT_SECRET` falls back to `'super-secret-default-key'` in **two** files. A deploy missing the env var ships a publicly-known signing key — every token forgeable |
| SEC-1 | 🟠  | `app.enableCors()` with no options — all origins                                                                                                                  |
| SEC-2 | 🟠  | No rate limiting on auth (credential stuffing) or AI (cost abuse)                                                                                                 |
| SEC-3 | 🟠  | No refresh token, no revocation. A stolen 7-day JWT cannot be invalidated                                                                                         |
| SEC-4 | 🟡  | `MinLength(6)` is the only password rule; no breach check, verification or reset                                                                                  |
| SEC-5 | 🟡  | Seed credentials prefilled in `AuthScreen.tsx`                                                                                                                    |
| SEC-6 | 🟡  | `safetyChat` interpolates user input into the prompt — injection surface, high impact once the assistant can act                                                  |

## Standards

| ID    | Sev | Finding                                                                                                                                                                                          |
| ----- | --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| STD-1 | 🟠  | **`pnpm typecheck` is a silent no-op.** `turbo run typecheck --dry` resolves all 8 tasks to `<NONEXISTENT>` — it exits 0 having checked nothing, while the docs instruct you to use it as a gate |
| STD-2 | 🟡  | `packages/types` and `api-client` define no `lint`; mobile excludes `__tests__` from TS checking; mobile tsconfig maps `paths` to a non-existent `src/`                                          |
| STD-3 | 🟠  | **Zero accessibility attributes in the entire app.** For a product used under stress, one-handed, in the dark, this is a functional defect                                                       |
| STD-4 | 🟠  | `pnpm lint` fails with 27 pre-existing errors, so it cannot serve as a CI gate as-is                                                                                                             |
| STD-5 | 🟠  | No CI, no API `Dockerfile`, empty `docker/`                                                                                                                                                      |
| STD-6 | 🟡  | `apps/mobile/types.ts` duplicates `packages/types` verbatim — guaranteed drift, no test would catch it                                                                                           |
| STD-7 | 🟡  | `gemini-1.5-flash` pinned in three places; dated and duplicated rather than configured                                                                                                           |
| STD-8 | ⚪  | iOS has **never been built or tested**                                                                                                                                                           |
| STD-9 | 🟡  | Dead paths: `docker/`, a stray root `/android/`, `metadata.json`. The three empty packages and `data/dangerZones.ts` are deleted (2026-10-27)                                                    |

## Fix order

SEC-0 + DB-4 + STD-1/4/5 (Phase 0 — cheap, and they gate deployability) → APP-1
(active defect) → DB-0 (unblocks everything) → the response chain (Phase 1–2).
