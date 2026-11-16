import type { ConsentStatus } from '@lumo/types';

/**
 * What the app says about a contact's consent (docs/specs/TRUSTED_CONTACTS.md).
 * "Agreed" records that the contact is willing. It does NOT say they would be alerted:
 * no alert path exists yet, so no copy here may promise one.
 */
export interface ConsentLabel {
  readonly text: string;
  /** What the user can do about it, or null. */
  readonly action: string | null;
}

export const CONSENT_LABEL: Record<ConsentStatus, ConsentLabel> = {
  not_invited: { text: 'Not asked yet. They have not been contacted.', action: 'Get a link to ask them' },
  waiting: { text: 'Waiting for them to agree.', action: 'Get a new link' },
  agreed: { text: 'Agreed. (Lumo does not send alerts to contacts yet.)', action: null },
  withdrawn: { text: 'Withdrew their agreement.', action: 'Ask again' },
  expired: { text: 'The link ran out. They have not agreed.', action: 'Get a new link' },
  details_changed: { text: 'Their number or email changed, so they need to agree again.', action: 'Get a link to ask them' },
};

export const consentLabel = (status: ConsentStatus | undefined): ConsentLabel | null =>
  status ? CONSENT_LABEL[status] : null;

/** What the user sends along with the link. They send it; Lumo does not. */
export const inviteMessage = (fromName: string, url: string): string =>
  `${fromName} would like you to be an emergency contact on Lumo. ` +
  `Nothing has been sent to you by the app — this is a message from ${fromName}. ` +
  `To agree (or to read more first), open: ${url}`;
