import { describe, it, expect, vi } from 'vitest';
import { getTwilioVoiceConfig, TwilioVoice, twimlFor, voiceCallbackUrl, VOICE_RING_SECONDS, type TwilioVoiceConfig } from './twilio-voice';
import { alertBody, voiceScript } from '../message-templates';

const CONFIG: TwilioVoiceConfig = { accountSid: 'AC1', authToken: 't', from: '+15005550006', publicApiUrl: 'https://api.lumo.test' };

describe('getTwilioVoiceConfig', () => {
  const full = { TWILIO_ACCOUNT_SID: 'AC1', TWILIO_AUTH_TOKEN: 't', TWILIO_VOICE_FROM: '+15005550006', PUBLIC_API_URL: 'https://api.lumo.test/' };
  it('reads a complete configuration', () => expect(getTwilioVoiceConfig(full)).toMatchObject({ from: '+15005550006', publicApiUrl: 'https://api.lumo.test' }));
  it.each(['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_VOICE_FROM', 'PUBLIC_API_URL'])('is null without %s', (k) => {
    expect(getTwilioVoiceConfig({ ...full, [k]: '' })).toBeNull();
  });
  it('a messaging service SID is NOT enough: a call needs a caller number', () => {
    const { TWILIO_VOICE_FROM: _drop, ...rest } = full;
    expect(getTwilioVoiceConfig({ ...rest, TWILIO_MESSAGING_SERVICE_SID: 'MG1' })).toBeNull();
  });
});

describe('twimlFor', () => {
  it('XML-escapes the script, which carries a user-supplied name', () => {
    const xml = twimlFor(voiceScript(`Tom <&> "O'Neil"`));
    expect(xml).toContain('Tom &lt;&amp;&gt; &quot;O&apos;Neil&quot;');
    expect(xml).not.toMatch(/<&>|<Say>[^<]*<[^/S]/);
    expect(xml.startsWith('<Response><Say>')).toBe(true);
  });
  it('a name that tries to inject TwiML stays text', () => {
    const xml = twimlFor(voiceScript('</Say><Dial>+15551234567</Dial><Say>'));
    expect(xml).not.toContain('<Dial>');
  });
});

describe('the spoken and written copy', () => {
  it('names who asked, never says help is coming, and asks for no keypress (a call is not an acknowledgement)', () => {
    for (const text of [voiceScript('Joyce'), alertBody('Joyce')]) {
      expect(text).toContain('Joyce');
      expect(text.toLowerCase()).not.toMatch(/help is|on the way|press \d|press any/);
    }
  });
});

describe('TwilioVoice', () => {
  const make = (create: (p: Record<string, unknown>) => Promise<{ sid: string; status: string }>, config: TwilioVoiceConfig | null = CONFIG) =>
    new TwilioVoice(config, () => ({ calls: { create } }));

  it('is not configured without a caller number, and never reports accepted', async () => {
    const v = new TwilioVoice(null);
    expect(v.configured()).toBe(false);
    expect(await v.call({ to: '+1', script: 'x', attemptId: 'a' })).toEqual({ kind: 'rejected', reason: 'PROVIDER_NOT_CONFIGURED' });
  });

  it('places the call with the callback URL, a ring timeout, and answered+completed events', async () => {
    const create = vi.fn().mockResolvedValue({ sid: 'CA1', status: 'queued' });
    expect(await make(create).call({ to: '+923001234567', script: 'hello', attemptId: 'att-1' })).toEqual({ kind: 'accepted', providerMessageId: 'CA1', status: 'queued' });
    expect(create).toHaveBeenCalledWith({
      to: '+923001234567', from: '+15005550006', twiml: '<Response><Say>hello</Say></Response>',
      timeout: VOICE_RING_SECONDS, statusCallback: voiceCallbackUrl('https://api.lumo.test', 'att-1'), statusCallbackEvent: ['answered', 'completed'],
    });
  });

  it('an HTTP refusal is rejected; no answer is ambiguous; the error text is never kept', async () => {
    const refused = await make(() => Promise.reject({ status: 400, code: 21214, message: 'bad +923001234567' })).call({ to: '+1', script: 'x', attemptId: 'a' });
    expect(refused).toEqual({ kind: 'rejected', reason: 'TWILIO_21214' });
    expect(JSON.stringify(refused)).not.toContain('923001234567');
    expect(await make(() => Promise.reject({ status: 502 })).call({ to: '+1', script: 'x', attemptId: 'a' })).toEqual({ kind: 'rejected', reason: 'HTTP_502' });
    expect(await make(() => Promise.reject(new Error('reset'))).call({ to: '+1', script: 'x', attemptId: 'a' })).toEqual({ kind: 'ambiguous' });
  });
});
