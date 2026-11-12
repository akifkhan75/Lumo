# Region Profiles — the market adapter

> **Safety-critical.** A wrong emergency number or a missing consent gate is a legal
> and physical-safety failure. Implements PLAT-1.
> See [ADR-0011](../adr/0011-region-profile-adapter.md).

> ⚠️ **Every legal and regulatory statement below must be confirmed with qualified
> local counsel before a market is enabled.** This document records engineering
> requirements and the questions counsel must answer — it is not legal advice, and
> regimes change. The `legalReviewStatus` gate exists precisely because this file
> cannot be trusted on its own.

## Why this exists

The launch market is deliberately deferred, so **no market-specific value may be
hard-coded anywhere**. Everything a market changes resolves through one profile:
emergency numbers, providers, languages, consent copy, retention, pricing, recording
law, dispatch availability.

The two reference profiles are **Pakistan** and **US** — chosen because they differ
on nearly every axis, which is the only way to prove the abstraction is real rather
than a wrapper around one market's assumptions.

**Hard gate:** a market cannot be enabled until its profile is complete and
`legalReviewStatus === 'approved'`. Enforced in code at boot, not by process.

---

## 1. The contract

```ts
interface RegionProfile {
  id: string; // 'PK' | 'US'
  displayName: string;
  status: "draft" | "in-review" | "approved" | "disabled";
  legalReviewStatus: "pending" | "approved";
  legalReviewedAt?: string;
  legalReviewedBy?: string;

  emergency: {
    numbers: EmergencyNumber[]; // ordered by relevance
    dialPolicy: "user-initiated-only" | "auto-dial-permitted";
    dispatchPartner?: DispatchPartner; // usually undefined
    canClaimDispatch: boolean; // false unless a signed agreement exists
  };

  messaging: {
    smsProvider: ProviderRef | null;
    voiceProvider: ProviderRef | null;
    deviceDirectSmsAllowed: boolean;
    recipientConsentRequired: boolean; // consent from the CONTACT, not the user
    registrationRequired?: string; // e.g. US 10DLC / A2P brand+campaign
    channels: ChannelCapability[]; // see DELIVERY_LEDGER.md
  };

  recording: {
    audioConsent:
      "one-party" | "all-party" | "varies-subnational" | "prohibited";
    subnationalOverrides?: Record<string, "one-party" | "all-party">;
    requiresOnScreenNotice: boolean;
    requiresAudibleNotice: boolean;
  };

  privacy: {
    regimes: string[];
    locationIsSensitiveCategory: boolean;
    minorConsentAge?: number;
    dataResidency?: string;
    retention: {
      locationDays: number;
      audioDays: number;
      videoDays: number;
      incidentYears: number;
    };
    erasureSlaDays: number;
  };

  locale: { languages: string[]; default: string; rtl: boolean };

  commerce: {
    currency: string;
    pricePoints: Record<Tier, number>;
    taxHandling: string;
  };

  publicAlertFeeds: FeedRef[];
  knownCompetitors: string[];
}
```

### The six fields that are easy to get fatally wrong

| Field                                 | Why it matters                                                                                |
| ------------------------------------- | --------------------------------------------------------------------------------------------- |
| `emergency.numbers`                   | Dialling the wrong number in an emergency. Also changes while roaming                         |
| `emergency.canClaimDispatch`          | Gates all UI copy implying official dispatch. Default `false`                                 |
| `messaging.recipientConsentRequired`  | Consent is needed from the **contact**, not the user — the opposite of most product intuition |
| `recording.audioConsent`              | In all-party jurisdictions, recording without consent can be a **criminal offence**           |
| `privacy.locationIsSensitiveCategory` | Changes the legal basis, disclosures and opt-out machinery                                    |
| `locale.rtl`                          | Urdu is RTL. An emergency screen with broken layout is a functional failure                   |

---

## 2. Profile: Pakistan (`PK`)

```yaml
id: PK
displayName: Pakistan
status: draft
legalReviewStatus: pending # BLOCKS enablement

emergency:
  numbers:
    - { number: "15", label: "Police", scope: national }
    - {
        number: "1122",
        label: "Rescue / Emergency Service",
        scope: subnational,
        regions: [Punjab],
      }
    - { number: "115", label: "Ambulance (Edhi)", scope: national }
    - { number: "130", label: "Motorway Police", scope: national }
  dialPolicy: user-initiated-only
  dispatchPartner: null
  canClaimDispatch: false

messaging:
  smsProvider: local-aggregator # TBD — see open questions
  voiceProvider: null
  deviceDirectSmsAllowed: true
  recipientConsentRequired: true # product policy, stricter than local law
  registrationRequired: null # confirm PTA masking/sender-ID rules
  channels: [push, sms, device-direct-sms, web]

recording:
  audioConsent: varies-subnational # CONFIRM WITH COUNSEL
  requiresOnScreenNotice: true
  requiresAudibleNotice: false

privacy:
  regimes: [PECA-2016, PDP-draft] # data-protection statute still evolving — confirm status
  locationIsSensitiveCategory: true # product policy regardless of statute
  minorConsentAge: 18 # conservative default pending review
  dataResidency: null # confirm localisation requirements
  retention:
    { locationDays: 30, audioDays: 30, videoDays: 90, incidentYears: 2 }
  erasureSlaDays: 30

locale:
  languages: [ur, en]
  default: ur
  rtl: true # ← drives full RTL layout work

commerce:
  currency: PKR
  pricePoints: { plus: 299, family: 599, business: 399 } # per month, hypotheses only
  taxHandling: inclusive

publicAlertFeeds: [NDMA, PDMA-Punjab] # verify programmatic availability
knownCompetitors:
  - PSCA Public Safety App
  - PSCA NextGen Safety App
```

### Pakistan-specific engineering consequences

1. **RTL is mandatory, not optional.** Urdu as default means every safety-critical
   screen must be verified in RTL. A mirrored SOS button or clipped countdown is a
   functional defect, not cosmetic. This is the single largest Pakistan-specific
   engineering cost and it lands in Phase 1, not Phase 6.
2. **Subnational emergency numbers.** `1122` is Punjab's rescue service; the profile
   must resolve by region, not country. The emergency number is a **function of
   current location**, not of account country.
3. **Official apps already occupy part of the space.** PSCA's apps provide emergency
   connectivity, consultation, legal and psychological support. Lumo must not
   position as an alternative official dispatch service — differentiate on
   cross-platform journeys, trusted-contact coordination, verified delivery and
   privacy, and explore complementary partnership.
4. **Device-direct SMS matters more.** Patchier data coverage makes the SIM-based
   fallback a primary path rather than a last resort. Prioritise its UX.
5. **Lower willingness to pay.** Price points above are hypotheses in PKR and must be
   validated locally; do not convert USD pricing.
6. **Literacy and iconography.** Do not assume text-first comprehension. Safety-
   critical actions need icon + colour + text redundancy.

---

## 3. Profile: United States (`US`)

```yaml
id: US
displayName: United States
status: draft
legalReviewStatus: pending # BLOCKS enablement

emergency:
  numbers:
    - { number: "911", label: "Emergency", scope: national }
  dialPolicy: user-initiated-only
  dispatchPartner: null # evaluate RapidSOS / Noonlight under agreement
  canClaimDispatch: false

messaging:
  smsProvider: tbd # Twilio or equivalent
  voiceProvider: tbd
  deviceDirectSmsAllowed: true
  recipientConsentRequired: true # consent regime for A2P messaging — counsel to confirm scope
  registrationRequired: A2P-10DLC # brand + campaign registration before sending
  channels: [push, sms, voice, device-direct-sms, web]

recording:
  audioConsent: varies-subnational # ~a dozen states require all-party consent
  subnationalOverrides:
    CA: all-party
    FL: all-party
    IL: all-party
    MD: all-party
    MA: all-party
    MT: all-party
    NH: all-party
    PA: all-party
    WA: all-party
  requiresOnScreenNotice: true
  requiresAudibleNotice: false # CONFIRM per state

privacy:
  regimes: [CCPA-CPRA, state-comprehensive-laws, COPPA]
  locationIsSensitiveCategory: true # precise geolocation treated as sensitive
  minorConsentAge: 13
  dataResidency: null
  retention:
    { locationDays: 30, audioDays: 30, videoDays: 90, incidentYears: 7 }
  erasureSlaDays: 45

locale:
  languages: [en, es]
  default: en
  rtl: false

commerce:
  currency: USD
  pricePoints: { plus: 4.99, family: 9.99, business: 5.00 }
  taxHandling: exclusive

publicAlertFeeds: [NWS, IPAWS-public]
knownCompetitors:
  - Google Personal Safety
  - Apple safety features
  - Life360
  - Noonlight
  - Citizen
```

### US-specific engineering consequences

1. **All-party consent recording is a release blocker for evidence capture.** In
   roughly a dozen states, recording a conversation without every party's consent can
   be a **criminal offence** — committed by the _user_, in a moment of crisis,
   because our app started recording. This is the most serious finding in this
   document.

   **Therefore:** `recording.audioConsent` resolves by the device's **current
   location**, not billing address. In an all-party jurisdiction the default is
   video-without-audio or an explicit one-time consent prompt, and the product must
   never silently start audio capture. Counsel must advise on whether an emergency
   exception applies — do not assume one does.

2. **A2P 10DLC registration gates launch.** Brand and campaign registration must
   complete before any SMS sends, with per-campaign throughput limits that directly
   constrain fan-out. This is weeks of lead time and belongs on the critical path.

3. **Recipient consent for messaging.** Consent must come from the **contact**, which
   is why RES-7 exists. A user cannot consent on another person's behalf.

4. **Precise geolocation as sensitive data** brings disclosure, opt-out and
   limited-use obligations, plus a Data Safety declaration that must match reality.

5. **No unilateral 911 integration.** PSAPs do not generally accept automated
   third-party alerts. The realistic path is a dispatch partner behind
   `DispatchPartner`, under contract. Until then `canClaimDispatch: false` and no copy
   may imply otherwise.

6. **Highest SMS cost of the two markets**, which makes PLAT-5's spend cap an
   economic necessity, not just abuse control.

7. **COPPA at 13** requires an age gate and verifiable parental consent for family
   plans with minors.

---

## 4. What the two profiles prove

The abstraction is only real if these differences are pure configuration:

| Axis                       | PK                    | US                          | Must be config, not code        |
| -------------------------- | --------------------- | --------------------------- | ------------------------------- |
| Emergency number           | 15 / 1122 subnational | 911 national                | ✅ resolved by current location |
| Layout direction           | **RTL**               | LTR                         | ✅                              |
| Recording consent          | varies                | **all-party in ~12 states** | ✅ resolved by current location |
| Messaging pre-registration | TBD                   | **10DLC required**          | ✅                              |
| Currency / price           | PKR 299               | USD 4.99                    | ✅                              |
| Incident retention         | 2 years               | 7 years                     | ✅                              |
| Erasure SLA                | 30 days               | 45 days                     | ✅                              |
| Dispatch available         | no                    | partner-only                | ✅                              |
| Primary competitors        | PSCA apps             | Google, Life360             | ✅ (content, not code)          |

If any row requires a code branch rather than a profile value, the abstraction has
failed and must be fixed before a third market is added.

---

## 5. Resolution order

The profile in force is resolved per request and per emergency, in this order:

1. **Device current location** (most accurate; required for emergency number and
   recording consent)
2. Last known location, with its age surfaced
3. SIM / network country
4. Account country
5. Global safe default

**Rule:** emergency numbers and recording-consent rules resolve from **location**,
never from the account. A Californian travelling in Pakistan must get `15`, and a
Pakistani user in Illinois must get all-party recording rules.

When location is unavailable, show the account-country number **labelled with that
uncertainty** — "Showing Pakistan emergency numbers; we couldn't confirm your
location."

---

## 6. Enablement checklist

A market stays `draft` until every box is ticked:

- [ ] Emergency numbers verified, including subnational variants
- [ ] `canClaimDispatch` set, with the agreement referenced if `true`
- [ ] SMS/voice provider contracted; registration complete; cost per message recorded
- [ ] Channel capability matrix populated (which channels report receipts here)
- [ ] Recording-consent rules confirmed, including subnational overrides
- [ ] Privacy regimes mapped; retention and erasure SLA set
- [ ] Minor-consent age and parental-consent flow defined
- [ ] All safety-critical copy translated **and reviewed by a native speaker**
- [ ] RTL verified on every safety-critical screen, if applicable
- [ ] Pricing validated locally — not converted
- [ ] Public alert feeds confirmed programmatically available
- [ ] `legalReviewStatus: approved`, with reviewer and date
- [ ] Store data-safety disclosures updated for the market
- [ ] Failure-mode tests re-run on local networks and devices

---

## 7. Required tests

| Scenario                               | Expected                                                           |
| -------------------------------------- | ------------------------------------------------------------------ |
| Profile incomplete                     | Market cannot be enabled; boot-time assertion fails loudly         |
| `legalReviewStatus: pending`           | Enablement refused regardless of other fields                      |
| US user in California starts recording | All-party rules applied; audio not captured silently               |
| PK user in Punjab triggers SOS         | `1122` offered alongside `15`                                      |
| PK user in Sindh                       | `1122` not offered; `15` and `115` are                             |
| User roams PK → US mid-journey         | Emergency number updates from location, not account                |
| Location unavailable                   | Account-country numbers shown **with the uncertainty stated**      |
| `canClaimDispatch: false`              | No UI string implies official dispatch                             |
| Urdu selected                          | Every safety-critical screen correct in RTL; countdown not clipped |
| Spend cap with PK vs US SMS cost       | Cap enforced in minor units of the correct currency                |

---

## 8. Open questions for counsel and operations

**Pakistan** — current status of the data-protection statute and its obligations ·
audio-recording consent, including any subnational variation · PTA rules for A2P
sender IDs and masking · whether PSCA partnership or data sharing is possible ·
whether any data-localisation requirement applies.

**US** — whether an emergency exception exists to all-party recording consent, per
state (**blocks Phase 2 evidence capture if unresolved**) · 10DLC brand/campaign
scope and throughput for emergency traffic · whether emergency alerts to a
pre-consented contact sit outside standard messaging-consent constraints · dispatch
partner terms and liability allocation · state-by-state comprehensive-privacy
applicability thresholds.

**Both** — liability for a missed or delayed alert · whether an incident export is
admissible, and what must be added if not · insurance requirements before any
volunteer or responder feature.

---

## 9. As built — `@lumo/region-profiles` (milestone 1.3)

The package holds the two draft profiles, the enablement gate, and the resolver. Where it
differs from or extends the spec, **the code is right** and this section is the record.

**Changes to the §1 contract**

- `smsProvider` / `voiceProvider` are `{ id, contracted }`, not a bare name: a provider that is
  only named is not a provider, and enablement requires `contracted: true` for every channel used.
- `messaging.registrationComplete` — added. `registrationRequired: 'A2P-10DLC'` with
  `registrationComplete` unset or false blocks enablement: nothing may send before registration.
- `messaging.channels` is the domain's `Channel[]` (`device_direct_sms`, not `device-direct-sms`).
- **`checklist`** — added. The §6 checklist is 14 recorded fields (`numbersVerified`,
  `safetyCopyNativeReviewed`, …), all false in both drafts. `approved` cannot be claimed with one
  undone. `'not-applicable'` is allowed only for `rtlVerified` in a left-to-right market.
- `emergency.dispatchPartner` is `{ id, agreementRef }`. `canClaimDispatch: true` without a
  non-blank `agreementRef` is refused, as is `dialPolicy: 'auto-dial-permitted'` in any market (RES-9).
- **Subdivision codes** are the part of the ISO 3166-2 code after the country: Punjab is `PB`
  (PK-PB), California `CA` (US-CA). The spec's "Punjab" became `PB`; that mapping is unverified (KI-52).

**Enablement is two questions.** _Completeness_ (`completenessIssues`) — structurally whole and
internally consistent. _Enablement_ (`enablementIssues`) — complete **and** `status: approved`,
`legalReviewStatus: approved`, a named reviewer and date, and every checklist item done. A complete
profile with a pending review is refused. Both real profiles are drafts, so neither can be enabled.

**The boot assertion** (`createRegionRegistry`, wired to the API's `ENABLED_REGIONS`) applies to the
profiles in the **enabled set**, not to every profile that exists — otherwise two unapproved drafts
would stop the API starting for everyone. Production refuses any enabled profile that fails
enablement and the process exits; outside production a draft may be enabled and is marked
`internal-testing`, so it can never pass for live. An empty set is allowed. **Enablement decides
whether Lumo provides service in a market; it never decides whether someone is shown 911.**

**Resolution rules the spec left open**

- **A known location is never overridden.** The sources are tried in the spec's order and the first
  that yields a country wins; once one has, no lower source is consulted. A Californian whose
  location is the UK is _not_ shown 911 because the UK has no profile — they get the fallback and a
  note. The account country is used only when location, and the network country, are unavailable.
- **"Current" means a fix at most five minutes old** (`CURRENT_FIX_MAX_AGE_MS`; the spec does not
  define it). An older fix is "last known": its age is stated and nothing about it is confirmed.
- **Subnational numbers** (PK's 1122) are offered only from a _current_ fix whose subdivision is in
  the number's list. If the region cannot be confirmed they are returned separately as
  `possibleNumbers` — neither dropped (that could hide the right number) nor asserted.
- **Recording consent** resolves from a current fix only, and anything unknown is the **strictest**
  rule (`all-party`) with the reason stated: an unconfirmed location, a country with no profile,
  or a `varies-subnational` market whose subdivision is unknown or unlisted. The US list names nine
  states while the spec says "roughly a dozen", so an unlisted state is never one-party. Pakistan
  lists none, so it is all-party everywhere until counsel answers.
- **No geocoding.** The resolver takes already-resolved country and subdivision codes. A bounding
  box would give a wrong number near a boundary. Nothing yet turns coordinates into a place (KI-50).
- **The fallback number is unverified data** (`GLOBAL_DEFAULT`), always returned with
  `verified: false`, and the package makes no claim about where it works (KI-51).

### Where each §7 test is proven

| Scenario                               | Proven by                                                                                       |
| -------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Profile incomplete                     | `validation.spec.ts`, `registry.spec.ts` (production refuses; the real API process exits 1)     |
| `legalReviewStatus: pending`           | `validation.spec.ts` — a **complete** profile with a pending review is still refused            |
| US user in California starts recording | `resolve.spec.ts` — all-party, with notice. The recording feature itself: milestone **2.7**     |
| PK user in Punjab triggers SOS         | `resolve.spec.ts` — `1122` offered alongside `15`. The SOS screen showing it: milestone **1.8** |
| PK user in Sindh                       | `resolve.spec.ts` — `1122` not offered; `15`, `115`, `130` are                                  |
| User roams PK → US mid-journey         | `resolve.spec.ts` — the number follows the fix, not the account                                 |
| Location unavailable                   | `resolve.spec.ts` — account-country numbers with the spec's own wording                         |
| `canClaimDispatch: false`              | `resolve.spec.ts` (`mayClaimDispatch`). A scanner over every UI string: milestone **6.5**       |
| Urdu selected → RTL correct            | **Device test** — milestones **1.14** (floor) and **6.1**. `locale.rtl` is data here            |
| Spend cap with PK vs US SMS cost       | **Integration** — milestone **1.7**. `commerce.currency` is data here                           |

`no-hardcoded-market.spec.ts` scans `apps/` and `packages/` for dial strings with digits, currency
codes as literals, and emergency numbers beside dialling vocabulary, and finds none outside this
package. Its self-test proves it can see a violation and spares an unrelated `15`.
