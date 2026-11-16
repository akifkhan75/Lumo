import type { PublicInvite } from './contact-consent.service';

/**
 * The page a contact sees (docs/specs/TRUSTED_CONTACTS.md). Stopgap for the web app of
 * milestone 1.11. No scripts, no external requests, no analytics: the URL carries a
 * secret, so nothing on the page may be able to send it elsewhere.
 *
 * It shows the inviter's NAME and nothing else about them — no phone, email or medical
 * data — and says what is NOT happening yet, because an honest "yes" needs the facts.
 */

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const layout = (body: string): string => `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="referrer" content="no-referrer">
<title>Lumo emergency contact</title>
<style>
body{font:18px/1.5 system-ui,sans-serif;max-width:34rem;margin:0 auto;padding:1.25rem;color:#111827;background:#fff}
h1{font-size:1.5rem;line-height:1.25}
button{font:inherit;font-weight:700;min-height:48px;padding:.5rem 1.5rem;border:0;border-radius:.5rem;background:#1e3a8a;color:#fff;cursor:pointer}
button.quiet{background:#fff;color:#7f1d1d;border:2px solid #7f1d1d}
.note{background:#f3f4f6;padding:.75rem 1rem;border-radius:.5rem}
</style></head><body>${body}</body></html>`;

export function consentPage(invite: PublicInvite, action: string): string {
  if (invite.state === 'invalid') {
    return layout(`<h1>This link isn't valid</h1>
<p>It may have expired or been replaced. Ask the person who sent it for a new one.</p>`);
  }
  const who = esc(invite.inviterName);

  if (invite.state === 'pending') {
    return layout(`<h1>${who} asked you to be an emergency contact</h1>
<p>If you agree, Lumo may send you a message if ${who} sets off an emergency alert in the Lumo app, with where they are.</p>
<p class="note"><strong>Not happening yet:</strong> Lumo does not send alerts to contacts today. Agreeing only records that you are willing. You will not be contacted until that exists, and you can withdraw at any time using this same link.</p>
<form method="post" action="${esc(action)}/accept"><button type="submit">I agree to be ${who}'s emergency contact</button></form>
<p>If you do not know ${who}, or do not want this, close this page. Nothing happens.</p>`);
  }

  if (invite.state === 'agreed') {
    return layout(`<h1>You agreed to be ${who}'s emergency contact</h1>
<p>You can stop at any time. It takes effect immediately.</p>
<form method="post" action="${esc(action)}/revoke"><button class="quiet" type="submit">Stop being ${who}'s emergency contact</button></form>`);
  }

  return layout(`<h1>You are no longer ${who}'s emergency contact</h1>
<p>You withdrew your agreement. ${who} will see this in their Lumo app. If you change your mind, ask them for a new link.</p>`);
}
