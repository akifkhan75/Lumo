import { CHANNELS, CHANNEL_CAPABILITIES } from '@lumo/safety-domain';
import { CHECKLIST_ITEMS, TIERS, type RegionProfile } from './types';

/**
 * When is a profile fit to be enabled? (docs/specs/REGION_PROFILES.md §6, ADR-0011)
 *
 * Two questions, kept separate on purpose:
 * - COMPLETENESS: is the profile structurally whole and internally consistent?
 * - ENABLEMENT: complete, AND approved by the people who must approve it.
 *
 * A profile can be complete and still not enablable (a finished draft awaiting
 * counsel). It can never be enablable while incomplete.
 */

export type ProfileIssueCode =
  | 'ID_INVALID'
  | 'NAME_MISSING'
  | 'NO_EMERGENCY_NUMBERS'
  | 'EMERGENCY_NUMBER_INVALID'
  | 'EMERGENCY_LABEL_MISSING'
  | 'SUBNATIONAL_NO_REGIONS'
  | 'NATIONAL_HAS_REGIONS'
  | 'AUTO_DIAL_FORBIDDEN'
  | 'DISPATCH_CLAIM_NO_AGREEMENT'
  | 'NO_CHANNELS'
  | 'UNKNOWN_CHANNEL'
  | 'NO_EMERGENCY_CHANNEL'
  | 'SMS_PROVIDER_MISSING'
  | 'VOICE_PROVIDER_MISSING'
  | 'PROVIDER_NOT_CONTRACTED'
  | 'DEVICE_SMS_NOT_ALLOWED'
  | 'REGISTRATION_INCOMPLETE'
  | 'OVERRIDES_MISSING'
  | 'PRIVACY_REGIMES_MISSING'
  | 'RETENTION_INVALID'
  | 'ERASURE_SLA_INVALID'
  | 'MINOR_AGE_MISSING'
  | 'LANGUAGES_MISSING'
  | 'DEFAULT_LANGUAGE_NOT_LISTED'
  | 'CURRENCY_INVALID'
  | 'PRICE_INVALID'
  | 'CHECKLIST_MALFORMED'
  | 'NOT_APPROVED'
  | 'LEGAL_REVIEW_PENDING'
  | 'REVIEWER_MISSING'
  | 'CHECKLIST_INCOMPLETE';

export interface ProfileIssue {
  readonly code: ProfileIssueCode;
  readonly path: string;
  readonly message: string;
}

const isBlank = (s: string | undefined | null) => s === undefined || s === null || s.trim() === '';

export function completenessIssues(p: RegionProfile): ProfileIssue[] {
  const issues: ProfileIssue[] = [];
  const add = (code: ProfileIssueCode, path: string, message: string) => issues.push({ code, path, message });

  if (!/^[A-Z]{2}$/.test(p.id)) add('ID_INVALID', 'id', 'Must be an ISO 3166-1 alpha-2 country code, e.g. "PK"');
  if (isBlank(p.displayName)) add('NAME_MISSING', 'displayName', 'A profile needs a display name');

  // --- emergency
  if (p.emergency.numbers.length === 0) {
    add('NO_EMERGENCY_NUMBERS', 'emergency.numbers', 'A market with no emergency number is not a market');
  }
  p.emergency.numbers.forEach((n, i) => {
    const at = `emergency.numbers[${i}]`;
    if (!/^\d{2,6}$/.test(n.number)) add('EMERGENCY_NUMBER_INVALID', `${at}.number`, `"${n.number}" is not a dialable emergency number`);
    if (isBlank(n.label)) add('EMERGENCY_LABEL_MISSING', `${at}.label`, 'A number needs a label so the user knows who they are calling');
    if (n.scope === 'subnational' && (n.regions ?? []).length === 0) {
      add('SUBNATIONAL_NO_REGIONS', `${at}.regions`, 'A subnational number must say where it works');
    }
    if (n.scope === 'national' && (n.regions ?? []).length > 0) {
      add('NATIONAL_HAS_REGIONS', `${at}.regions`, 'A national number must not be restricted to regions');
    }
  });
  // RES-9: Lumo never dials an emergency number on its own, under any configuration.
  if (p.emergency.dialPolicy !== 'user-initiated-only') {
    add('AUTO_DIAL_FORBIDDEN', 'emergency.dialPolicy', 'Automatic dialling of emergency services is not permitted in any market');
  }
  if (p.emergency.canClaimDispatch && isBlank(p.emergency.dispatchPartner?.agreementRef)) {
    add('DISPATCH_CLAIM_NO_AGREEMENT', 'emergency.canClaimDispatch', 'Claiming dispatch requires a signed agreement, referenced in dispatchPartner.agreementRef');
  }

  // --- messaging
  const channels = p.messaging.channels;
  if (channels.length === 0) {
    add('NO_CHANNELS', 'messaging.channels', 'At least one channel is required');
  } else {
    const unknown = channels.filter((c) => !CHANNELS.includes(c));
    if (unknown.length > 0) add('UNKNOWN_CHANNEL', 'messaging.channels', `Unknown channel: ${unknown.join(', ')}`);
    const known = channels.filter((c) => CHANNELS.includes(c));
    if (known.length > 0 && !known.some((c) => CHANNEL_CAPABILITIES[c].isEmergencyGrade)) {
      add('NO_EMERGENCY_CHANNEL', 'messaging.channels', 'At least one emergency-grade channel is required; email alone is not');
    }
  }
  const needProvider = (channel: 'sms' | 'voice', ref: RegionProfile['messaging']['smsProvider'], missing: ProfileIssueCode) => {
    if (!channels.includes(channel)) return;
    if (ref === null) add(missing, `messaging.${channel}Provider`, `The ${channel} channel is listed but no provider is set`);
    else if (!ref.contracted) add('PROVIDER_NOT_CONTRACTED', `messaging.${channel}Provider`, `Provider "${ref.id}" is named but not contracted`);
  };
  needProvider('sms', p.messaging.smsProvider, 'SMS_PROVIDER_MISSING');
  needProvider('voice', p.messaging.voiceProvider, 'VOICE_PROVIDER_MISSING');
  if (channels.includes('device_direct_sms') && !p.messaging.deviceDirectSmsAllowed) {
    add('DEVICE_SMS_NOT_ALLOWED', 'messaging.deviceDirectSmsAllowed', 'device_direct_sms is listed but device-direct SMS is not allowed');
  }
  // e.g. US A2P 10DLC: nothing may be sent before brand and campaign are registered.
  if (!isBlank(p.messaging.registrationRequired) && p.messaging.registrationComplete !== true) {
    add('REGISTRATION_INCOMPLETE', 'messaging.registrationComplete', `${p.messaging.registrationRequired} registration is required and not complete`);
  }

  // --- recording
  if (p.recording.audioConsent === 'varies-subnational' && Object.keys(p.recording.subnationalOverrides ?? {}).length === 0) {
    add('OVERRIDES_MISSING', 'recording.subnationalOverrides', 'audioConsent varies by subdivision but no subdivision is listed');
  }

  // --- privacy
  if (p.privacy.regimes.length === 0) add('PRIVACY_REGIMES_MISSING', 'privacy.regimes', 'Name the privacy regimes that apply');
  for (const [key, value] of Object.entries(p.privacy.retention)) {
    if (!(value > 0)) add('RETENTION_INVALID', `privacy.retention.${key}`, 'Retention must be greater than zero');
  }
  if (!(p.privacy.erasureSlaDays > 0)) add('ERASURE_SLA_INVALID', 'privacy.erasureSlaDays', 'The erasure SLA must be greater than zero');
  if (p.privacy.minorConsentAge === undefined || !Number.isInteger(p.privacy.minorConsentAge) || p.privacy.minorConsentAge < 1) {
    add('MINOR_AGE_MISSING', 'privacy.minorConsentAge', 'The age of consent for minors must be defined');
  }

  // --- locale and commerce
  if (p.locale.languages.length === 0) add('LANGUAGES_MISSING', 'locale.languages', 'At least one language is required');
  else if (!p.locale.languages.includes(p.locale.default)) {
    add('DEFAULT_LANGUAGE_NOT_LISTED', 'locale.default', 'The default language must be one of the listed languages');
  }
  if (!/^[A-Z]{3}$/.test(p.commerce.currency)) add('CURRENCY_INVALID', 'commerce.currency', 'Must be an ISO 4217 code, e.g. "PKR"');
  for (const tier of TIERS) {
    if (!(p.commerce.pricePoints[tier] > 0)) add('PRICE_INVALID', `commerce.pricePoints.${tier}`, 'A price must be greater than zero');
  }

  // --- checklist shape
  for (const item of CHECKLIST_ITEMS) {
    const v = p.checklist[item];
    const ok = v === true || v === false || (v === 'not-applicable' && item === 'rtlVerified' && !p.locale.rtl);
    if (!ok) add('CHECKLIST_MALFORMED', `checklist.${item}`, `"${String(v)}" is not valid here; 'not-applicable' is allowed only for rtlVerified in a left-to-right market`);
  }

  return issues;
}

/** Complete AND approved: the gate that decides whether a market may be switched on. */
export function enablementIssues(p: RegionProfile): ProfileIssue[] {
  const issues = completenessIssues(p);
  const add = (code: ProfileIssueCode, path: string, message: string) => issues.push({ code, path, message });

  if (p.status !== 'approved') add('NOT_APPROVED', 'status', `Status is "${p.status}"; only "approved" may be enabled`);
  // A pending legal review blocks enablement whatever else is true.
  if (p.legalReviewStatus !== 'approved') add('LEGAL_REVIEW_PENDING', 'legalReviewStatus', 'Legal review has not approved this market');
  if (isBlank(p.legalReviewedBy) || isBlank(p.legalReviewedAt)) {
    add('REVIEWER_MISSING', 'legalReviewedBy', 'An approval must name who reviewed it and when');
  }
  const undone = CHECKLIST_ITEMS.filter((item) => p.checklist[item] === false);
  if (undone.length > 0) add('CHECKLIST_INCOMPLETE', 'checklist', `Not done: ${undone.join(', ')}`);

  return issues;
}
