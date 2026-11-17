import type { JourneyLinkInfo } from '@lumo/types';
import { clock } from './journeyCopy';

/**
 * Sharing a journey (docs/engineering/WEB.md, invariant 4). Pure: no clock, no I/O, no environment.
 *
 * Two rules shape every line here:
 *  - LUMO SENDS NOTHING. The person passes the link on themselves, so we never say it "was sent" or that anyone "has" it; we say a link
 *    exists, and the only evidence of anyone looking is the server's own count of opens.
 *  - AS LONG AS A LINK IS LIVE, THE PERSON IS TOLD, in words, on their own device, with a way to stop it. The indicator is derived from
 *    the server's list of live links, never from what this screen remembers having done.
 */

/**
 * The address of the web app, or null when it is missing or unusable. A link is only worth making if someone can open it, so a build
 * with no web address cannot make one. Only https is accepted, except plain http when `allowInsecure` (a local dev build).
 */
export function webBaseUrl(raw: string | undefined | null, allowInsecure = false): string | null {
  const value = (raw ?? '').trim().replace(/\/+$/, '');
  if (!value) return null;
  if (/^https:\/\/[^/\s]+/i.test(value)) return value;
  if (allowInsecure && /^http:\/\/[^/\s]+/i.test(value)) return value;
  return null;
}

/** The full link, from the web address and the `/j/<token>` path the API returned. Null if either is not usable. */
export function shareUrl(base: string | null, path: string): string | null {
  if (!base || !/^\/j\/[A-Za-z0-9_-]{16,}$/.test(path)) return null;
  return `${base}${path}`;
}

/** The text handed to the share sheet. It never contains the PIN: that goes separately, so the link alone is not enough. */
export function shareMessage(url: string, who: string | null, hasPin: boolean): string {
  const lead = who ? `${who} is sharing a journey with you using Lumo.` : 'Follow my journey with Lumo.';
  return `${lead} Open this link to see where they are and when they should arrive: ${url}${hasPin ? '\n\nIt has a PIN. They will give it to you separately.' : ''}`;
}

export const liveLinks = (links: readonly JourneyLinkInfo[] | null | undefined): JourneyLinkInfo[] => (links ?? []).filter(l => l.live);

/** One line for the indicator, in the person's terms. Empty when nothing is live. */
export function indicatorTitle(live: readonly JourneyLinkInfo[]): string {
  if (live.length === 0) return '';
  return live.length === 1 ? 'Anyone with 1 link can see this journey right now' : `Anyone with these ${live.length} links can see this journey right now`;
}

/** What one link has actually done, from the server's count. Never "sent" and never "seen by" a name: a link does not say who opened it. */
export function linkLine(l: JourneyLinkInfo): string {
  const opened = l.viewCount === 0 ? 'Not opened yet' : l.viewCount === 1 ? 'Opened once' : `Opened ${l.viewCount} times`;
  const last = l.lastViewedAt ? `, last at ${clock(new Date(l.lastViewedAt).getTime())}` : '';
  const pin = l.hasPin ? ' · PIN' : '';
  return `${opened}${last}${pin} · stops working at ${clock(new Date(l.expiresAt).getTime())}`;
}

/** What the page will show, so the person knows what they are handing over. */
export function whatTheyWillSee(shareLocation: boolean): string {
  return shareLocation
    ? 'They will see your name, how the journey is going, when you should arrive, and your last saved position with how old it is. Nothing else: no history, no contacts, no health details.'
    : 'You chose not to save your position, so they will see your name, how the journey is going and when you should arrive, but no position.';
}

/** The honest result of making a link: it exists. Not that it was sent, and not that anyone has opened it. */
export const createdNotice = 'Link made. Lumo has not sent it to anyone: you do that. To turn it off, stop sharing below.';
export const cannotShareNoWebAddress = 'This build of Lumo has no web address set, so it cannot make a link anyone can open.';
export const mayShareAgainNote = 'A link can only be shown once. To share again, make a new one.';
export const couldNotHandOver = "Couldn't make a link that can be opened, so nothing is being shared. Try again.";
