# Location

> **Safety-critical.** Implements `RES-10` (live location sharing) and the capture half of
> `PRO-7` (sharing transparency). Before this file existed `RES-10` had no owning spec; it was
> relied on by the journey, incident and evidence specs without being defined anywhere.
> Resolution of _which market's rules apply_ is in [`REGION_PROFILES.md`](REGION_PROFILES.md).
> Threat context: T2 (a tracked person with no visible indicator) in
> [`../engineering/THREAT_MODEL.md`](../engineering/THREAT_MODEL.md).

## Why it exists

An alert that says "I need help" is worth far less than one that says _where_. But a position
shown without its age or precision is worse than none: a pin that is ten minutes stale, or off
by a kilometre, sends someone to the wrong place with false confidence. And location is the
data a stalker wants. So this spec is mostly about what location may **not** claim and may
**not** do.

## The four-part contract

| Part                           | Statement                                                                                                                                                                                                      |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Owner**                      | Capture, display and place-resolution: `apps/mobile` (`hooks/useLocation`, `services/locationFormat`). Storage and ownership checks: `apps/api/src/location` (`LocationService`).                              |
| **Supported platform**         | Foreground capture on Android and iOS, with the app open. **Not supported in this milestone:** background capture, and any capture while the app is closed (see _Limits_).                                      |
| **Failure path**               | Permission denied or permanently denied → the dashboard says location is off and links to Settings. No fix → says so. A fix with unknown accuracy → treated as no fix. Geocoder fails → position kept, place unresolved and **said** to be unresolved. |
| **Testable completion** | See _Required tests_. Each rule below is an assertion, not a description.                                                                                                                                      |

## The behaviour

### A fix is never shown bare

Every location carries, and every display states, **how old it is** and **how precise it is**:

> Last location 9:41 PM (2 min ago), ±18 m

- **Accuracy is mandatory.** A fix whose accuracy is unknown (`null`) is **not a usable fix**. It
  is never coerced to `0`, which would claim perfect precision, and it is never stored.
- **Age is mandatory and computed from an injected clock.** A fix older than
  `CURRENT_FIX_MAX_AGE_MS` (five minutes, defined once in `@lumo/region-profiles`) is **stale**: it
  is shown as "last known", never as where the person is now.
- **Honest copy.** What the device shows must not imply anything is shared. "Location on" means
  Lumo can read the position; it does not mean anyone else can.

### Permission is asked at the moment of use

- **Foreground only** (`whenInUse`). Background location is a different permission, a different
  store review, and a different promise; it is a decision for the session-start flow (milestone
  1.10), asked with its own rationale. The app must not request it, and the generated Android
  manifest must not contain `ACCESS_BACKGROUND_LOCATION`.
- Asked after the user takes an action, behind a screen that says what Lumo will do with the
  position, when, and what stops working without it. Never a prompt at launch.
- **Denied** and **permanently denied** (the OS will not ask again) are different states. The
  second offers a route to the system settings, because asking again does nothing.

### Capture runs only while it is useful

Watching starts when the dashboard is focused **and** the app is in the foreground, and stops on
blur and on backgrounding. The subscription is always removed on cleanup. A battery that drains
because a screen forgot to stop listening is a safety failure of its own.

### A place is worked out from a fix, and belongs to that fix

Coordinates become a country and subdivision (so the region resolver can pick the right
emergency number and recording rule) by reverse geocoding on the device.

- The geocoder returns names, not codes, and the platform does not document the format of
  `region` (name, abbreviation or code). So the country comes from `isoCountryCode`, and the
  subdivision from an **explicit, exact-match table** in `@lumo/region-profiles`. Anything not in
  the table is **unknown**, never fuzzy-matched — an unknown subdivision costs only a "possible"
  label on a regional number; a wrong one sends someone to a number that does not answer.
- A geocode is **attached to the fix it came from**. A newer fix never inherits an older one's
  country: someone who crossed a border since is not in the country they were in.
- If a fix exists but the geocoder fails (offline, rate-limited), the resolver must say
  **"we have your position but couldn't tell which country you are in"** and must not quietly use
  the account country as if it were confirmed.
- Geocoding is rate-limited by the platform. It is requested only when the position has moved
  materially or the last result is old, not on every fix.

### Storage (server)

`LocationService` is the single write path for snapshots. It is called by the incident flow
(1.8) and the session flow (1.10); **it has no HTTP route of its own yet**, because a snapshot
belongs to a session or an incident and neither can be created over HTTP until then.

- **Ownership.** A snapshot is written only for a session or incident that belongs to the caller,
  and only while it is not terminal. A snapshot has no `userId` of its own, so ownership _is_ the
  access control.
- **Validated before the database.** Coordinates in range, accuracy present and non-negative,
  battery 0–100, `capturedAt` not in the future beyond a small clock skew and not older than a
  day. The database CHECK constraints are a backstop; a CHECK violation carries the failing row
  — **including the coordinates** — in its error detail, so the DTO must reject first.
- **Decay is mandatory.** `expiresAt` comes from the owner's region profile `retention.locationDays`.
  With no region set, the **shortest** retention among the known profiles applies, and that choice
  is logged (without the data).
- **Retries do not duplicate.** A batch resent after a dropped connection is idempotent, enforced
  by a unique index, not by checking first.
- **Never logged.** No coordinate appears in any log line or error response.

## The limits

- **Nothing is shared in this milestone.** Capture and local display exist; _uploading_ a position
  for someone else to see does not. There is no session to attach it to (1.10), no incident (1.8),
  and no recipient page (1.11). A share control that shared with nobody would be a success state
  with no verified record. The upload loop, the sharing control and the sharing indicator ship
  **together**, with sessions, so a share can never exist without both its indicator and a recipient.
- **Foreground only.** If the app is closed or backgrounded, no position is read. A journey that
  needs the phone in a pocket needs background location, requested then, with its own review.
- **GPS lies.** Indoors, in a canyon of buildings, or with the phone's mock-location setting, a fix
  can be wrong by hundreds of metres and still report a small accuracy. The accuracy shown is the
  device's claim, not a guarantee.
- **The geocoder needs the network** (assumed; the platform docs do not say), so it can fail
  exactly when the person is somewhere with a poor signal. The position then stays unplaced.
- **Unsent snapshots are not durable.** There is no upload queue yet; the offline queue is
  milestone 1.13.
- **No ground truth for "stale".** Five minutes is a choice (KNOWN_ISSUES KI-54), not a measurement.

## Required tests

| Rule                                                   | Proven by                                                                          |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| A fix is never shown without age and accuracy          | `locationFormat` tests                                                             |
| A stale fix is never presented as current              | `locationFormat` tests (boundary at exactly the limit, and one millisecond past)   |
| Unknown accuracy is not a usable fix and is not zero   | `useLocation` and `LocationService` tests                                          |
| Permission denied / permanently denied degrade honestly | `useLocation` and dashboard tests                                                 |
| No background permission                               | generated manifest checked in this milestone; asserted in `app.json` config         |
| Watching stops on blur, on background, on cleanup      | `useLocation` tests (subscription `remove` called)                                 |
| A geocode belongs to its fix                           | `useLocation` tests                                                                |
| Unmapped region name → unknown, never guessed         | `@lumo/region-profiles` place tests                                                |
| Ownership, terminal owners, validation                 | `LocationService` unit tests and the database suite                                |
| A retried batch does not duplicate                     | database suite (unique index)                                                      |
| A CHECK-rejected write logs no coordinates             | database suite with captured log output                                            |
| `expiresAt` follows the region retention               | `LocationService` tests                                                            |

## Observability

Counts and latencies only: fixes captured, fixes rejected (by reason), batches written, geocode
failures. **Never** coordinates, never an address, never a place name (PLAT-8).

## Edge cases

Cross-reference [`../audit/EDGE_CASES.md`](../audit/EDGE_CASES.md): no GPS fix, stale GPS fix,
GPS drift, permission revoked after grant, wrong device clock, roaming changes the emergency
number.
