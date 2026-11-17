import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '@lumo/api-client';
import type { CreateJourneyInput, Journey } from '@lumo/types';
import * as api from '../services/apiService';

/**
 * The person's current journey (docs/specs/JOURNEYS.md). The SERVER keeps the deadline; this only shows it and answers it. If a refresh
 * fails the last state stays on screen, marked as old: a journey that is overdue is never hidden because the network dropped.
 */
export const JOURNEY_POLL_MS = 5000;
const TERMINAL = new Set(['CLOSED', 'CANCELLED', 'EXPIRED', 'ARRIVED']);

export interface JourneyState {
  readonly loading: boolean;
  readonly journey: Journey | null;
  /** The last refresh failed; what is shown may be out of date. */
  readonly stale: boolean;
  readonly lastUpdatedAt: number | null;
  /** The last thing the person tried, if it did not work, in words. */
  readonly error: string | null;
  readonly busy: boolean;
}

const words = (e: unknown, fallback: string): string =>
  e instanceof ApiError && e.kind === 'http' && e.status !== 401 && e.status !== 404 && e.message ? e.message : fallback;

export function useJourney(now: () => number = Date.now) {
  const [state, setState] = useState<JourneyState>({ loading: true, journey: null, stale: false, lastUpdatedAt: null, error: null, busy: false });
  const alive = useRef(true);
  const nowRef = useRef(now);
  nowRef.current = now;
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const adopt = useCallback((journey: Journey | null) => {
    if (alive.current) setState(s => ({ ...s, loading: false, journey, stale: false, error: null, lastUpdatedAt: nowRef.current() }));
  }, []);

  const refresh = useCallback(async () => {
    try { adopt(await api.getActiveJourney()); }
    catch { if (alive.current) setState(s => ({ ...s, loading: false, stale: true })); }
  }, [adopt]);

  useEffect(() => { refresh(); }, [refresh]);

  const live = state.journey !== null && !TERMINAL.has(state.journey.state);
  useEffect(() => {
    if (!live) return;
    const h = setInterval(refresh, JOURNEY_POLL_MS);
    return () => clearInterval(h);
  }, [live, refresh]);

  const act = useCallback(async (run: () => Promise<Journey>, failed: string) => {
    if (alive.current) setState(s => ({ ...s, busy: true, error: null }));
    try { const j = await run(); if (alive.current) setState(s => ({ ...s, busy: false })); adopt(j); return j; }
    catch (e) { if (alive.current) setState(s => ({ ...s, busy: false, error: words(e, failed) })); return null; }
  }, [adopt]);

  return {
    state,
    refresh,
    start: (input: CreateJourneyInput) => act(() => api.createJourney(input), "Couldn't start the journey. Check your connection and try again."),
    checkIn: (arriveAtMs: number) => act(() => { const j = state.journey; if (!j) return Promise.reject(new Error('none')); return api.checkInJourney(j.id, new Date(arriveAtMs).toISOString()); }, "Couldn't send your answer. Try again."),
    arrive: () => act(() => { const j = state.journey; if (!j) return Promise.reject(new Error('none')); return api.arriveJourney(j.id); }, "Couldn't end the journey. Try again."),
    cancel: () => act(() => { const j = state.journey; if (!j) return Promise.reject(new Error('none')); return api.cancelJourney(j.id); }, "Couldn't cancel the journey. Try again."),
    dismiss: () => setState(s => ({ ...s, journey: null, error: null })),
  };
}
