import type { ConsentStatus, ContactView } from './trusted-contacts.service';

/**
 * Who may be alerted (docs/specs/TRUSTED_CONTACTS.md). This is the ONLY route by which
 * a later milestone (incidents 1.8, escalation 1.9) obtains recipients, so "a
 * non-consented contact is never alerted" is decided in one place, not re-derived by
 * each caller.
 *
 * A contact is eligible only with a live consent record AND a status of "agreed".
 * Every other contact is SKIPPED WITH A REASON — never dropped silently — because the
 * person whose emergency it is must be able to see who was not contacted and why.
 */

export type SkipReason = 'NOT_INVITED' | 'AWAITING_CONSENT' | 'INVITE_EXPIRED' | 'WITHDRAWN' | 'DETAILS_CHANGED';

export interface SkippedContact {
  readonly contactId: string;
  readonly name: string;
  readonly reason: SkipReason;
}

export interface Recipients {
  readonly eligible: readonly ContactView[];
  readonly skipped: readonly SkippedContact[];
}

const REASON: Record<Exclude<ConsentStatus, 'agreed'>, SkipReason> = {
  not_invited: 'NOT_INVITED',
  waiting: 'AWAITING_CONSENT',
  expired: 'INVITE_EXPIRED',
  withdrawn: 'WITHDRAWN',
  details_changed: 'DETAILS_CHANGED',
};

export function resolveRecipients(contacts: readonly ContactView[]): Recipients {
  const eligible: ContactView[] = [];
  const skipped: SkippedContact[] = [];
  for (const c of contacts) {
    if (c.consented && c.consentStatus === 'agreed') {
      eligible.push(c);
    } else {
      // A contact whose two signals disagree is not trusted to be eligible.
      const reason = c.consentStatus === 'agreed' ? 'WITHDRAWN' : REASON[c.consentStatus];
      skipped.push({ contactId: c.id, name: c.name, reason });
    }
  }
  return { eligible, skipped };
}
