import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException, HttpStatus } from '@nestjs/common';
import { AllExceptionsFilter } from './all-exceptions.filter';

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
