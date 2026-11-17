import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';
import { SESSION_TERMINAL, type SessionState } from '@lumo/safety-domain';
import { IncidentService } from '../incidents/incident.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * The journey link (docs/specs/WEB.md → docs/engineering/WEB.md, RES-11, threat T6).
 *
 * THE TOKEN IS THE CREDENTIAL, so everything here is about keeping what it unlocks small and the token itself unguessable:
 *  - 256 random bits, shown ONCE to the person; only its SHA-256 is stored (a database read cannot produce a working link);
 *  - it expires (short by default), is revoked in one action, and dies with the journey: an ended journey shows no position at all;
 *  - it shows what the person authorised and NOTHING else: who, the journey's status, when they should arrive, and the LATEST position
 *    with its age and accuracy, if they are saving it. Never medical data, never a history of positions, never their contact list,
 *    never anything about another journey. This is asserted over the exact keys of the response, not over how a page renders it;
 *  - an unknown, expired or revoked token is one indistinguishable answer, so a token cannot be probed;
 *  - an optional PIN, which locks the link after MAX_PIN_FAILURES wrong guesses.
 *
 * A link holder is NOT a known contact: the link says nothing about who they are. So "I'm responding" through it is recorded as
 * "someone with your link", and it halts the escalation like any acknowledgement (that is its purpose). A leaked link can therefore be
 * used to halt an escalation: that is why the person can see how often it was opened, and revoke it in one tap.
 */

export const DEFAULT_LINK_GRACE_MS = 2 * 3600_000;
export const MAX_LINK_MINUTES = 7 * 24 * 60;
export const MIN_LINK_MINUTES = 15;
export const MAX_LIVE_LINKS = 5;
export const MAX_PIN_FAILURES = 10;

const hashToken = (t: string) => createHash('sha256').update(t).digest('hex');
const PIN = /^\d{4,8}$/;

export function hashPin(pin: string): string {
  const salt = randomBytes(16);
  return `${salt.toString('hex')}:${scryptSync(pin, salt, 32).toString('hex')}`;
}
export function pinMatches(pin: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const given = scryptSync(pin, Buffer.from(salt, 'hex'), 32);
  const want = Buffer.from(hash, 'hex');
  return given.length === want.length && timingSafeEqual(given, want);
}

/** The EXACT keys a link holder can ever receive. A test pins this list: adding a field is a deliberate, reviewed act. */
export interface PublicJourney {
  readonly who: string;
  readonly status: { readonly code: 'on_the_way' | 'check_in_due' | 'alert_raised' | 'ended' | 'cancelled'; readonly text: string };
  readonly expectedArrivalAt: string | null;
  readonly location: { readonly latitude: number; readonly longitude: number; readonly accuracyM: number; readonly capturedAt: string } | null;
  /** Server time when this was read, so the page computes ages without trusting the contact's clock. */
  readonly asOf: string;
  readonly canRespond: boolean;
  readonly responding: boolean;
}

export type LinkLookup = { readonly kind: 'invalid' } | { readonly kind: 'pin_required' } | { readonly kind: 'ok'; readonly journey: PublicJourney; readonly sessionId: string };

export function statusFor(state: SessionState, who: string, dueAt: Date | null): PublicJourney['status'] {
  void dueAt; // the page shows the arrival time itself, in the viewer's own timezone
  switch (state) {
    case 'CHECK_IN_DUE':
    case 'GRACE':
      return { code: 'check_in_due', text: `${who}'s check-in is due. Lumo has asked them. It has not been answered yet.` };
    case 'ESCALATING':
    case 'ALERTED':
      return { code: 'alert_raised', text: `${who} did not answer a check-in. Lumo is trying to alert their contacts.` };
    case 'CANCELLED':
      return { code: 'cancelled', text: `${who} cancelled this journey.` };
    case 'ARRIVED':
    case 'CLOSED':
    case 'EXPIRED':
      return { code: 'ended', text: `This journey has ended.` };
    default:
      return { code: 'on_the_way', text: `${who} is on their way.` };
  }
}

@Injectable()
export class JourneyLinkService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly incidents: IncidentService,
  ) {}

  // ----------------------------------------------------------------- the owner

  private async ownedSession(userId: string, sessionId: string) {
    const s = await this.prisma.safetySession.findFirst({ where: { id: sessionId, userId } });
    if (!s) throw new NotFoundException();
    return s;
  }

  /** Mint a link. The token is returned ONCE and cannot be recovered. */
  async create(userId: string, sessionId: string, opts: { expiresInMinutes?: number; pin?: string }, now: Date = new Date()) {
    const s = await this.ownedSession(userId, sessionId);
    if (SESSION_TERMINAL.includes(s.state) || s.state === 'ARRIVED') throw new ConflictException('This journey has ended, so it cannot be shared.');
    if (opts.pin !== undefined && !PIN.test(opts.pin)) throw new BadRequestException('A PIN is 4 to 8 digits.');
    if (opts.expiresInMinutes !== undefined && (opts.expiresInMinutes < MIN_LINK_MINUTES || opts.expiresInMinutes > MAX_LINK_MINUTES)) {
      throw new BadRequestException(`A link lasts between ${MIN_LINK_MINUTES} minutes and 7 days.`);
    }
    const live = await this.prisma.journeyLink.count({ where: { sessionId, revokedAt: null, expiresAt: { gt: now } } });
    if (live >= MAX_LIVE_LINKS) throw new ConflictException('This journey already has several links. Revoke one first.');

    // Short by default: until the journey should be over, plus two hours.
    const base = Math.max((s.checkInDueAt ?? now).getTime(), now.getTime());
    const expiresAt = new Date(opts.expiresInMinutes !== undefined ? now.getTime() + opts.expiresInMinutes * 60_000 : Math.min(base + DEFAULT_LINK_GRACE_MS, now.getTime() + MAX_LINK_MINUTES * 60_000));
    const token = randomBytes(32).toString('base64url');
    const row = await this.prisma.journeyLink.create({
      data: { sessionId, tokenHash: hashToken(token), expiresAt, createdAt: now, pinHash: opts.pin ? hashPin(opts.pin) : null },
      select: { id: true },
    });
    return { id: row.id, token, expiresAt, hasPin: Boolean(opts.pin) };
  }

  /** Who could be looking: every link, how long it lasts, how often it was opened, and whether it was revoked. Never the token. */
  async list(userId: string, sessionId: string, now: Date = new Date()) {
    await this.ownedSession(userId, sessionId);
    const rows = await this.prisma.journeyLink.findMany({ where: { sessionId }, orderBy: { createdAt: 'asc' } });
    return rows.map(r => ({
      id: r.id, createdAt: r.createdAt, expiresAt: r.expiresAt, revokedAt: r.revokedAt, hasPin: r.pinHash !== null,
      viewCount: r.viewCount, lastViewedAt: r.lastViewedAt, live: r.revokedAt === null && r.expiresAt > now,
    }));
  }

  async revoke(userId: string, sessionId: string, linkId: string, now: Date = new Date()): Promise<void> {
    await this.ownedSession(userId, sessionId);
    const { count } = await this.prisma.journeyLink.updateMany({ where: { id: linkId, sessionId, revokedAt: null }, data: { revokedAt: now } });
    if (count !== 1) {
      const exists = await this.prisma.journeyLink.findFirst({ where: { id: linkId, sessionId }, select: { id: true } });
      if (!exists) throw new NotFoundException(); // already revoked is fine (idempotent); an unknown one is not
    }
  }

  // ------------------------------------------------------------- the link holder

  /** Resolve a token. One answer for unknown, expired and revoked. */
  async lookup(token: string, pin: string | undefined, now: Date = new Date(), countView = false): Promise<LinkLookup> {
    const link = await this.prisma.journeyLink.findUnique({ where: { tokenHash: hashToken(token) } });
    if (!link || link.revokedAt || link.expiresAt <= now) return { kind: 'invalid' };

    if (link.pinHash) {
      if (!pin) return { kind: 'pin_required' };
      if (!pinMatches(pin, link.pinHash)) {
        // A PIN that can be guessed is not a PIN: count it, and lock the link when the guesses run out.
        const updated = await this.prisma.journeyLink.update({ where: { id: link.id }, data: { failedPinAttempts: { increment: 1 } }, select: { failedPinAttempts: true } });
        if (updated.failedPinAttempts >= MAX_PIN_FAILURES) await this.prisma.journeyLink.update({ where: { id: link.id }, data: { revokedAt: now } });
        return { kind: 'pin_required' };
      }
    }
    if (countView) await this.prisma.journeyLink.update({ where: { id: link.id }, data: { viewCount: { increment: 1 }, lastViewedAt: now } }).catch(() => undefined);

    const s = await this.prisma.safetySession.findUniqueOrThrow({ where: { id: link.sessionId }, include: { user: { select: { fullName: true } } } });
    const live = !SESSION_TERMINAL.includes(s.state) && s.state !== 'ARRIVED';
    const fix = live && s.shareLocation ? await this.prisma.locationSnapshot.findFirst({ where: { sessionId: s.id }, orderBy: { capturedAt: 'desc' } }) : null;
    const incident = await this.prisma.emergencyIncident.findFirst({ where: { sessionId: s.id, state: { notIn: ['CLOSED', 'CANCELLED'] } }, orderBy: { createdAt: 'desc' }, select: { state: true } });

    const journey: PublicJourney = {
      who: s.user.fullName,
      status: statusFor(s.state, s.user.fullName, live ? s.checkInDueAt : null),
      expectedArrivalAt: live && s.checkInDueAt ? s.checkInDueAt.toISOString() : null,
      location: fix ? { latitude: fix.latitude, longitude: fix.longitude, accuracyM: fix.accuracyM, capturedAt: fix.capturedAt.toISOString() } : null,
      asOf: now.toISOString(),
      canRespond: Boolean(incident),
      responding: incident?.state === 'ACKNOWLEDGED',
    };
    return { kind: 'ok', journey, sessionId: s.id };
  }

  /**
   * "I'm responding" / "I can't help after all" through the link. Only while an alert is active. Recorded as someone holding the link
   * (the link does not say who), and it halts or resumes the escalation like any other acknowledgement.
   */
  async respond(token: string, pin: string | undefined, kind: 'respond' | 'unrespond', now: Date = new Date()): Promise<LinkLookup> {
    const found = await this.lookup(token, pin, now);
    if (found.kind !== 'ok') return found;
    const incident = await this.prisma.emergencyIncident.findFirst({ where: { sessionId: found.sessionId, state: { notIn: ['CLOSED', 'CANCELLED'] } }, orderBy: { createdAt: 'desc' }, select: { id: true } });
    if (incident) {
      if (kind === 'respond') await this.incidents.apply(incident.id, 'ACK_RECEIVED', 'contact', 'ACK_VIA_LINK', {}, now);
      else {
        const r = await this.incidents.apply(incident.id, 'UNACK_RECEIVED', 'contact', 'UNACK_VIA_LINK', {}, now);
        if (r.applied) await this.incidents.recompute(incident.id, now);
      }
    }
    return this.lookup(token, pin, now);
  }
}
