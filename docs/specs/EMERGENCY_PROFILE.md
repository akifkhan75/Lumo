# Emergency profile (PRO-6)

> **Status: DESIGN. Nothing in this document is built.** It exists so that the decisions below are made on purpose, with the person who owns
> the product, before any code puts a person's health information in front of another person.
> Implements PRO-6: _optional medical data with granular, per-recipient sharing; never exposed through a journey link._

## Why this is not like the other features

Everything Lumo has built so far moves **facts about an alert**. This moves **a person's health**. It is special-category data under GDPR and
sensitive under most US state laws; it is the single thing in the app that a wrong value can physically harm someone with; and it is shown to
people the owner may later fall out with. The failure modes are not "a bug", they are:

1. **A contact sees something the person did not mean them to** (a partner, a family member, a former friend).
2. **A stranger sees it** (a found phone, a leaked link, a screenshot of a notification).
3. **It is wrong or stale, and acted on** (a changed allergy, a medication stopped).
4. **Someone is coerced into sharing it** (T1/T2 in the threat model: the person who demands access is often a contact).

So the design is built around refusing, not around features.

## What exists today

`User.bloodType` and `User.allergies`: two free-text fields, **encrypted at rest** (AES-256-GCM, field-level, bound to the row and column), edited
in Settings, shown **back to the person** on the SOS screen ("Your saved blood type is O+"). **No contact, link, message or push ever sees them.**
That is the safe baseline, and this design must not weaken it for anyone who does nothing.

## The rules (non-negotiable; each is a test)

1. **Default is nobody.** No contact sees any field until the person grants it, per contact, per field. A new contact sees nothing. Doing
   nothing shares nothing.
2. **Never in a journey link, never in an SMS, never in a push, never in a notification body, never in a timeline or export, never in a log.**
   These cross third parties, lock screens and files (T1, T6). The profile is read **only** through an authenticated view by a linked contact,
   inside the app.
3. **Only an agreed, linked contact, and only while it matters.** The viewer must be a contact who **agreed** (consent) and has **claimed** their
   invite from their own account, **and** there must be an **active incident** of the owner's (not a rehearsal) that **alerted that contact**.
   After the incident ends, access ends (a fixed short tail, below). A contact cannot browse it at will.
4. **Granular.** Per field, not "the medical profile". A person may share an allergy with a flatmate and nothing else.
5. **Revoke is instant, silent and total.** One action removes a contact's access (or everyone's). **No message goes to the contact** (the
   threat model: "a 'your partner changed their sharing settings' email is a safety incident"). The contact's next read simply finds nothing.
6. **The owner always sees who saw what.** Every read by a contact is recorded (who, which fields, which incident, when) and shown to the owner
   (PRO-7: "the user can always see every active share and who viewed it"). The contact is not told this log exists in a way that identifies the
   owner's other contacts.
7. **It says what it is.** Every value is shown with "entered by [name] on [date]. Lumo has not checked it." and, when old, "last updated N
   months ago: check it is still right". It is **never** medical advice, never an instruction, and Lumo never infers anything from it.
8. **Nothing about it is required.** The whole profile is optional; no feature is gated on filling it in.
9. **A rehearsal never shares it.** Practice runs show the owner the profile screen as a contact would see it, with invented data, never the
   real values to anyone.
10. **The emergency token cannot read or change it.** Login only, like history.

## What is in the profile (decision needed: see below)

Proposed, deliberately small and structured, because free text is where people put things they will regret and others cannot parse:

| Field        | Form                                                              | Notes                                                                           |
| ------------ | ----------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Blood type   | one of A+, A−, B+, B−, AB+, AB−, O+, O−, "don't know"             | exists today, as free text                                                      |
| Allergies    | a short list of items, each ≤ 60 characters                       | exists today, as free text                                                      |
| Conditions   | a short list, each ≤ 60 characters                                | new                                                                             |
| Medications  | a short list, each ≤ 60 characters                                | new; **the most likely to go stale**, so the staleness prompt is shortest here  |
| A note       | ≤ 200 characters, "anything a responder should know"             | new; the only free text; the likeliest to hold something unwise                 |

**Not in scope, ever, in this feature:** photos, documents, insurance or ID numbers, doctor or hospital names, anything about mental health
diagnoses beyond what a person chooses to type into "conditions", and any field a contact can write.

## Who sees it, and where

- **The owner**: all of it, on the SOS screen (as today), and a Profile screen to edit it.
- **A linked contact who was alerted**: the granted fields only, on **the alert screen in the app** (the "I'm responding" screen), **after** they
  have pressed "I'm responding" (a deliberate act, which is also the moment it becomes relevant), not on the lock-screen notification. Read-only; no
  copy button; the screen is marked secure where the platform allows (no screenshots on Android; iOS cannot prevent them, and the screen says so).
- **A contact with no app, a journey-link holder, the web page, a first responder, Lumo staff**: nothing. (A contact with no app is not a gap:
  they were never going to open an app screen mid-emergency. Lumo does **not** replace the phone's own Medical ID, which a person can fill in
  on the lock screen for a paramedic; the profile screen says so and points to it.)

## The data model (sketch, not a migration)

- `EmergencyProfile` (one per user): the five fields above, each **encrypted at rest** with the existing field cipher, `updatedAt` per field.
- `ProfileShare` (user, contact, field, `grantedAt`, `revokedAt`): **one row per contact per field**. Revoking sets `revokedAt`; rows are never edited.
- `ProfileAccess` (append-only, like `IncidentEvent`): owner, viewer (a user id), incident, fields read, `at`. A database trigger forbids UPDATE
  and DELETE, as on the other ledgers.
- Deleting the profile, or the account, removes the shares and the profile; **the access log is kept for the owner for the retention window and
  contains field names, never values.**

## The endpoints (sketch)

| Route                                               | Who                                  | Does                                                                          |
| --------------------------------------------------- | ------------------------------------ | ----------------------------------------------------------------------------- |
| `GET`/`PUT /api/v1/profile`                         | the owner, login only                | read and write their own                                                      |
| `PUT /api/v1/profile/sharing/:contactId`            | the owner, login only                | set the fields shared with one contact (replaces the set; empty = none)       |
| `DELETE /api/v1/profile/sharing`                    | the owner, login only                | stop sharing with everyone, at once                                           |
| `GET /api/v1/profile/access`                        | the owner, login only                | who has read what, and when                                                   |
| `GET /api/v1/incidents/:id/profile`                 | a linked, agreed contact, login only | the granted fields of the owner **iff** rule 3 holds; **records the read**   |

`GET /incidents/:id/profile` returns **404 for every reason it may not return data** (not linked, not agreed, no active incident, not alerted,
a rehearsal, nothing granted): the contact cannot tell "nothing shared" from "no such incident", so the endpoint reveals nothing about what the
owner chose.

## Access window

A contact may read while the incident is active and for **a short tail after it ends** (proposal: **2 hours**), because the person who is
helping often needs it after the alert has closed (a hospital visit). It is a decision, not a technical constant (below).

## Threats this design is built against

| Threat                                                                                | Mitigation                                                                                                                             |
| ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| An abusive contact demands access (T1/T2)                                             | Granting is on the owner's own device; revoking is silent and instant; the contact cannot see that other contacts exist or what they see |
| A found or stolen phone                                                               | Login only; the profile is not on the lock screen or in a notification; the owner's own view needs the session, not the emergency token   |
| A leaked journey link (T6)                                                            | The profile is not reachable from a link at all                                                                                        |
| A contact screenshots it                                                              | Cannot be prevented on iOS; said plainly on the screen; the access log shows the read                                                  |
| A stale value acted on                                                                | "Entered on [date]; not checked by Lumo"; a prompt to re-check at 6 months, sooner for medications                                     |
| Data in a log, export, notification or error                                          | Field names only ever; a test scans the timeline, the CSV, the logs and every message template for a seeded value                     |
| A rehearsal leaks the real profile                                                    | Practice uses invented data                                                                                                            |
| Over-collection                                                                       | Five structured fields; no free text beyond one 200-character note; nothing required                                                  |

## Legal and compliance (needs a human who is not me)

Health data is **special category** (GDPR/UK: explicit consent, a DPIA, a lawful basis for processing and for each disclosure), sensitive under
CCPA/CPRA and several state laws (Washington's My Health My Data Act has a private right of action), and may be regulated in Pakistan (PECA, a
data-protection statute still evolving). This feature **must not ship in a market until counsel has reviewed it for that market**, and the profile
screen must carry the wording they approve. The consent record for each grant uses the existing `ConsentRecord` (kind: sharing consent) with
version and region.

## Tests (when it is built)

Default shares nothing · a new contact sees nothing · per-field granularity · a contact not agreed, not linked, not alerted, or after the window
gets 404 and the same 404 as "nothing shared" · a rehearsal shares nothing · a journey link, a token, the web page, an SMS, a push, a timeline, a CSV
and every log contain **no seeded value** · revoke is instant and sends nothing to the contact · every read is logged with fields, never values ·
the log cannot be edited or deleted · deleting the account removes shares and values · encryption at rest · the staleness wording · the value is
never in a notification body · the screen is marked secure on Android.

## Decisions needed before any code (these are yours, and counsel's)

1. **The field set.** The five above, fewer, or different? (Recommendation: ship **blood type and allergies only** first: they exist, they are the
   most useful to a responder, and they carry the least risk of being a diagnosis. Add conditions, medications and the note only after the sharing
   model has survived a real pilot.)
2. **When a contact may read.** After "I'm responding" only (recommended), or as soon as alerted?
3. **The tail after an incident ends.** None, 2 hours (recommended), or longer?
4. **Re-confirmation.** PRO-8 (periodic re-confirmation of long-lived sharing) is Phase 2. Is sharing acceptable in Phase 1 without it, given that
   access is bounded to incidents (so it is not a standing view)? (Recommendation: yes, **because** rule 3 makes it event-bound, not standing.)
5. **Markets.** Which market is first, and has counsel reviewed health-data sharing there?
6. **Whether to build it at all in Phase 1.** PRO-6 is a Phase 1 requirement, but it is the one item whose cost of being wrong is not
   recoverable. (Recommendation: **build rules 1–4 and 10 with the two existing fields behind a feature flag that is off in every market until
   counsel signs off**, so the engineering risk is retired and the legal risk is not taken early.)

## Out of scope

Lock-screen or widget display · responders and dispatch (Phase 4, and a different consent) · wearables · any contact writing to the profile ·
medical records, documents or photos · AI reading the profile (never: `AI emits signals; a deterministic engine decides`, ADR-0013, and it never
sees this).
