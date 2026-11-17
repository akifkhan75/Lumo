# Incident history and the exportable timeline

> Implements PRO-9 (every state transition and attempt recorded with a timestamp, and exportable) and the "incident history" item of Phase 1.
> The data already exists: `IncidentEvent` and `NotificationEvent` are append-only with an explicit order (`seq`). This is how it is read.

## The four-part contract

| Part         | History and export                                                                                                                                  |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Owner        | The person who raised the incident. Nobody else reads it through these routes.                                                                      |
| Platform     | The API (1.15a). The app screen is 1.15b.                                                                                                           |
| Failure path | Unknown or another user's incident: `404`, never `403`. A page marker that is not one of ours: `400`. A format we do not know: `400`.              |
| Completion   | A page of the person's own incidents, or one incident's every event in the order they happened, each with the time it really happened.              |

## Routes

| Route                                     | Auth                | Does                                                                                          |
| ----------------------------------------- | ------------------- | --------------------------------------------------------------------------------------------- |
| `GET /api/v1/incidents`                   | **login only**      | the caller's incidents, newest first. `limit` 1–50 (default 20), `cursor`, `mode=real\|practice` |
| `GET /api/v1/incidents/:id/timeline`      | **login only**      | the incident and every entry. `?format=csv` or `json` downloads it and is audited             |

**Login only, deliberately.** An emergency token can raise, cancel, resolve and read the status of the alert it started (ids and states). It
cannot read the person's past: a phone that holds a token, found or stolen, must not be a window onto every emergency its owner has had.

## What a rehearsal is, here

**Never in the history.** The list is real incidents; `mode=practice` returns rehearsals **only**, every row marked `mode: "practice"`. A
rehearsal's timeline marks **every attempt entry `simulated: true`**, and its CSV carries `mode` on **every row**, so an export filed away
still says it was never real. (PRACTICE_MODE.md: "cannot be confused with a real incident in history".)

## What the timeline carries, and what it never does

- **Carries:** every incident state change (`CREATED` … `CLOSED`) with its event, who caused it (user, system, policy, contact) and why;
  every attempt event (`QUEUED`, `SENT`, `DELIVERED`, `FAILED` …) with its channel, purpose and reason; the contact's **name**; how late an alert
  was (`lateBySeconds`); that a position was available (a boolean).
- **Never carries:** a **coordinate**, a **phone number**, an email, a message body, or a push token. A timeline says what happened and to
  whom by name; where the person was, and how to reach their contacts, are not its business, and an export leaves the app.
- Order is by the time it happened; where two things share a moment, the incident's own step comes first, then the attempts in the order they
  were made. The recorded `seq` decides, not the clock alone.

## The export

CSV (one header row, then one row per entry, with `incident` and `mode` on every row) or JSON, as a download (`Content-Disposition`,
`Cache-Control: no-store`). **Every export is written to `AuditLog`** (`incident.timeline_exported`, with the format); viewing it in the app is
not an export and is not logged.

A cell that begins `=`, `+`, `-`, `@`, a tab or a carriage return is prefixed with `'`, so a contact named `=HYPERLINK(…)` is text in a
spreadsheet and not a formula.

## Limits

- No search or filter beyond real/practice, and no date range.
- Not every incident is long-lived data: retention of incident rows is not defined (KI-137).
- A journey's positions and its check-in history are not in an incident's timeline (a journey has its own).

## Tests

Newest first and own only · rehearsals never in the history, and alone when asked · paging without repeats or gaps · a made-up marker, an
over-large page and an unknown mode are `400` · a token cannot read either route · the timeline's order, names, and that it carries no
coordinate or number in JSON or CSV · another user's incident is a `404` · a rehearsal is marked on every entry and every row · CSV shape and
headers · a formula-shaped name is neutralised · exports are audited and views are not.

## As built (1.15b: the app)

**Settings → Past alerts** opens the list; a tap opens one incident's timeline.

- **The list** is "Alerts" by default and "Practice runs" on the other toggle, so a rehearsal is never among the real ones. Each row says what
  it was, when, and how it went **in the ledger's words** ("Sent to 1 of 2 · couldn't reach 1", never "notified"), marks a rehearsal
  ("Practice: nobody was contacted."), and says how late an alert was and why. It pages ("Show older"), says plainly when there is nothing yet,
  and says when it could not load, with a retry, rather than show an empty list as if nothing had happened.
- **The timeline** lists every entry in order with its time, in words: "Text to Maya: sent, not confirmed", "App alert to Maya: delivered", "Alert
  started (you)". A rehearsal has a banner and every attempt marked "(practice)". It says it never includes a position or a phone number.
- **Sharing** asks the server for the **audited export form**, then opens the system share sheet with the timeline as text. The share is the act
  that leaves the app, so that is what is recorded; merely viewing is not. Lumo sends nothing, and says so.

Both screens are on the accessibility audit (role, action label, 44 pt target).
