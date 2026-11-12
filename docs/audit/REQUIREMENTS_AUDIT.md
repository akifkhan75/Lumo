# Requirements Audit

> Status of the originally-specified feature set, verified against the source on
> 2026-10-26/27. ✅ complete · 🟨 partial · ⛔ pending.
> Target requirements and acceptance criteria: [`../product/PRD.md`](../product/PRD.md).

## The headline finding

**The original requirements document described a different application.** It
referenced `useAudioRecorder`, `navigator.mediaDevices`, `SpeechSynthesis` and
`DeviceMotionEvent.requestPermission` — browser APIs from an earlier **web**
prototype. None exist in the React Native codebase. Behaviour it described as working
(audio recording on SOS, spoken self-defence tips, an alarm sound, a ringtone) **is
not implemented at all**.

| Claim in that document                                                  | Reality                                                 |
| ----------------------------------------------------------------------- | ------------------------------------------------------- |
| "Immediately starts recording audio using `useAudioRecorder`"           | No such hook exists — verified absent                   |
| "uses the browser's `SpeechSynthesis` API… a loud alarm is also played" | Neither exists; `expo-speech`/`expo-av` not installed   |
| "simulates an incoming call screen with a ringtone"                     | Screen yes, ringtone no                                 |
| "Microphone requested via `navigator.mediaDevices.getUserMedia`"        | Browser API; RN uses `app.json` + the voice plugin      |
| "`DeviceMotionEvent.requestPermission`… Safari on iOS"                  | Browser API; RN uses `expo-sensors`                     |
| "Power button 3 times"                                                  | **Impossible** for a third-party app on either platform |
| "`/api/auth/login`", "`/api/danger-zones`"                              | Actual routes are `/api/v1/…`                           |

## Status

| Original requirement                       | Status | Evidence / gap                                                                                                                                                          | New ID       |
| ------------------------------------------ | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| Detect aggressive tones, shouting          | ⛔     | No audio classification. `transcript.includes()` on literal strings                                                                                                     | DET-7        |
| Detect glass breaking, crashes, struggle   | ⛔     | 0%. No classifier, no `expo-av`                                                                                                                                         | DET-7        |
| Voice command activation                   | ✅     | `useVoiceActivation.ts` — continuous, self-restarting, degrades in Expo Go                                                                                              | DET-5/6      |
| Notify local police with GPS               | ⛔     | **Not achievable as specified.** PSAPs do not accept automated third-party alerts; needs a dispatch partner                                                             | RES-9        |
| Notify trusted contacts                    | ⛔     | Contacts stored and editable; **no alert path exists.** `EmergencyModal.tsx` renders a _hardcoded_ ring                                                                 | RES-2        |
| Notify nearby volunteers                   | ⛔     | `NearbyVolunteers` is a `<Text>` label                                                                                                                                  | RES-20       |
| Real-time audio/video to authorities       | ⛔     | `isRecording` is a literal `const false`                                                                                                                                | PRO-1        |
| Live location to contacts                  | ⛔     | **No location capability at all** — `expo-location` not a dependency; no lat/lng in the schema                                                                          | RES-10       |
| Path / route deviation                     | ⛔     | Advertised in `CommunitySafetyModal` as "Enabled in Follow Me"; Follow Me has no such toggle                                                                            | RES-14       |
| "Follow Me"                                | 🟨     | UI complete; `shareLink` is a constant                                                                                                                                  | RES-11/12    |
| Shake to SOS                               | ✅     | `useShakeDetector.ts`, 2.5 G, debounced, permission-aware                                                                                                               | DET-3        |
| Power button ×3                            | ⛔     | Platform-blocked. Substitutes in the capability matrix                                                                                                                  | DET-1        |
| Fake call / escape mode                    | ✅     | Real AI script with fallback. **The best-differentiated feature in the app**                                                                                            | RES-17       |
| Evidence recording, encrypted, undeletable | ⛔     | 0%. No capture, storage, encryption or custody chain                                                                                                                    | PRO-1…5      |
| Accident detection                         | 🟨     | 6 G impact threshold works. No tilt, no sequence analysis, no confirmation                                                                                              | DET-4        |
| Auto-call ambulance + medical info         | ⛔     | Blood type _displayed as text_; no call, no transmission                                                                                                                | RES-9, PRO-6 |
| Safe Walk volunteer                        | ⛔     | `useState` + a `setTimeout` faking acceptance                                                                                                                           | RES-20       |
| Hazard reports: report + warn              | 🟨     | Feed real and persisted with **real coordinates** and mandatory decay. Reporting is **unavailable** — no device location — and there is no map SDK or proximity warning | PREV-1/2/3   |
| Loud alarm                                 | ⛔     | Text reading "LOUD ALARM ACTIVE". No audio                                                                                                                              | RES-19       |
| Camera flash strobe                        | ⛔     | 0%                                                                                                                                                                      | RES-19       |
| Verbal self-defence tips                   | 🟨     | Tips genuinely AI-fetched and displayed. **No TTS**                                                                                                                     | REC-4        |
| Automated check-ins                        | 🟨     | Timer fires `onEmergency()`. In-process `setInterval` — backgrounding cancels escalation silently                                                                       | RES-13       |
| Offline mode (SMS last location)           | ⛔     | 0%. No SMS, no queue, no cached location                                                                                                                                | RES-16       |
| Wearables                                  | ⛔     | 0%                                                                                                                                                                      | PLAT-12      |
| Legal & counselling support                | ⛔     | 0%                                                                                                                                                                      | REC-2        |
| Travel Safe Mode                           | ⛔     | 0%                                                                                                                                                                      | —            |
| Dark web monitoring                        | ⛔     | 0%                                                                                                                                                                      | —            |
| Freemium billing                           | ⛔     | No billing, no entitlements                                                                                                                                             | PLAT-10      |
| Corporate version                          | ⛔     | 0%. Needs an admin web app                                                                                                                                              | PLAT-10      |

**Tally: 4 complete (13%) · 6 partial (20%) · 20 pending (67%).**

## The structural finding

Every ✅ is a **trigger** or an **escape tool**. Every item in the **response** chain —
notify, locate, record, dispatch — is ⛔.

> The app can detect that you are in trouble four different ways, and then does
> nothing about it.

The engineering quality where the app is real is high: the sensor hooks, module
boundaries, shared types, AI fallbacks and test suites are solid. The gap is not craft
— the response half was built as UI first. That is the defining fact of this codebase,
and the reason the PRD exists.
