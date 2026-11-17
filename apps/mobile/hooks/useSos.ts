import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '@lumo/api-client';
import type { Incident, RaiseSosInput } from '@lumo/types';
import * as api from '../services/apiService';
import { countdownFor, type SosTrigger } from '../services/sosCountdown';

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
 *  - `unreachable`  the request did not complete. NOTHING HAS BEEN SENT. The same key is reused on retry, so a
 *                   request that actually got through is not duplicated.
 *  - `cannot`       the server refused the credential: not signed in, token gone. Nothing has been sent.
 *
 * A failure to REFRESH an incident that exists is not a failure of the incident: the last known ledger stays on
 * screen with its age, marked as such. The ledger is never invented and never optimistic.
 */

export type SosPhase = 'idle' | 'requesting' | 'counting' | 'live' | 'unreachable' | 'cannot';

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
}

const INITIAL: SosState = { phase: 'idle', incident: null, countdownEndsAt: null, lastUpdatedAt: null, stale: false, tooLateToCancel: false, error: null };
export const POLL_MS = 2000;
export const POLL_FAST_MS = 1000;

const newKey = () => `sos-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
const TERMINAL = new Set(['CLOSED', 'CANCELLED']);

export interface SosOptions {
  readonly now?: () => number;
  readonly buildInput: (trigger: SosTrigger, startedAt: number) => Omit<RaiseSosInput, 'triggerType' | 'triggeredAt' | 'countdownSeconds'>;
}

export function useSos({ now = Date.now, buildInput }: SosOptions) {
  const [state, setState] = useState<SosState>(INITIAL);
  const keyRef = useRef<string | null>(null);
  const triggerRef = useRef<SosTrigger>('manual');
  const startedRef = useRef(0);
  const incidentIdRef = useRef<string | null>(null);
  const aliveRef = useRef(true);
  const buildRef = useRef(buildInput);
  buildRef.current = buildInput;
  const nowRef = useRef(now);
  nowRef.current = now;

  useEffect(() => {
    aliveRef.current = true;
    return () => { aliveRef.current = false; };
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
    if (TERMINAL.has(incident.state)) void api.clearActiveSos();
  }, []);

  const send = useCallback(async () => {
    const key = keyRef.current as string;
    const trigger = triggerRef.current;
    set({ phase: 'requesting', error: null });
    try {
      const incident = await api.raiseSos(key, {
        triggerType: trigger,
        triggeredAt: new Date(startedRef.current).toISOString(),
        countdownSeconds: countdownFor(trigger),
        ...buildRef.current(trigger, startedRef.current),
      });
      if (!incident || typeof incident !== 'object' || !('id' in incident)) throw new ApiError('Unreadable answer', 'network');
      if (!aliveRef.current) return;
      void api.saveActiveSos({ key, incidentId: incident.id, startedAt: startedRef.current, trigger });
      adopt(incident);
    } catch (e) {
      if (!aliveRef.current) return;
      const refused = e instanceof ApiError && e.kind === 'http' && (e.status === 401 || e.status === 403);
      set({ phase: refused ? 'cannot' : 'unreachable', error: e instanceof ApiError && e.kind === 'http' && !refused ? e.message : null });
    }
  }, [adopt, set]);

  /** Press. Local feedback is the caller's job and must not wait for this. */
  const start = useCallback((trigger: SosTrigger) => {
    if (keyRef.current) return; // one SOS per screen
    keyRef.current = newKey();
    triggerRef.current = trigger;
    startedRef.current = nowRef.current();
    // Written BEFORE any network call; ids and a time only.
    void api.saveActiveSos({ key: keyRef.current, startedAt: startedRef.current, trigger });
    void send();
  }, [send]);

  /** Retry with the SAME key: a request that did reach the server returns its incident instead of a second one. */
  const retry = useCallback(() => { if (keyRef.current) void send(); }, [send]);

  /** Look at an incident from an earlier launch. */
  const resume = useCallback(async (): Promise<boolean> => {
    const active = await api.loadActiveSos();
    if (!active || nowRef.current() - active.startedAt > 6 * 60 * 60 * 1000) return false;
    keyRef.current = active.key;
    triggerRef.current = (active.trigger as SosTrigger) ?? 'manual';
    startedRef.current = active.startedAt;
    if (active.incidentId) {
      incidentIdRef.current = active.incidentId;
      try { adopt(await api.getIncident(active.incidentId)); } catch { set({ phase: 'unreachable' }); }
    } else {
      void send(); // the request may or may not have gone: the same key settles it
    }
    return true;
  }, [adopt, send, set]);

  const cancel = useCallback(async () => {
    const id = incidentIdRef.current;
    if (!id) return;
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
  }, [adopt, set]);

  const resolve = useCallback(async () => {
    const id = incidentIdRef.current;
    if (!id) return;
    try { adopt(await api.resolveIncident(id)); } catch { set({ error: "Couldn't end the alert just now. Try again." }); }
  }, [adopt, set]);

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

  return { state, start, retry, resume, cancel, resolve };
}
