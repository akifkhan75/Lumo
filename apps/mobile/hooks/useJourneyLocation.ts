import { useCallback, useEffect, useRef, useState } from 'react';
import type { JourneyFix } from '@lumo/types';
import * as api from '../services/apiService';
import type { Fix } from '../services/locationFormat';

/**
 * Saving the journey's positions (docs/specs/LOCATION.md, JOURNEYS.md). Foreground only, and only while `enabled`.
 *
 * What it will and will not do: it uploads the fixes the screen already has, in batches, to the person's own journey, where they are used
 * ONLY if a check-in goes unanswered. It never uploads a fix with unknown accuracy (the hook that produces them already drops those). Fixes
 * that could not be sent are kept, newest last, up to a cap, and resent; a resent batch is idempotent on the server. Nothing is kept across a
 * restart (the durable queue is 1.13). It reports plainly whether it is saving, so the person always sees the state it is in.
 */
export const FLUSH_MS = 30_000;
export const FLUSH_AT = 5;
export const MAX_PENDING = 200;

export interface JourneyLocationState { readonly saving: boolean; readonly pending: number; readonly lastSavedAt: number | null; readonly failing: boolean }

export function useJourneyLocation(sessionId: string | null, fix: Fix | null, enabled: boolean, onResult?: (r: { atDestination: boolean; arrived: boolean }) => void) {
  const pending = useRef<JourneyFix[]>([]);
  const lastSeen = useRef<number | null>(null);
  const flushing = useRef(false);
  const [state, setState] = useState<JourneyLocationState>({ saving: false, pending: 0, lastSavedAt: null, failing: false });
  const onResultRef = useRef(onResult);
  onResultRef.current = onResult;

  const flush = useCallback(async () => {
    if (!sessionId || flushing.current || pending.current.length === 0) return;
    flushing.current = true;
    const batch = pending.current.slice(0, 100);
    try {
      const r = await api.postJourneyLocation(sessionId, batch);
      pending.current = pending.current.slice(batch.length);
      setState(s => ({ ...s, pending: pending.current.length, lastSavedAt: Date.now(), failing: false }));
      onResultRef.current?.({ atDestination: r.atDestination, arrived: r.arrived });
    } catch {
      setState(s => ({ ...s, failing: true, pending: pending.current.length })); // kept, and tried again
    } finally {
      flushing.current = false;
    }
  }, [sessionId]);

  useEffect(() => {
    if (!enabled || !sessionId || !fix || fix.capturedAt === lastSeen.current) return;
    lastSeen.current = fix.capturedAt;
    pending.current = [...pending.current, { latitude: fix.latitude, longitude: fix.longitude, accuracyM: fix.accuracyM, capturedAt: fix.capturedAt, source: 'gps' }].slice(-MAX_PENDING);
    setState(s => ({ ...s, saving: true, pending: pending.current.length }));
    if (pending.current.length >= FLUSH_AT) flush();
  }, [fix, enabled, sessionId, flush]);

  useEffect(() => {
    if (!enabled || !sessionId) { setState(s => ({ ...s, saving: false })); return; }
    const h = setInterval(flush, FLUSH_MS);
    return () => clearInterval(h);
  }, [enabled, sessionId, flush]);

  return { ...state, flush };
}
