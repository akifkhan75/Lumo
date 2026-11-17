import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '@lumo/api-client';
import type { CreateJourneyLinkInput, CreatedJourneyLink, JourneyLinkInfo } from '@lumo/types';
import * as api from '../services/apiService';

/**
 * Who could be looking at this journey. The list is the SERVER's, read again every few seconds while the journey runs, so the indicator
 * reflects what is true and not what this screen remembers doing: a link made on another device, or one that expired, shows correctly.
 * If a refresh fails the last list stays and is marked old; a link is never hidden because the network dropped.
 */
export const LINKS_POLL_MS = 10_000;

export interface LinksState {
  readonly links: readonly JourneyLinkInfo[] | null;
  readonly stale: boolean;
  readonly busy: boolean;
  readonly error: string | null;
}

const words = (e: unknown, fallback: string): string =>
  e instanceof ApiError && e.kind === 'http' && e.status !== 401 && e.status !== 404 && e.message ? e.message : fallback;

export function useJourneyLinks(journeyId: string | null, active: boolean) {
  const [state, setState] = useState<LinksState>({ links: null, stale: false, busy: false, error: null });
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const refresh = useCallback(async () => {
    if (!journeyId) return;
    try {
      const links = await api.listJourneyLinks(journeyId);
      if (alive.current) setState(s => ({ ...s, links: Array.isArray(links) ? links : [], stale: false }));
    } catch {
      if (alive.current) setState(s => ({ ...s, stale: true }));
    }
  }, [journeyId]);

  useEffect(() => {
    setState({ links: null, stale: false, busy: false, error: null });
    if (!journeyId || !active) return;
    refresh();
    const h = setInterval(refresh, LINKS_POLL_MS);
    return () => clearInterval(h);
  }, [journeyId, active, refresh]);

  const create = useCallback(async (input: CreateJourneyLinkInput): Promise<CreatedJourneyLink | null> => {
    if (!journeyId) return null;
    if (alive.current) setState(s => ({ ...s, busy: true, error: null }));
    try {
      const made = await api.createJourneyLink(journeyId, input);
      if (alive.current) setState(s => ({ ...s, busy: false }));
      await refresh();
      return made;
    } catch (e) {
      if (alive.current) setState(s => ({ ...s, busy: false, error: words(e, "Couldn't make a link. Check your connection and try again.") }));
      return null;
    }
  }, [journeyId, refresh]);

  /** Revoke one link, or every live one. The list is re-read afterwards, so what the screen says is what the server holds. */
  const revoke = useCallback(async (linkIds: readonly string[]): Promise<boolean> => {
    if (!journeyId) return false;
    if (alive.current) setState(s => ({ ...s, busy: true, error: null }));
    let failed = 0;
    for (const id of linkIds) {
      try { await api.revokeJourneyLink(journeyId, id); } catch { failed += 1; }
    }
    await refresh();
    if (alive.current) setState(s => ({ ...s, busy: false, error: failed ? (failed === linkIds.length ? "Couldn't turn the link off. It may still work. Try again." : "Couldn't turn every link off. Some may still work. Try again.") : null }));
    return failed === 0;
  }, [journeyId, refresh]);

  return { state, refresh, create, revoke };
}
