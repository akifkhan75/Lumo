import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * "Nothing else writes attempt state." The ledger is evidence only if every state on every
 * row has an event behind it, decided by the state machine. This fails if any other file under
 * src/ updates a NotificationAttempt's state or touches NotificationEvent.
 */
function* files(dir: string): Generator<string> {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) yield* files(p);
    else if (p.endsWith('.ts') && !p.endsWith('.spec.ts')) yield p;
  }
}

describe('the ledger writer is the only writer of attempt state', () => {
  const ALLOWED = new Set(['ledger.service.ts', 'dispatch.service.ts']); // dispatch CREATES attempts (state QUEUED) and their first event
  const offenders: string[] = [];
  for (const f of files(join(__dirname, '..'))) {
    const name = f.split('/').pop()!;
    const text = readFileSync(f, 'utf8');
    const writesState =
      /notificationAttempt\.(update|updateMany|upsert)\([^]*?data:\s*\{[^}]*\bstate\b/.test(text) ||
      /UPDATE\s+"NotificationAttempt"[^;]*"state"/is.test(text);
    const touchesEvents = /notificationEvent\.(create|createMany|update|updateMany|delete|deleteMany|upsert)/.test(text);
    if ((writesState || touchesEvents) && !ALLOWED.has(name)) offenders.push(f);
  }
  it('no other file under src/ updates attempt state or writes events', () => {
    expect(offenders).toEqual([]);
  });

  it('the worker claims with claimedAt only — never with state', () => {
    const text = readFileSync(join(__dirname, 'send-worker.ts'), 'utf8');
    expect(text).toMatch(/updateMany\(\{\s*where: \{ id: attemptId, state: 'QUEUED', claimedAt: null \},\s*data: \{ claimedAt: now \}/);
  });

  it('dispatch only ever creates attempts as QUEUED', () => {
    const text = readFileSync(join(__dirname, 'dispatch.service.ts'), 'utf8');
    expect(text).not.toMatch(/state:\s*'(SENT|DELIVERED|ACKNOWLEDGED|FAILED|EXPIRED|UNKNOWN)'/);
  });
});
