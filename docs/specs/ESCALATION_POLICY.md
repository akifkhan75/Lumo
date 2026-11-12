# Escalation Policy

> Implements RES-4. Evaluated by the deterministic engine in `packages/safety-domain`
> — never by a model ([ADR-0013](../adr/0013-ai-never-decides.md)).

## What it is

A user-owned, ordered plan describing **who is contacted, in what order, over which
channels, with what timeouts** — and when to stop. It is the difference between "we
texted someone" and a response that actually reaches a human.

The policy is **visible to the user before it runs** (RES-4). A user who cannot
predict what their app will do cannot trust it.

## Shape

```ts
interface EscalationPolicy {
  id: string;
  userId: string;
  name: string; // "Walk home", "Hiking"
  isDefault: boolean;

  graceSeconds: number; // default 300 · min 60 · see below
  steps: EscalationStep[]; // ordered, 1..n
  maxRecipientsPerIncident: number; // default 5
  stopOnAcknowledgement: boolean; // default true
  resumeOnUnacknowledge: boolean; // default true
  promptEmergencyNumberOnFailure: boolean; // default true
  deviationGraceSeconds: number; // default 180 — route deviation, not check-in
}

interface EscalationStep {
  order: number;
  recipients: RecipientRef[]; // contact ids, or a circle reference
  channels: Channel[]; // preference order; fallback runs within a step
  timeoutSeconds: number; // default 120 — before advancing to the next step
  requireAck: boolean; // default true
}
```

## Defaults, and why

| Value                      | Default                 | Reasoning                                                                                                                                                                                                  |
| -------------------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `graceSeconds`             | **300** (5 min), min 60 | An ordinary delay is not evidence of an attack. A zero or near-zero grace is how a safety app turns traffic into an emergency and gets uninstalled. The minimum is enforced — a user cannot set it to zero |
| `timeoutSeconds` per step  | **120**                 | Long enough for someone to notice a phone; short enough that a four-step ladder completes in ~8 minutes                                                                                                    |
| `maxRecipientsPerIncident` | **5**                   | Bounds fan-out cost and alert fatigue. Also bounded independently by the PLAT-5 spend cap                                                                                                                  |
| `stopOnAcknowledgement`    | **true**                | Once a human is responding, further alerts add noise, cost and fatigue                                                                                                                                     |
| `resumeOnUnacknowledge`    | **true**                | A contact who says "I can't help after all" must not leave the user stranded                                                                                                                               |
| `deviationGraceSeconds`    | **180**                 | A single off-route fix is GPS drift or a shop. Three minutes distinguishes a detour from a diversion                                                                                                       |

All six are tunable per policy and overridable per region profile. They are config, not
architecture.

## Per-template defaults

From [`SAFETY_CHECK.md`](SAFETY_CHECK.md) — tolerance must match the activity, or the
policy is wrong in one direction or the other:

| Template         | Grace | Step timeout | Steps                                          |
| ---------------- | ----- | ------------ | ---------------------------------------------- |
| Walk Home        | 180s  | 90s          | contact 1 → contact 2 → prompt dial            |
| Date Check-In    | 300s  | 120s         | contact 1 (discreet) → contact 2 → prompt dial |
| Ride Check-In    | 180s  | 90s          | contact 1 → contact 2 → prompt dial            |
| Travel Check-In  | 1800s | 300s         | contact 1 → contact 2                          |
| Outdoor Activity | 3600s | 600s         | contact 1 → contact 2                          |
| Custom           | user  | user         | user                                           |

A hiking session tolerating hours without signal and a walk home tolerating three
minutes are both correct; one policy for both is not.

## Evaluation

```
GRACE_EXPIRED
  → step = 1
  → for each recipient in step.recipients (parallel):
        run the channel fallback chain (DELIVERY_LEDGER.md §5)
  → wait step.timeoutSeconds
  → if acknowledged and stopOnAcknowledgement → HALT
  → if more steps remain → step += 1, repeat
  → else if promptEmergencyNumberOnFailure → surface the region-correct dial action
  → incident settles to NOTIFIED / PARTIALLY_NOTIFIED / ALL_CHANNELS_FAILED
```

**Invariants**

1. Recipients are only ever contacted if **consented** (RES-7). A non-consented
   contact is skipped, and the skip is ledgered with its reason — never hidden.
2. The ladder halts **immediately** on acknowledgement; in-flight attempts are not
   cancelled but no new step begins.
3. `UNACK` resumes from the step that was in flight, not from the beginning.
4. Total attempts are bounded by `maxRecipientsPerIncident` **and** the spend cap.
   Whichever binds first is ledgered as the reason.
5. The policy is evaluated in `safety-domain` — pure, deterministic, time injected —
   so a given (policy × event sequence × clock) always yields the same decisions.
6. **Escalation never decides whether something is an emergency.** It executes what the
   session or trigger already determined ([ADR-0014](../adr/0014-modular-monolith.md)).

## Required tests

Grace below the minimum is rejected · ack at step 2 prevents step 3 · unack resumes at
step 2, not step 1 · non-consented recipient skipped and ledgered · spend cap truncates
the ladder and tells the user · all steps exhausted → `ALL_CHANNELS_FAILED` + dial
prompt · per-template defaults applied · policy visible to the user before it runs ·
identical input sequence yields identical output (determinism).
