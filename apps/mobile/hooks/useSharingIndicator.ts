import { useEffect, useRef, useState } from 'react';
import * as api from '../services/apiService';
import { liveLinks } from '../services/journeyLinks';

export const INDICATOR_POLL_MS = 15_000;
const ENDED = new Set(['CLOSED', 'CANCELLED', 'EXPIRED', 'ARRIVED']);

/**
 * How many live links exist for the person's current journey, for the strip on the dashboard (invariant 4: sharing is never invisible).
 * Unknown is not zero: if the server cannot be asked, the last answer stays, so a dropped connection does not hide a link that works.
 */
export function useSharingIndicator(enabled: boolean): { count: number; journeyActive: boolean } {
  const [count, setCount] = useState(0);
  const [journeyActive, setJourneyActive] = useState(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  useEffect(() => {
    if (!enabled) return;
    const read = async () => {
      try {
        const j = await api.getActiveJourney();
        if (!alive.current) return;
        if (!j || ENDED.has(j.state)) { setJourneyActive(false); setCount(0); return; }
        const links = await api.listJourneyLinks(j.id);
        if (!alive.current) return;
        setJourneyActive(true);
        setCount(liveLinks(Array.isArray(links) ? links : []).length);
      } catch { /* keep what we last knew */ }
    };
    read();
    const h = setInterval(read, INDICATOR_POLL_MS);
    return () => clearInterval(h);
  }, [enabled]);

  return { count, journeyActive };
}
