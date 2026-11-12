# Contributing

For humans and agents alike. Start with [`../CLAUDE.md`](../CLAUDE.md) — it is the
short version of everything here.

---

## Before you write code

1. Read [`../CLAUDE.md`](../CLAUDE.md) — the five facts in §4 will save you an hour.
2. Check [FEATURES.md](audit/FEATURES.md). **Confirm whether what you are building on is
   real or a mock.** Half this UI is a prototype.
3. Check [KNOWN_ISSUES.md](audit/KNOWN_ISSUES.md) for a `KI-n` that already covers it.
4. If the change is architectural, write an [ADR](adr/README.md) first.

---

## Workflow

```bash
git switch -c feat/real-sos-dispatch      # never commit to main directly
# … change, test …
pnpm lint && pnpm typecheck && pnpm test
git commit -m "feat(api): add POST /sos with contact fan-out"
```

Branch prefixes, matching the existing history: `feat/`, `fix/`, `chore/`,
`docs/`, `test/`, `refactor/`.

### Commit messages

[Conventional Commits](https://www.conventionalcommits.org/), as already used
here:

```
feat(mobile): configure native dev build and patch react-native-voice
fix: resolve expo compatibility, update sensors, seed auth
test: add comprehensive unit, integration, and E2E test suites
chore: configure gitignore, dockerignore, prettierignore
docs: add final production readiness audit
```

Scopes: `api`, `mobile`, `types`, `api-client`, `db`, `ci`, `docs`. Reference
issues as `KI-3` in the body. Explain **why** in the body when the what is not
obvious.

### Pull requests

- One concern per PR.
- Describe the user-visible effect, not the diff.
- Say what you tested, including what you tested **on a device** — unit tests
  cannot validate a sensor threshold or a wake word.
- Call out anything that is still a mock, so a reviewer never mistakes it for working.
- Update the docs in the same PR (see below).

---

## Definition of done

- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` pass
- [ ] New behavior has a test next to the code it tests ([TESTING.md](engineering/TESTING.md))
- [ ] No new `console.log` in a hot path; no commented-out code
- [ ] No secrets, no hardcoded IPs, no hardcoded hostnames
- [ ] The docs below are updated
- [ ] Anything you discovered that contradicts a doc is written back into it

### Docs that must move with the code

| You changed                | Update                                                                           |
| -------------------------- | -------------------------------------------------------------------------------- |
| An endpoint                | [API.md](engineering/API.md), `ApiClient`, both type copies                      |
| `schema.prisma`            | [DATABASE.md](engineering/DATABASE.md), a migration, the enum mappers if touched |
| A screen or navigation     | [MOBILE.md](engineering/MOBILE.md) and the param list in `types.ts`              |
| Anything mock → real       | [FEATURES.md](audit/FEATURES.md) ← **the most important one**                    |
| A setup step               | [DEVELOPMENT.md](engineering/DEVELOPMENT.md)                                     |
| An architectural decision  | A new [ADR](adr/README.md)                                                       |
| A gap you found or created | [KNOWN_ISSUES.md](audit/KNOWN_ISSUES.md)                                         |

Stale docs are how this repo ended up with an audit claiming migrations existed
when they never did. Don't add to it.

---

## Code conventions

The full set is in [`../CLAUDE.md`](../CLAUDE.md) §5. The short version:

**API** — one folder per domain; controllers spell out `api/v1/...`; every input
gets a DTO; every protected route gets `@UseGuards(JwtAuthGuard)`; services return
API shapes, not Prisma rows; specs sit beside their source.

**Mobile** — styles at the top of the component file; icons via `constants.tsx`;
network via `apiService` only; sensor logic in a `hooks/` hook with the
`(callback, enabled)` shape and a cleanup return; add
`accessibilityLabel`/`accessibilityRole` to anything tappable.

**Types** — edit `packages/types/src/index.ts` first, then mirror
`apps/mobile/types.ts` until [KI-6](audit/KNOWN_ISSUES.md) is fixed.

---

---

## The four invariants

These override convenience. A change that breaks one is rejected, regardless of how
useful it is:

1. **No success state without a verified record** (PLAT-9). The SOS screen currently
   violates this — it says "Emergency Calling…" and contacts nobody.
2. **AI emits signals; a deterministic engine decides**
   ([ADR-0013](adr/0013-ai-never-decides.md)).
3. **Distinguish attempted / delivered / acknowledged** — never one tick
   ([ADR-0012](adr/0012-delivery-ledger.md)).
4. **No configuration may track someone without a visible, revocable indicator on
   their own device** (threat T2). Instant rejection.

## Use the project skills

Seven skills in `.claude/skills/` encode this discipline. Invoke the relevant one
rather than re-deriving the rules:

| Skill                  | When                                                                                              |
| ---------------------- | ------------------------------------------------------------------------------------------------- |
| `emergency-review`     | **Any** diff touching SOS, triggers, notifications, escalation, location, evidence or safety copy |
| `safety-spec`          | Writing or changing anything in `docs/specs/` or the PRD                                          |
| `delivery-ledger`      | Notification states, channel capabilities, incident rollup                                        |
| `region-profile`       | Adding or validating a market                                                                     |
| `safety-state-machine` | `packages/safety-domain`, sessions, incidents, idempotency                                        |
| `a11y-safety`          | Any safety-critical UI                                                                            |
| `lumo-docs`            | After editing docs — requirement-ID, link and format checks                                       |

`emergency-review` is not optional for emergency-path changes. It is the gate that
catches fake success states, missing failure paths, SOS blocked on auth, unbounded
loops and copy that exceeds platform capability.

## Requirement IDs

Every feature traces to an ID in [`product/PRD.md`](product/PRD.md)
(`PREV-` `DET-` `RES-` `PRO-` `REC-` `PLAT-`). An ID is assigned once, never reused,
has testable acceptance criteria, and appears in exactly one phase of
[`product/ROADMAP.md`](product/ROADMAP.md). Reference the ID in the PR.

## Four rules specific to a safety app

These are not style preferences. They are why the product exists.

1. **Never ship a UI that implies help is coming when it is not.** The current SOS
   screen is the cautionary example: it says "Emergency Calling…" and contacts
   nobody. If a feature is a demo, label it a demo.
2. **Degrade, don't fail.** Every safety path needs a working fallback — no
   network, no permission, no API key, sensor unavailable. `AiService` already does
   this correctly; copy the pattern.
3. **Report real state.** "Message sent to Mom and 2 others" beats "Notifying your
   contacts". Show per-contact delivery, including failures.
4. **Treat location and contacts as dangerous data.** Minimum collection, visible
   and revocable sharing, no coordinates in logs. Read
   [SECURITY_AND_PRIVACY.md](engineering/SECURITY.md) — especially threat T1,
   where the attacker holds the phone.

---

## For AI agents specifically

- **Verify before you assert.** The archived audits in [`archive/`](archive/) claim
  things that were never true. Read the file, then write the doc.
- **State what is mock.** If you summarize this app's capabilities without
  flagging the mocks, you are producing a misleading answer.
- **Keep the scope you were given.** This repo has a long list of known gaps; fixing
  an unrelated one mid-task buries the change the user asked for.
- **Write discoveries back.** If you spend twenty minutes learning something
  non-obvious, add it to the right doc so the next agent spends zero.
- **Don't introduce a fourth name.** Three is already the problem — see
  [BRANDING.md](gtm/BRANDING.md).
