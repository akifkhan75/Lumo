# Accessibility

> **Correctness, not polish.** The app currently has **zero** accessibility
> attributes. Implements PLAT-2 (Phase 1 floor) and PLAT-3 (full WCAG 2.2 AA).

## Why this is a safety requirement

Voice activation is unusable by a deaf or hard-of-hearing user. Shake is unusable by
some users with motor impairments and misfires for users with tremor. If those were
the only triggers, the app would not work for them at all.

> **DET-9 — every automatic trigger must have an equivalent manual path**, usable
> without speech, without fine motor control, and with a screen reader.

That is why accessibility is Phase 1, not Phase 6.

## Phase 1 floor (PLAT-2)

Every safety-critical control:

- [ ] `accessibilityLabel` naming the **action**, not the icon
- [ ] `accessibilityRole` set
- [ ] Contrast ≥ 4.5:1 text, ≥ 3:1 components, **both themes**
- [ ] Target ≥ 44×44 pt
- [ ] Reachable one-handed, lower screen area
- [ ] Full screen-reader operability, **both platforms**
- [ ] Never colour alone for state — icon + text too
- [ ] OS text scaling to 200% without clipping or loss of function
- [ ] Countdowns and state changes announced via a live region
- [ ] RTL correct where a region profile requires it (Urdu does)

## Per-impairment paths

| Need                                                | Must work                                                                     |
| --------------------------------------------------- | ----------------------------------------------------------------------------- |
| Deaf / HoH                                          | Manual + widget triggers; visual and haptic confirmation; no audio-only state |
| Blind / low vision                                  | Screen reader through the whole emergency path; announced countdown           |
| Motor                                               | Large targets; no gesture chains; shake disableable; tremor must not fire SOS |
| Cognitive                                           | Plain language; no jargon; one decision per screen                            |
| Situational (dark, gloves, wet, moving, one-handed) | Everything above — this is the common case, not the edge                      |

## Phase 6 (PLAT-3)

Full WCAG 2.2 AA audit, externally verified · reduced-motion support · switch-control
and voice-control operability · localisation incl. RTL · a published accessibility
statement.

## Verification

Screen reader on both platforms · 200% text · contrast both themes · one-handed reach
· RTL · automated axe pass on web · **every trigger has a manual equivalent**.

## As built (1.14a): what is checked by a machine, and what is not

**Mechanically checked, in CI** (`apps/mobile/__tests__/a11yAudit.test.tsx`, `rtl.test.tsx`, `contrast.test.ts`):

- Every pressable control on the **SOS screen** (idle, counting, live, nobody reached, no signal), **Practice**, **Journey** (setup, running with a
  link live), the **dashboard**, a **contact's alert**, **Settings** (root, alerts, contacts), the **boot screen** and the **signed-out login
  screens** has a role, a label of at least two words that names the action, and a **stated** touch target of at least 44 pt. A target nobody
  wrote down cannot be verified, so an unstated one fails.
- **Layout mirrors**: no screen uses a physical `margin-left/right`, `padding-left/right`, absolute `left:`/`right:` or `text-align: left/right`
  (use `start`/`end`); the back and forward icons mirror when the layout is RTL.
- **Contrast** of the pairs the safety screens use, from the same hex values (4.5:1 text, 3:1 components), and a colour found to fail (`#10b981`,
  2.5:1) is forbidden.
- One screen-reader stop per switch row (the row is the control and says whether it is on); the inner switch is hidden from the reader.

**Found and fixed by it:** a 40 pt close button; unstated targets on the action bar and Defense control; unlabelled dashboard navigation and
header buttons; unlabelled switches for shake, voice and crash detection; a "remove contact" button drawn as a left arrow with no label; a
"Get Started" button with no role and a left arrow meaning "forward"; and two uses of a green that is 2.5:1 on white.

**NOT checked, and so not yet claimed** (see KI-131 to KI-135):

- Screen-reader order and wording, start to finish, on a real iOS and Android device.
- Text at 200% (a fixed-width label such as "Community" in the bottom bar may wrap or clip).
- One-handed reach.
- A real layout in Urdu on a device (strings are not translated, KI-134).
- Haptic confirmation (no haptics module, KI-132).
- Screens that are not on the emergency path (hazard reporting, fake call, the assistant, profile).
- A dark theme: the app is light-only (`userInterfaceStyle: "light"`), so "both themes" is one theme today.

**DET-9** (every automatic trigger has a manual equivalent): shake, voice and crash all open the same SOS screen the dashboard's SOS button
opens, and that button is on the audit above. Practice and the pre-filled text (1.12, 1.13) need no speech or gesture.
