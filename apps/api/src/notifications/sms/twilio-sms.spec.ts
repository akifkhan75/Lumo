import { describe, it, expect, vi } from 'vitest';
import { getTwilioConfig, statusCallbackUrl, TwilioSms, SMS_VALIDITY_SECONDS, type TwilioConfig } from './twilio-sms';

const CONFIG: TwilioConfig = { accountSid: 'AC1', authToken: 't', messagingServiceSid: 'MG1', publicApiUrl: 'https://api.lumo.test' };

describe('getTwilioConfig', () => {
  const full = { TWILIO_ACCOUNT_SID: 'AC1', TWILIO_AUTH_TOKEN: 't', TWILIO_MESSAGING_SERVICE_SID: 'MG1', PUBLIC_API_URL: 'https://api.lumo.test/' };
  it('reads a complete configuration and trims the trailing slash', () => {
    expect(getTwilioConfig(full)).toMatchObject({ accountSid: 'AC1', publicApiUrl: 'https://api.lumo.test' });
  });
  it.each(['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'PUBLIC_API_URL'])('is null without %s', (k) => {
    expect(getTwilioConfig({ ...full, [k]: '' })).toBeNull();
  });
  it('needs a sender: a messaging service or a from number', () => {
    expect(getTwilioConfig({ ...full, TWILIO_MESSAGING_SERVICE_SID: '' })).toBeNull();
    expect(getTwilioConfig({ ...full, TWILIO_MESSAGING_SERVICE_SID: '', TWILIO_FROM: '+15005550006' })).toMatchObject({ from: '+15005550006' });
  });
  it('is null with nothing set, so the provider is "not configured"', () => {
    expect(getTwilioConfig({})).toBeNull();
  });
});

describe('TwilioSms', () => {
  const make = (create: (p: Record<string, unknown>) => Promise<{ sid: string; status: string }>, config: TwilioConfig | null = CONFIG) =>
    new TwilioSms(config, () => ({ messages: { create } }));

  it('is not configured without credentials, and never reports accepted', async () => {
    const sms = new TwilioSms(null);
    expect(sms.configured()).toBe(false);
    expect(await sms.send({ to: '+1', body: 'x', attemptId: 'a' })).toEqual({ kind: 'rejected', reason: 'PROVIDER_NOT_CONFIGURED' });
  });

  it('sends with the signed status-callback URL and a validity period', async () => {
    const create = vi.fn().mockResolvedValue({ sid: 'SM1', status: 'queued' });
    const out = await make(create).send({ to: '+923001234567', body: 'hello', attemptId: 'att-1' });
    expect(out).toEqual({ kind: 'accepted', providerMessageId: 'SM1', status: 'queued' });
    expect(create).toHaveBeenCalledWith({
      to: '+923001234567', body: 'hello', messagingServiceSid: 'MG1',
      statusCallback: 'https://api.lumo.test/api/v1/webhooks/twilio/status?attempt=att-1',
      validityPeriod: SMS_VALIDITY_SECONDS,
    });
  });

  it('uses a from number when there is no messaging service', async () => {
    const create = vi.fn().mockResolvedValue({ sid: 'SM1', status: 'queued' });
    await make(create, { ...CONFIG, messagingServiceSid: undefined, from: '+15005550006' }).send({ to: '+1', body: 'x', attemptId: 'a' });
    expect(create.mock.calls[0][0]).toMatchObject({ from: '+15005550006' });
    expect(create.mock.calls[0][0]).not.toHaveProperty('messagingServiceSid');
  });

  it('an HTTP refusal is "rejected", with Twilio’s code when it gave one', async () => {
    expect(await make(() => Promise.reject({ status: 400, code: 21211, message: 'bad number +923001234567' })).send({ to: '+1', body: 'x', attemptId: 'a' }))
      .toEqual({ kind: 'rejected', reason: 'TWILIO_21211' });
    expect(await make(() => Promise.reject({ status: 503 })).send({ to: '+1', body: 'x', attemptId: 'a' })).toEqual({ kind: 'rejected', reason: 'HTTP_503' });
  });

  it('no answer at all is ambiguous: it may have gone', async () => {
    expect(await make(() => Promise.reject(new Error('socket hang up'))).send({ to: '+1', body: 'x', attemptId: 'a' })).toEqual({ kind: 'ambiguous' });
  });

  it('never carries the error text, which can contain the number', async () => {
    const out = await make(() => Promise.reject({ status: 400, code: 21211, message: 'The number +923001234567 is invalid' })).send({ to: '+1', body: 'x', attemptId: 'a' });
    expect(JSON.stringify(out)).not.toContain('923001234567');
  });
});

describe('statusCallbackUrl', () => {
  it('encodes the attempt id', () => {
    expect(statusCallbackUrl('https://x.test', 'a b')).toBe('https://x.test/api/v1/webhooks/twilio/status?attempt=a%20b');
  });
});
