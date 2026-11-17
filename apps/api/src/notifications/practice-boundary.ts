import type { IncidentMode } from '@lumo/safety-domain';

/**
 * The practice boundary (docs/specs/PRACTICE_MODE.md): nothing is planned, queued or sent for a practice incident.
 *
 * Enforced three times, so no single mistake can send a rehearsal to a real person:
 *  1. here, at PLAN time (`DispatchService`), which throws;
 *  2. in the send worker, before any provider is called, which settles the attempt as never attempted;
 *  3. in the database: a trigger refuses a `NotificationAttempt` row for a practice incident, whatever wrote it.
 * Practice has its own simulated ledger (`PracticeAttempt`), which no worker reads.
 */
export class PracticeBoundaryError extends Error {
  constructor(incidentId: string) {
    super(`Incident ${incidentId} is a practice run: nothing may be planned or sent for it.`);
    this.name = 'PracticeBoundaryError';
  }
}

/** Throws unless the incident is a real one. Call before planning or sending anything for it. */
export function assertReal(incidentId: string, mode: IncidentMode): void {
  if (mode !== 'real') throw new PracticeBoundaryError(incidentId);
}
