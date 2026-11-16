# Trusted contacts and consent

> **Safety-critical.** Implements `RES-7` (contact onboarding and consent) and the storage half of
> `RES-2`. Before this file, `RES-7` had no owning spec. Threat context: T2 and the consent rows of
> [`../engineering/PRIVACY_AND_CONSENT.md`](../engineering/PRIVACY_AND_CONSENT.md).

## Why it exists

A user can type anyone's number into Lumo. An alert that arrives on the phone of someone who never
agreed is, at best, spam and, at worst, harassment. Equally, a contact who agreed once and then got a
new phone number must not hand that agreement to whoever now owns the number. So: **the contact, not
the user, consents; consent follows a person, not an id; and a withdrawal is always honoured.**

## The four-part contract

| Part                    | Statement                                                                                                                                                                           |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Owner**               | `apps/api/src/trusted-contacts` (`TrustedContactsService`, `ContactConsentService`, `recipients.ts`, the public consent page). Mobile: `components/settings/ContactSettings`.       |
| **Supported platform**  | API plus a minimal server-rendered consent page that works in any browser, with no app and no account. The contact needs only the link.                                             |
| **Failure path**        | Expired, unknown or reused link → one generic "this link isn't valid" page, indistinguishable between them. A number that cannot be normalised → the save is refused with a reason. |
| **Testable completion** | See _Required tests_.                                                                                                                                                               |

## The behaviour

### Inviting

- A user creates or resends an invite for **one of their own active contacts**. The server mints a
  token of at least 128 bits, stores **only its SHA-256**, and returns the link **once**.
- **Lumo sends nothing.** No SMS, email or push exists until milestone 1.7. The user shares the link
  themselves (the phone's share sheet), and every word in the app says so: _"Ask them to open this
  link"_, never _"invite sent"_.
- An invite is valid for **7 days** for acceptance. A new invite for the same contact ends the earlier
  one.
- **Anything that changes who would be reached ends outstanding invites**: a changed phone number or
  email, or removing the contact. Otherwise a link sent to the old number would grant consent for
  the new one.

### Accepting

- `GET /api/v1/contacts/invites/:token` serves a small HTML page (no scripts, `noindex`,
  `Referrer-Policy: no-referrer`, no caching) saying **who is asking** (the inviter's name only — no
  phone, no email, no medical data), what being a contact means, and what is **not** happening yet.
- `POST /api/v1/contacts/invites/:token/accept` records a `ConsentRecord` (`kind: contact_role`) and
  attaches it to the contact. **Single use**, enforced by a conditional update, so two concurrent
  accepts produce one consent.
- A record stores: `grantedById` = the **contact's id** (a contact has no account, and the spec was
  silent), `subjectId` = null, `scope` = `receive_emergency_alerts`, the version of the wording
  shown, and `regionProfileId` = the user's region profile, or `UNRESOLVED` if none is set. Nothing
  decides legality from `UNRESOLVED`; it only records that no region was known.
- Unknown, expired and already-ended-without-acceptance links all look the same. An already
  **accepted** link shows its holder their current state, because that same link is how they
  withdraw.

### Withdrawing

- The invite token is also the contact's **revocation capability**: `POST
/api/v1/contacts/invites/:token/revoke` works after acceptance for as long as the contact exists. (The
  plan's `DELETE /contacts/consent/:id` is replaced: a contact has no account, and a bare record id
  is an identifier, not a secret.)
- Withdrawal sets `revokedAt` and a reason. A consent record is **never deleted**.
- It is immediate, and the user is told who withdrew.

### Who may be alerted

`resolveRecipients` is the only way a later milestone obtains recipients. It returns **eligible**
contacts and **skipped** contacts, each skipped one with a reason:

| Reason             | Meaning                                          |
| ------------------ | ------------------------------------------------ |
| `NOT_INVITED`      | Never asked.                                     |
| `AWAITING_CONSENT` | Asked; no answer yet.                            |
| `INVITE_EXPIRED`   | Asked; the link lapsed. Needs a new one.         |
| `WITHDRAWN`        | The contact withdrew.                            |
| `DETAILS_CHANGED`  | The number or address changed since they agreed. |

Removed contacts are in neither list. Skipping is **never silent**: a later incident view shows the
skip and its reason.

### Phone numbers

- A number is stored as **E.164**. A number written locally (`0300 1234567`) needs a country, which
  comes from the user's region profile; with none, a leading `+` is required. **No country is ever
  assumed.**
- Validation covers numbers that are **new or changed**. A number already stored but not
  normalisable (older data) is kept as it is and flagged, so one old contact can never make every
  settings save fail.

### What the app says

| Status (`consentStatus`) | Shown                                                          |
| ------------------------ | -------------------------------------------------------------- |
| `not_invited`            | "Not asked yet. They have not been contacted."                 |
| `waiting`                | "Waiting for them to agree."                                   |
| `agreed`                 | "Agreed" — **not** "will be alerted": no alert path exists yet |
| `withdrawn`              | "Withdrew their agreement."                                    |
| `expired`                | "The link ran out. They have not agreed."                      |
| `details_changed`        | "Their number or email changed, so they need to agree again."  |

`consentStatus` is read-only: `GET /settings` returns it; `PUT /settings` accepts and ignores it,
so a client echoing the whole object back (including every installed build) is not rejected.

## The limits

- **Nothing is sent.** The user carries the link. Delivery is milestone 1.7.
- **No alert path exists yet.** "Agreed" records consent; it does not mean anyone will be contacted.
- **The user can open their own link.** The server cannot tell the contact from the account holder
  using the same link, so consent is **not verified identity**. It is the contact's agreement as far
  as a shared link can show it (KI-62).
- **The consent page is a stopgap** for the web app of milestone 1.11, which replaces it.
- **Circles** are not in this milestone: they have no requirement ID, and nothing consumes them
  until the escalation engine (1.9).

## Required tests

| Rule                                                                  | Proven by                            |
| --------------------------------------------------------------------- | ------------------------------------ |
| Only a hash of the token is stored                                    | service unit + database suite        |
| An invite is single use, including under concurrent accepts           | database suite                       |
| Unknown / expired / ended links are indistinguishable                 | controller tests                     |
| Changing number or email ends outstanding invites and revokes consent | service unit + database suite        |
| Removing a contact ends its invites                                   | service unit                         |
| A contact can withdraw with their link, immediately                   | service unit + database suite        |
| A record is revoked, never deleted                                    | database suite                       |
| A non-consented contact is never an eligible recipient                | `recipients` unit                    |
| Every skipped contact carries a reason                                | `recipients` unit                    |
| A user cannot invite another user's contact                           | service unit                         |
| E.164: PK and US, region default, `+` required without one            | `phone` unit                         |
| A legacy unparseable number does not block a settings save            | settings unit                        |
| The token never appears in a log line                                 | controller test with captured logger |
| The page says only the inviter's name                                 | controller test                      |
