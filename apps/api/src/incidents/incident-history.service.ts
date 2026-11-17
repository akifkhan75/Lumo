import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { INCIDENT_TERMINAL, rollupIncident, type AttemptState, type Channel } from '@lumo/safety-domain';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Incident history and the exportable timeline (docs/specs/INCIDENT_HISTORY.md, PRO-9).
 *
 * Two rules shape everything here:
 *  - A REHEARSAL IS NEVER IN THE HISTORY. The list is real incidents unless `mode=practice` is asked for, and then it is practice ONLY, every
 *    row marked, so a person scrolling back cannot mistake one for the other.
 *  - THE TIMELINE IS THE RECORD, NOT THE PERSON'S DATA. It carries every state change and every attempt event with its true time and order,
 *    and the names of the contacts. It never carries a coordinate or a phone number: where someone was, and how to reach their contacts, are
 *    not what a timeline is for, and an export leaves the app.
 * Everything is the caller's own: another user's incident is a 404, never a 403.
 */

export const HISTORY_PAGE_DEFAULT = 20;
export const HISTORY_PAGE_MAX = 50;
export type HistoryMode = 'real' | 'practice';

export interface IncidentSummary {
  readonly id: string;
  readonly mode: HistoryMode;
  readonly state: string;
  readonly outcome: string;
  readonly triggerType: string;
  readonly triggeredAt: string;
  readonly createdAt: string;
  readonly lateBySeconds: number;
  readonly locationAvailable: boolean;
  /** Counts only: who is in the timeline, not here. */
  readonly contactsTried: number;
  readonly contactsReached: number;
  readonly contactsFailed: number;
  readonly resolvedAt: string | null;
  readonly closedAt: string | null;
}

export interface TimelineEntry {
  readonly at: string;
  readonly kind: 'incident' | 'attempt';
  readonly event: string;
  readonly from: string | null;
  readonly to: string;
  readonly actor: string | null;
  readonly reason: string | null;
  readonly recipient: string | null;
  readonly channel: string | null;
  readonly purpose: string | null;
  readonly simulated: boolean;
}

export interface Timeline {
  readonly incident: IncidentSummary;
  readonly entries: readonly TimelineEntry[];
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);

const encodeCursor = (createdAt: Date, id: string) => Buffer.from(`${createdAt.toISOString()}|${id}`).toString('base64url');
function decodeCursor(cursor: string): { createdAt: Date; id: string } {
  try {
    const [t, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
    const createdAt = new Date(t);
    if (!id || Number.isNaN(createdAt.getTime()) || !/^[0-9a-f-]{36}$/i.test(id)) throw new Error('bad');
    return { createdAt, id };
  } catch {
    throw new BadRequestException('That page marker is not valid. Start from the first page.');
  }
}

@Injectable()
export class IncidentHistoryService {
  constructor(private readonly prisma: PrismaService) {}

  private summarise(
    inc: { id: string; mode: 'real' | 'practice'; state: string; triggerType: string; triggeredAt: Date; createdAt: Date; lateBySeconds: number; locationAvailable: boolean; resolvedAt: Date | null; closedAt: Date | null },
    attempts: readonly { recipientId: string; channel: Channel; state: AttemptState }[],
  ): IncidentSummary {
    const roll = rollupIncident(attempts);
    const tried = new Set(attempts.map(a => a.recipientId)).size;
    return {
      id: inc.id, mode: inc.mode, state: inc.state,
      outcome: (INCIDENT_TERMINAL as readonly string[]).includes(inc.state) ? inc.state : roll.outcome,
      triggerType: inc.triggerType, triggeredAt: inc.triggeredAt.toISOString(), createdAt: inc.createdAt.toISOString(),
      lateBySeconds: inc.lateBySeconds, locationAvailable: inc.locationAvailable,
      contactsTried: tried, contactsReached: roll.reached.length + roll.acknowledged.length, contactsFailed: roll.failed.length,
      resolvedAt: iso(inc.resolvedAt), closedAt: iso(inc.closedAt),
    };
  }

  /** A page of the caller's incidents, newest first. Real by default; `practice` returns rehearsals only. */
  async list(userId: string, opts: { limit?: number; cursor?: string; mode?: HistoryMode }): Promise<{ incidents: IncidentSummary[]; nextCursor: string | null }> {
    const mode = opts.mode ?? 'real';
    const limit = Math.min(Math.max(opts.limit ?? HISTORY_PAGE_DEFAULT, 1), HISTORY_PAGE_MAX);
    const c = opts.cursor ? decodeCursor(opts.cursor) : null;
    const rows = await this.prisma.emergencyIncident.findMany({
      where: {
        userId, mode,
        ...(c ? { OR: [{ createdAt: { lt: c.createdAt } }, { createdAt: c.createdAt, id: { lt: c.id } }] } : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });
    const page = rows.slice(0, limit);
    const ids = page.map(r => r.id);
    // One query for the page's attempts, not one per incident.
    const real = mode === 'real' ? await this.prisma.notificationAttempt.findMany({ where: { incidentId: { in: ids }, purpose: 'ALERT' }, select: { incidentId: true, recipientId: true, channel: true, state: true } }) : [];
    const sim = mode === 'practice' ? await this.prisma.practiceAttempt.findMany({ where: { incidentId: { in: ids } }, select: { incidentId: true, recipientId: true, channel: true, state: true } }) : [];
    const by = new Map<string, { recipientId: string; channel: Channel; state: AttemptState }[]>();
    for (const a of [...real, ...sim]) by.set(a.incidentId, [...(by.get(a.incidentId) ?? []), a]);
    const last = page[page.length - 1];
    return {
      incidents: page.map(r => this.summarise(r, by.get(r.id) ?? [])),
      nextCursor: rows.length > limit && last ? encodeCursor(last.createdAt, last.id) : null,
    };
  }

  /** The caller's incident with every state change and attempt event, in the order they happened. */
  async timeline(userId: string, id: string): Promise<Timeline> {
    const inc = await this.prisma.emergencyIncident.findFirst({ where: { id, userId } });
    if (!inc) throw new NotFoundException();
    const events = await this.prisma.incidentEvent.findMany({ where: { incidentId: id }, orderBy: { seq: 'asc' } });
    const practice = inc.mode === 'practice';

    const attempts = practice
      ? (await this.prisma.practiceAttempt.findMany({ where: { incidentId: id }, orderBy: [{ queuedAt: 'asc' }, { id: 'asc' }] })).map(a => ({
          id: a.id, recipientId: a.recipientId, channel: a.channel as Channel, purpose: 'ALERT', state: a.state as AttemptState,
          events: [
            { seq: 1, toState: 'QUEUED', reason: 'PLANNED', occurredAt: a.queuedAt },
            ...(a.sentAt ? [{ seq: 2, toState: 'SENT', reason: null, occurredAt: a.sentAt }] : []),
            ...(a.deliveredAt ? [{ seq: 3, toState: 'DELIVERED', reason: null, occurredAt: a.deliveredAt }] : []),
            ...(a.failedAt ? [{ seq: 4, toState: 'FAILED', reason: a.reason, occurredAt: a.failedAt }] : []),
          ] as { seq: number; toState: string; reason: string | null; occurredAt: Date }[],
        }))
      : (await this.prisma.notificationAttempt.findMany({ where: { incidentId: id }, include: { events: { orderBy: { seq: 'asc' } } }, orderBy: { queuedAt: 'asc' } })).map(a => ({
          id: a.id, recipientId: a.recipientId, channel: a.channel as Channel, purpose: a.purpose, state: a.state as AttemptState,
          events: a.events.map(e => ({ seq: e.seq, toState: e.toState as string, reason: e.reason, occurredAt: e.occurredAt })),
        }));

    const names = new Map((await this.prisma.trustedContact.findMany({ where: { id: { in: [...new Set(attempts.map(a => a.recipientId))] } }, select: { id: true, name: true } })).map(c => [c.id, c.name]));

    const entries: (TimelineEntry & { _order: number })[] = [];
    events.forEach((e, i) => entries.push({
      at: e.occurredAt.toISOString(), kind: 'incident', event: e.event, from: e.fromState, to: e.toState, actor: e.actor, reason: e.reason,
      recipient: null, channel: null, purpose: null, simulated: false, _order: i,
    }));
    attempts.forEach((a, ai) => a.events.forEach((e, ei) => entries.push({
      at: e.occurredAt.toISOString(), kind: 'attempt', event: `ATTEMPT_${e.toState}`, from: null, to: e.toState, actor: null, reason: e.reason,
      recipient: names.get(a.recipientId) ?? 'A contact who was removed', channel: a.channel, purpose: a.purpose, simulated: practice,
      _order: 100_000 + ai * 100 + ei,
    })));
    // By when it happened; where two things share a moment, the incident's own step first, then attempts in the order they were made.
    entries.sort((x, y) => (x.at < y.at ? -1 : x.at > y.at ? 1 : x._order - y._order));

    return {
      incident: this.summarise(inc, attempts.filter(a => a.purpose === 'ALERT')),
      entries: entries.map(({ _order, ...e }) => e),
    };
  }

  async recordExport(userId: string, incidentId: string, format: 'json' | 'csv'): Promise<void> {
    await this.prisma.auditLog.create({ data: { actorId: userId, action: 'incident.timeline_exported', subjectType: 'EmergencyIncident', subjectId: incidentId, metadata: { format } } });
  }
}

const COLUMNS = ['incident', 'mode', 'at', 'kind', 'event', 'from', 'to', 'actor', 'reason', 'recipient', 'channel', 'purpose', 'simulated'] as const;

/** A cell, safe to open in a spreadsheet: quoted, and a leading = + - @ (a formula) or tab neutralised, so a contact named "=HYPERLINK(...)" is text. */
const cell = (v: unknown): string => {
  let s = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** One row per timeline entry, each carrying the incident id and its mode, so a rehearsal exported and filed away is still marked as one. */
export function timelineToCsv(t: Timeline): string {
  const rows = t.entries.map(e => COLUMNS.map(c => cell(c === 'incident' ? t.incident.id : c === 'mode' ? t.incident.mode : (e as unknown as Record<string, unknown>)[c])).join(','));
  return [COLUMNS.join(','), ...rows].join('\r\n') + '\r\n';
}
