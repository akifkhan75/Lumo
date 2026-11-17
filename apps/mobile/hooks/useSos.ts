import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { ApiError } from '@lumo/api-client';
import type { Incident, RaiseSosInput } from '@lumo/types';
import * as api from '../services/apiService';
import type { ActiveSos } from '../services/tokenStorage';
import { countdownFor, type SosTrigger } from '../services/sosCountdown';
import { classifyFailure, retryDelayMs } from '../services/sosRetry';
import { cancelSosReminder, scheduleSosReminder } from '../services/sosReminder';

/**
 * One SOS, from the press to the ledger (docs/specs/INCIDENTS.md, EMERGENCY_WORKFLOWS.md §1).
 *
 * The SERVER owns the countdown: the request goes out at once, the server dispatches when the deadline
 * passes even if this app is killed, and this hook only shows the countdown and can cancel it. Everything
 * here is TRUTHFUL about what has happened:
 *
 *  - `requesting`   nothing has been sent; the request is in flight
 *  - `counting`     nothing has been sent; it will be, unless cancelled
 *  - `live`         the server has the incident; its ledger says what went where
 *  - `unreachable`  the request did not complete. NOTHING HAS BEEN SENT. It is retried automatically (backing off, and when the
 *                   app returns to the foreground) with the SAME key, so a request that actually got through is not duplicated.
 *                   The countdown the device keeps meanwhile is its own, and `retryAt` says when the next try is.
 *  - `cannot`       the server refused the credential: not signed in, token gone. Nothing has been sent.
 *  - `tooLate`      the press was longer ago than an alert may be sent (docs/specs/OFFLINE_SOS.md). Nothing was sent.
 *  - `cancelling`   the person cancelled while Lumo could not be reached. Nothing more will be sent for this press; the cancel is
 *                   still being settled with the server, and is persisted so a restart cannot send it.
 *
 * Offline (docs/specs/OFFLINE_SOS.md): the press is written to the device first, with the last known position; the time it reports is
 * how long ago it was by THIS device's stopwatch (the server works out the rest from its own clock); and a reminder notification is the
 * only thing that can reach someone whose app was closed. None of that is a send, and nothing here says it is.
 *
 * A failure to REFRESH an incident that exists is not a failure of the incident: the last known ledger stays on
 * screen with its age, marked as such. The ledger is never invented and never optimistic.
 */

export type SosPhase = 'idle' | 'requesting' | 'counting' | 'live' | 'unreachable' | 'cannot' | 'tooLate' | 'cancelling';

export interface SosState {
  readonly phase: SosPhase;
  readonly incident: Incident | null;
  /** The countdown deadline by THIS device's clock, or null. */
  readonly countdownEndsAt: number | null;
  /** When the incident was last refreshed from the server, by this device's clock. */
  readonly lastUpdatedAt: number | null;
  /** The last refresh failed; what is shown may be out of date. */
  readonly stale: boolean;
  /** A cancel was refused because the alert had already gone out. */
  readonly tooLateToCancel: boolean;
  readonly error: string | null;
  /** When the next automatic try is, by THIS device's clock, while nothing has reached Lumo. */
  readonly retryAt: number | null;
}

const INITIAL: SosState = { phase: 'idle', incident: null, countdownEndsAt: null, lastUpdatedAt: null, stale: false, tooLateToCancel: false, error: null, retryAt: null };
export const POLL_MS = 2000;
export const POLL_FAST_MS = 1000;

const newKey = () => `sos-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
const TERMINAL = new Set(['CLOSED', 'CANCELLED']);

/** Start something and do not wait for it. A rejection is swallowed here because every caller handles its own outcome (a failed save must never stop an SOS). */
const fire = (p: Promise<unknown> | undefined): void => { p?.catch(() => undefined); };

export interface SosOptions {
  readonly now?: () => number;
  /** A rehearsal (docs/specs/PRACTICE_MODE.md): asks the server for a practice run, and NEVER touches the saved "SOS in progress" record, so a
   *  rehearsal cannot be resumed as a real alert nor clear a real one. */
  readonly practice?: boolean;
  readonly buildInput: (trigger: SosTrigger, startedAt: number) => Omit<RaiseSosInput, 'triggerType' | 'triggeredAt' | 'countdownSeconds'>;
}

export function useSos({ now = Date.now, buildInput, practice = false }: SosOptions) {
  const [state, setState] = useState<SosState>(INITIAL);
  const keyRef = useRef<string | null>(null);
  const triggerRef = useRef<SosTrigger>('manual');
  const startedRef = useRef(0);
  const incidentIdRef = useRef<string | null>(null);
  const aliveRef = useRef(true);
  const fixRef = useRef<ActiveSos['fix'] | null>(null);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attemptRef = useRef(0);
  const cancelledRef = useRef(false);
  const inFlightRef = useRef(false);
  const buildRef = useRef(buildInput);
  buildRef.current = buildInput;
  const nowRef = useRef(now);
  nowRef.current = now;

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      if (retryTimer.current) clearTimeout(retryTimer.current);
    };
  }, []);

  const stopRetry = useCallback(() => {
    if (retryTimer.current) clearTimeout(retryTimer.current);
    retryTimer.current = null;
  }, []);

  const set = useCallback((patch: Partial<SosState>) => {
    if (aliveRef.current) setState(s => ({ ...s, ...patch }));
  }, []);

  const adopt = useCallback((incident: Incident) => {
    incidentIdRef.current = incident.id;
    const counting = incident.state === 'CREATED';
    setState(s => ({
      ...s,
      incident,
      phase: counting ? 'counting' : 'live',
      stale: false,
      lastUpdatedAt: nowRef.current(),
      countdownEndsAt: counting ? (s.countdownEndsAt ?? startedRef.current + countdownFor(triggerRef.current) * 1000) : null,
    }));
    if (TERMINAL.has(incident.state) && !practice) fire(api.clearActiveSos());
  }, [practice]);

  const send = useCallback(async () => {
    if (cancelledRef.current || inFlightRef.current) return;
    stopRetry();
    const key = keyRef.current as string;
    const trigger = triggerRef.current;
    inFlightRef.current = true;
    set({ phase: 'requesting', error: null, retryAt: null });
    try {
      const built = buildRef.current(trigger, startedRef.current);
      const location = built.location ?? fixRef.current ?? undefined; // the position at the press, if there is none now
      const incident = await api.raiseSos(key, {
        triggerType: trigger,
        triggeredAt: new Date(startedRef.current).toISOString(),
        countdownSeconds: countdownFor(trigger),
        // How long ago the press was, by this device's stopwatch: the server works out the time itself, so a wrong phone clock changes nothing.
        elapsedSeconds: Math.max(0, Math.floor((nowRef.current() - startedRef.current) / 1000)),
        ...(practice ? { mode: 'practice' as const } : {}),
        ...built,
        ...(location ? { location } : {}),
      });
      if (!incident || typeof incident !== 'object' || !('id' in incident)) throw new ApiError('Unreadable answer', 'network');
      if (!aliveRef.current) return;
      // Cancelled while this was in flight: do not show it as live. The cancel, by key, settles whatever this created.
      if (cancelledRef.current) return;
      attemptRef.current = 0;
      fire(cancelSosReminder());
      if (!practice) void api.saveActiveSos({ key, incidentId: incident.id, startedAt: startedRef.current, trigger });
      adopt(incident);
    } catch (e) {
      if (!aliveRef.current || cancelledRef.current) return;
      const kind = classifyFailure(e);
      const said = e instanceof ApiError && e.kind === 'http' ? e.message : null;
      if (kind === 'tooLate') {
        // Too long ago to alert anyone. Nothing was sent, and the saved press must not come back on the next launch.
        if (!practice) fire(api.clearActiveSos());
        fire(cancelSosReminder());
        set({ phase: 'tooLate', error: null, countdownEndsAt: null, retryAt: null });
        return;
      }
      if (kind === 'signedOut') { set({ phase: 'cannot', error: null, retryAt: null }); return; }
      // Nothing reached Lumo. The countdown shown is the device's own: it does not wait for a server.
      const localDeadline = startedRef.current + countdownFor(trigger) * 1000;
      if (kind === 'refused' || practice) { set({ phase: 'unreachable', error: said, countdownEndsAt: localDeadline, retryAt: null }); return; }
      const delay = retryDelayMs(attemptRef.current);
      attemptRef.current += 1;
      if (attemptRef.current === 1) fire(scheduleSosReminder(countdownFor(trigger) + 5));
      retryTimer.current = setTimeout(() => { fire(send()); }, delay);
      set({ phase: 'unreachable', error: said, countdownEndsAt: localDeadline, retryAt: nowRef.current() + delay });
    } finally {
      inFlightRef.current = false;
    }
  }, [adopt, set, practice, stopRetry]);

  /** Press. Local feedback is the caller's job and must not wait for this. */
  const start = useCallback((trigger: SosTrigger) => {
    if (keyRef.current) return; // one SOS per screen
    keyRef.current = newKey();
    triggerRef.current = trigger;
    startedRef.current = nowRef.current();
    // Written BEFORE any network call: the key, the time, and the position at the press (so a late send still says where they were).
    const fix = buildRef.current(trigger, startedRef.current).location ?? null;
    fixRef.current = fix;
    if (!practice) void api.saveActiveSos({ key: keyRef.current, startedAt: startedRef.current, trigger, ...(fix ? { fix } : {}) });
    fire(send());
  }, [send, practice]);

  /** Retry with the SAME key: a request that did reach the server returns its incident instead of a second one. */
  const retry = useCallback(() => { if (keyRef.current) { stopRetry(); fire(send()); } }, [send, stopRetry]);

  /**
   * Finish a cancel that could not be confirmed (docs/specs/OFFLINE_SOS.md). The person cancelled with no way to know whether their request
   * had reached Lumo. This asks Lumo to cancel that press BY ITS KEY: if it arrived, it is cancelled; if not, it is made already cancelled, so
   * a request still in flight sends nothing. If Lumo cannot be reached it tries again; if the alert had already gone out, the screen shows
   * the incident as it really is. Never says "cancelled" until Lumo has said so.
   */
  const settleCancel = useCallback(async () => {
    const key = keyRef.current;
    if (!key || practice) return;
    stopRetry();
    try {
      const incident = await api.cancelSosByKey(key);
      if (!aliveRef.current) return;
      attemptRef.current = 0;
      fire(cancelSosReminder());
      fire(api.clearActiveSos());
      incidentIdRef.current = incident.id;
      adopt(incident);
      if (incident.state !== 'CANCELLED') set({ tooLateToCancel: true });
    } catch (e) {
      if (!aliveRef.current) return;
      const kind = classifyFailure(e);
      if (kind === 'retry') {
        const delay = retryDelayMs(attemptRef.current);
        attemptRef.current += 1;
        retryTimer.current = setTimeout(() => { fire(settleCancel()); }, delay);
        set({ phase: 'cancelling', retryAt: nowRef.current() + delay });
      } else {
        set({ phase: 'cancelling', retryAt: null, error: kind === 'signedOut' ? "You're not signed in, so Lumo could not confirm the cancel." : "Lumo could not confirm the cancel." });
      }
    }
  }, [adopt, set, practice, stopRetry]);

  /** Look at an incident from an earlier launch. */
  const resume = useCallback(async (): Promise<boolean> => {
    const active = await api.loadActiveSos();
    if (!active) return false;
    if (nowRef.current() - active.startedAt > 6 * 60 * 60 * 1000) { fire(api.clearActiveSos()); return false; } // too old to send, and not to be offered again
    keyRef.current = active.key;
    triggerRef.current = (active.trigger as SosTrigger) ?? 'manual';
    startedRef.current = active.startedAt;
    fixRef.current = active.fix ?? null;
    if (active.cancelled && !active.incidentId) {
      // The person cancelled before Lumo could confirm. Finish THAT: never send it.
      cancelledRef.current = true;
      set({ phase: 'cancelling', error: null });
      fire(settleCancel());
      return true;
    }
    if (active.incidentId) {
      incidentIdRef.current = active.incidentId;
      try { adopt(await api.getIncident(active.incidentId)); } catch { set({ phase: 'unreachable' }); }
    } else {
      fire(send()); // the request may or may not have gone: the same key settles it
    }
    return true;
  }, [adopt, send, set, settleCancel]);

  /** Look at an incident that something else raised (a journey's missed check-in). Starts nothing. */
  const watch = useCallback(async (incidentId: string) => {
    incidentIdRef.current = incidentId;
    try { adopt(await api.getIncident(incidentId)); } catch { set({ phase: 'unreachable' }); }
  }, [adopt, set]);

  const cancel = useCallback(async () => {
    const id = incidentIdRef.current;
    if (!id) {
      // Pressed, and Lumo has not answered: the request may or may not have arrived. Stop sending FIRST (and write that down, so a restart
      // cannot send it), then settle the cancel with Lumo by the key.
      if (!keyRef.current || practice || cancelledRef.current) return;
      cancelledRef.current = true;
      attemptRef.current = 0; // the cancel backs off from the start, not from where the send had got to
      stopRetry();
      fire(cancelSosReminder());
      void api.saveActiveSos({ key: keyRef.current, startedAt: startedRef.current, trigger: triggerRef.current, cancelled: true });
      set({ phase: 'cancelling', error: null, countdownEndsAt: null, retryAt: null });
      await settleCancel();
      return;
    }
    try {
      adopt(await api.cancelIncident(id));
    } catch (e) {
      if (e instanceof ApiError && e.kind === 'http' && e.status === 409) {
        set({ tooLateToCancel: true });
        try { adopt(await api.getIncident(id)); } catch { /* the 409 itself says it has gone */ }
      } else {
        set({ error: "Couldn't cancel just now. Try again." });
      }
    }
  }, [adopt, set, practice, stopRetry, settleCancel]);

  const resolve = useCallback(async () => {
    const id = incidentIdRef.current;
    if (!id) return;
    try { adopt(await api.resolveIncident(id)); } catch { set({ error: "Couldn't end the alert just now. Try again." }); }
  }, [adopt, set]);

  // Coming back to the app is the moment most likely to have a signal: try now rather than wait out the delay.
  const phaseRef = useRef<SosPhase>('idle');
  phaseRef.current = state.phase;
  useEffect(() => {
    const sub = AppState.addEventListener('change', next => {
      if (next !== 'active') return;
      if (phaseRef.current === 'unreachable' && retryTimer.current) { stopRetry(); fire(send()); }
      else if (phaseRef.current === 'cancelling') { stopRetry(); fire(settleCancel()); }
    });
    return () => sub.remove();
  }, [send, settleCancel, stopRetry]);

  // Poll while there is something to learn.
  const phase = state.phase;
  const terminal = state.incident ? TERMINAL.has(state.incident.state) : false;
  useEffect(() => {
    if ((phase !== 'counting' && phase !== 'live') || terminal) return;
    let stopped = false;
    const tick = async () => {
      const id = incidentIdRef.current;
      if (!id || stopped) return;
      try {
        const fresh = await api.getIncident(id);
        if (!stopped) adopt(fresh);
      } catch {
        if (!stopped) set({ stale: true }); // keep the last ledger, say it is old
      }
    };
    const handle = setInterval(tick, phase === 'counting' ? POLL_FAST_MS : POLL_MS);
    return () => { stopped = true; clearInterval(handle); };
  }, [phase, terminal, adopt, set]);

  return { state, start, retry, resume, watch, cancel, resolve };
}
