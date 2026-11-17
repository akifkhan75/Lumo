import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ApiClient, ApiError } from './index';

const ok = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body });
const baseUrl = 'http://api.test';

describe('incidents and the emergency token', () => {
  let client: ApiClient;
  beforeEach(() => { client = new ApiClient(baseUrl, 'LOGIN-JWT'); });
  const call = () => (global.fetch as any).mock.calls[0] as [string, RequestInit];

  it('raiseSos sends the Idempotency-Key and the emergency token INSTEAD of the login when one is given', async () => {
    global.fetch = vi.fn().mockResolvedValue(ok({ id: 'i1', state: 'CREATED' }, 201)) as any;
    const out = await client.raiseSos('key-12345678', { triggerType: 'manual', triggeredAt: 'x' }, 'EMERGENCY-TOKEN');
    expect(out.incident.id).toBe('i1');
    const [url, init] = call();
    expect(url).toBe(`${baseUrl}/api/v1/sos`);
    expect((init.headers as any)['Idempotency-Key']).toBe('key-12345678');
    expect((init.headers as any).Authorization).toBe('Bearer EMERGENCY-TOKEN');
  });

  it('with no explicit bearer it uses the stored login; with null it sends none', async () => {
    global.fetch = vi.fn().mockResolvedValue(ok({ id: 'i1' })) as any;
    await client.getIncident('i1');
    expect(((call()[1].headers as any)).Authorization).toBe('Bearer LOGIN-JWT');
    global.fetch = vi.fn().mockResolvedValue(ok({ id: 'i1' })) as any;
    await client.getIncident('i1', null);
    expect((call()[1].headers as any).Authorization).toBeUndefined();
  });

  it('cancel and resolve are POSTs to the incident, with the id encoded', async () => {
    global.fetch = vi.fn().mockResolvedValue(ok({ id: 'a/b' })) as any;
    await client.cancelIncident('a/b', 'T');
    expect(call()[0]).toBe(`${baseUrl}/api/v1/incidents/a%2Fb/cancel`);
    global.fetch = vi.fn().mockResolvedValue(ok({ id: 'a' })) as any;
    await client.resolveIncident('a', 'T');
    expect(call()[0]).toBe(`${baseUrl}/api/v1/incidents/a/resolve`);
    expect(call()[1].method).toBe('POST');
  });

  it('a 409 on cancel arrives as an http ApiError a caller can recognise', async () => {
    global.fetch = vi.fn().mockResolvedValue(ok({ message: 'too late' }, 409)) as any;
    const err = await client.cancelIncident('a').catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ kind: 'http', status: 409 });
  });

  it('mintEmergencyToken posts the device key with the login', async () => {
    global.fetch = vi.fn().mockResolvedValue(ok({ id: 't', token: 'x', expiresAt: 'e' }, 201)) as any;
    await client.mintEmergencyToken('install-12345678');
    const [url, init] = call();
    expect(url).toBe(`${baseUrl}/api/v1/emergency-token`);
    expect(JSON.parse(init.body as string)).toEqual({ deviceKey: 'install-12345678' });
    expect((init.headers as any).Authorization).toBe('Bearer LOGIN-JWT');
  });
});
