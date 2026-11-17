import { describe, it, expect, vi } from 'vitest';
import { ExpoPush, EXPO_RECEIPTS_URL, EXPO_SEND_URL, getExpoConfig } from './expo-push';

const res = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const make = (fetchFn: (...a: any[]) => Promise<any>, config: { accessToken?: string } | null = {}) => new ExpoPush(config, fetchFn as any);
const send = (p: ExpoPush, tokens = ['ExponentPushToken[aaaaaaaa]', 'ExponentPushToken[bbbbbbbb]']) => p.send({ tokens, title: 'Lumo alert', body: 'Joyce asked Lumo to alert you.', attemptId: 'att-1' });

describe('getExpoConfig', () => {
  it('is off unless explicitly enabled, so a dev machine never pushes by accident', () => {
    expect(getExpoConfig({})).toBeNull();
    expect(getExpoConfig({ EXPO_PUSH_ENABLED: 'false' })).toBeNull();
    expect(getExpoConfig({ EXPO_PUSH_ENABLED: 'TRUE' })).toEqual({ accessToken: undefined });
    expect(getExpoConfig({ EXPO_PUSH_ENABLED: 'true', EXPO_ACCESS_TOKEN: ' tok ' })).toEqual({ accessToken: 'tok' });
  });
});

describe('ExpoPush.send', () => {
  it('is not configured without enablement, and never reports accepted', async () => {
    const p = new ExpoPush(null);
    expect(p.configured()).toBe(false);
    expect(await send(p)).toEqual({ kind: 'rejected', reason: 'PROVIDER_NOT_CONFIGURED', deadTokens: [] });
  });

  it('posts one message per token with ids only in data, and the access token when set', async () => {
    const f = vi.fn().mockResolvedValue(res(200, { data: [{ status: 'ok', id: 'T1' }, { status: 'ok', id: 'T2' }] }));
    const out = await send(make(f, { accessToken: 'secret' }));
    expect(out).toEqual({ kind: 'accepted', tickets: [{ token: 'ExponentPushToken[aaaaaaaa]', id: 'T1' }, { token: 'ExponentPushToken[bbbbbbbb]', id: 'T2' }], deadTokens: [] });
    const [url, init] = f.mock.calls[0];
    expect(url).toBe(EXPO_SEND_URL);
    expect(init.headers.Authorization).toBe('Bearer secret');
    const sent = JSON.parse(init.body);
    expect(sent).toHaveLength(2);
    expect(sent[0]).toMatchObject({ to: 'ExponentPushToken[aaaaaaaa]', title: 'Lumo alert', data: { attemptId: 'att-1' } });
    expect(Object.keys(sent[0].data)).toEqual(['attemptId']);
    expect(sent[0]).toMatchObject({ channelId: 'alerts', categoryId: 'lumo-alert' });
  });

  it('with no access token sends no Authorization header', async () => {
    const f = vi.fn().mockResolvedValue(res(200, { data: [{ status: 'ok', id: 'T1' }] }));
    await send(make(f, {}), ['ExponentPushToken[aaaaaaaa]']);
    expect(f.mock.calls[0][1].headers).not.toHaveProperty('Authorization');
  });

  it('one ticket ok and one DeviceNotRegistered: accepted, the dead token reported', async () => {
    const f = vi.fn().mockResolvedValue(res(200, { data: [{ status: 'error', details: { error: 'DeviceNotRegistered' } }, { status: 'ok', id: 'T2' }] }));
    expect(await send(make(f))).toEqual({ kind: 'accepted', tickets: [{ token: 'ExponentPushToken[bbbbbbbb]', id: 'T2' }], deadTokens: ['ExponentPushToken[aaaaaaaa]'] });
  });

  it('every ticket an error: rejected with the first reason', async () => {
    const f = vi.fn().mockResolvedValue(res(200, { data: [{ status: 'error', details: { error: 'MessageTooBig' } }, { status: 'error', details: { error: 'DeviceNotRegistered' } }] }));
    expect(await send(make(f))).toEqual({ kind: 'rejected', reason: 'EXPO_MessageTooBig', deadTokens: ['ExponentPushToken[bbbbbbbb]'] });
  });

  it('an HTTP error answer is a rejection', async () => {
    expect(await send(make(vi.fn().mockResolvedValue(res(429, { errors: [] }))))).toEqual({ kind: 'rejected', reason: 'HTTP_429', deadTokens: [] });
  });

  it('no answer, or a 200 we cannot read, is ambiguous: it may have gone', async () => {
    expect(await send(make(vi.fn().mockRejectedValue(new Error('reset'))))).toEqual({ kind: 'ambiguous' });
    expect(await send(make(vi.fn().mockResolvedValue(res(200, { nonsense: true }))))).toEqual({ kind: 'ambiguous' });
    expect(await send(make(vi.fn().mockResolvedValue(res(200, { data: [{ status: 'ok', id: 'T1' }] }))))).toEqual({ kind: 'ambiguous' }); // 1 ticket for 2 tokens
  });
});

describe('ExpoPush.receipts', () => {
  it('maps ok and error receipts, and omits ids with none yet', async () => {
    const f = vi.fn().mockResolvedValue(res(200, { data: { A: { status: 'ok' }, B: { status: 'error', details: { error: 'DeviceNotRegistered' } } } }));
    const out = await make(f).receipts(['A', 'B', 'C']);
    expect(out).toEqual(new Map([['A', { status: 'ok' }], ['B', { status: 'error', error: 'DeviceNotRegistered' }]]));
    expect(f.mock.calls[0][0]).toBe(EXPO_RECEIPTS_URL);
    expect(JSON.parse(f.mock.calls[0][1].body)).toEqual({ ids: ['A', 'B', 'C'] });
  });
  it('null when unavailable, unreadable, unconfigured or asked about nothing', async () => {
    expect(await make(vi.fn().mockRejectedValue(new Error('x'))).receipts(['A'])).toBeNull();
    expect(await make(vi.fn().mockResolvedValue(res(500, {}))).receipts(['A'])).toBeNull();
    expect(await make(vi.fn().mockResolvedValue(res(200, { data: 'no' }))).receipts(['A'])).toBeNull();
    expect(await new ExpoPush(null).receipts(['A'])).toBeNull();
    expect(await make(vi.fn()).receipts([])).toBeNull();
  });
});
