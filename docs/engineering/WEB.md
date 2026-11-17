# Web App (`apps/web`)

> **Status (1.11):** built, not yet verified end to end or deployed. The page is a server component that calls `GET /api/v1/j/:token`
> from the server (token never reaches browser script); a PIN is held in an httpOnly cookie scoped to that link's path. The app's share control and indicator are built (KI-109). Gaps: KI-108, KI-110 – KI-115.
> Run: `LUMO_API_URL=http://localhost:3005 pnpm --filter web dev` (port 3006).

> **Phase 1, deliberately minimal:** the tokenised journey page and nothing else.
> Implements RES-11. Next.js + TypeScript.

## Why it exists

A trusted contact follows a journey **in a browser, with no app installed**. This is
both the cross-platform advantage Google cannot match without owning both platforms,
and the growth loop: the contact experiences the product before installing anything.

## Scope — Phase 1

One route: `GET /j/:token`.

Shows only what the user authorised: current or last-known location **with age and
accuracy** · expected arrival · session status · emergency guidance for the region ·
an **I'm responding** action (RES-6).

**Never:** medical data · evidence or recording links · location history · the user's
contact list · anything about other sessions.

## Security

- Opaque token, **≥128 bits** of entropy, not derived from any identifier
- Configurable expiry, short by default; **revocable in one action** by the user
- `noindex`, no referrer leakage, no third-party scripts, no analytics that could
  receive coordinates
- Optional PIN on the link
- Rate-limited per token; enumeration must be infeasible
- Unauthenticated **by design** — the token _is_ the credential, which is exactly why
  the exposed surface must stay this small (T6)

## Deliberately out of scope for Phase 1

Account portal · marketing site · admin or organisation dashboards · evidence access.
Each is a substantial second frontend competing with mobile reliability work, and none
is required for the loop above.

## Tests

Expired token refused · revoked token refused · no medical or evidence data in any
response · acknowledgement path works and halts escalation · stale location rendered
with its age · token enumeration infeasible · page usable on a low-end mobile browser.
