import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException, HttpStatus } from '@nestjs/common';
import { AllExceptionsFilter, loggablePath } from './all-exceptions.filter';

function makeHost(method = 'GET', url = '/api/v1/settings') {
  const json = vi.fn();
  const status = vi.fn(() => ({ json }));
  return {
    host: {
      switchToHttp: () => ({
        getResponse: () => ({ status }),
        getRequest: () => ({ method, url }),
      }),
    } as any,
    status,
    json,
  };
}

describe('AllExceptionsFilter', () => {
  let filter: AllExceptionsFilter;

  beforeEach(() => {
    filter = new AllExceptionsFilter();
    // The filter logs deliberately; silence it so the suite output stays readable.
    vi.spyOn(filter['logger'], 'error').mockImplementation(() => undefined);
    vi.spyOn(filter['logger'], 'warn').mockImplementation(() => undefined);
  });

  it('never returns internals for an unexpected error', () => {
    const { host, status, json } = makeHost('POST', '/api/v1/settings');
    filter.catch(new Error('connect ECONNREFUSED 10.0.0.4:5432'), host);

    expect(status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    const body = json.mock.calls[0][0];
    expect(body.message).toBe('Internal server error');
    expect(JSON.stringify(body)).not.toContain('ECONNREFUSED');
    expect(JSON.stringify(body)).not.toContain('10.0.0.4');
  });

  it('attaches a reference a user can quote and a log line can be found by', () => {
    const { host, json } = makeHost();
    filter.catch(new Error('boom'), host);
    expect(json.mock.calls[0][0].reference).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('preserves validation detail, which is the callers own problem', () => {
    const { host, status, json } = makeHost('PUT', '/api/v1/settings');
    filter.catch(new BadRequestException(['phone must be a plausible phone number']), host);

    expect(status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    expect(json.mock.calls[0][0].message).toEqual(['phone must be a plausible phone number']);
  });

  it('logs a client error as a warning and a server error as an error', () => {
    const { host } = makeHost();
    filter.catch(new BadRequestException('nope'), host);
    expect(filter['logger'].warn).toHaveBeenCalled();
    expect(filter['logger'].error).not.toHaveBeenCalled();

    filter.catch(new Error('boom'), makeHost().host);
    expect(filter['logger'].error).toHaveBeenCalled();
  });
});

describe('loggablePath — a URL can carry a secret', () => {
  const TOKEN = 'Zm9vYmFyYmF6cXV4MTIzNDU2Nzg5MGFiY2RlZmdoaWo';

  it('logs the route template when the router matched one, never the token', () => {
    const req: any = { url: `/api/v1/contacts/invites/${TOKEN}`, route: { path: '/api/v1/contacts/invites/:token' } };
    expect(loggablePath(req)).toBe('/api/v1/contacts/invites/:token');
  });

  it('with no matched route, drops the query and masks any long opaque segment', () => {
    const req: any = { url: `/api/v1/contacts/invites/${TOKEN}/accept?x=${TOKEN}` };
    const out = loggablePath(req);
    expect(out).toBe('/api/v1/contacts/invites/:redacted/accept');
    expect(out).not.toContain(TOKEN);
  });

  it('leaves ordinary paths readable', () => {
    expect(loggablePath({ url: '/api/v1/settings' } as any)).toBe('/api/v1/settings');
  });

  it('the filter’s own log line carries no token', () => {
    const logs: string[] = [];
    const filter = new AllExceptionsFilter();
    vi.spyOn(filter['logger'], 'error').mockImplementation((m: any) => { logs.push(String(m)); });
    const { host } = makeHost('POST', `/api/v1/contacts/invites/${TOKEN}/accept`);
    filter.catch(new Error('boom'), host);
    expect(logs.join('\n')).not.toContain(TOKEN);
  });
});
