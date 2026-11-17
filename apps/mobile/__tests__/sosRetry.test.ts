import { ApiError } from '@lumo/api-client';
import { classifyFailure, retryDelayMs } from '../services/sosRetry';

describe('when to try again', () => {
  it('backs off quickly at first and never slower than 30 s', () => {
    expect([0, 1, 2, 3, 4, 5, 50].map(retryDelayMs)).toEqual([2000, 4000, 8000, 16000, 30000, 30000, 30000]);
    expect(retryDelayMs(-3)).toBe(2000);
  });

  it('keeps trying when Lumo cannot be reached or fails', () => {
    expect(classifyFailure(new ApiError('x', 'network'))).toBe('retry');
    expect(classifyFailure(new ApiError('x', 'timeout'))).toBe('retry');
    expect(classifyFailure(new ApiError('x', 'http', 503))).toBe('retry');
    expect(classifyFailure(new ApiError('x', 'http', 500))).toBe('retry');
    expect(classifyFailure(new ApiError('x', 'http', 429))).toBe('retry');
    expect(classifyFailure(new ApiError('x', 'http', 408))).toBe('retry');
    expect(classifyFailure(new Error('weird'))).toBe('retry'); // unknown is not "refused": it must not stop trying
  });

  it('stops, and says so, when the answer cannot change', () => {
    expect(classifyFailure(new ApiError('x', 'http', 400, true))).toBe('tooLate');
    expect(classifyFailure(new ApiError('x', 'http', 401))).toBe('signedOut');
    expect(classifyFailure(new ApiError('x', 'http', 403))).toBe('signedOut');
    expect(classifyFailure(new ApiError('x', 'http', 409))).toBe('refused');
    expect(classifyFailure(new ApiError('x', 'http', 400))).toBe('refused');
  });
});
