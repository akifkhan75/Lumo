import { describe, it, expect } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { SafetyChatDto } from './safety-chat.dto';

const validate = (payload: Record<string, unknown>) =>
  validateSync(plainToInstance(SafetyChatDto, payload), {
    whitelist: true,
    forbidNonWhitelisted: true,
  }).map(error => error.property);

describe('SafetyChatDto', () => {
  it('accepts a message with no history', () => {
    expect(validate({ message: 'Is this street safe to walk down?' })).toEqual([]);
  });

  it('accepts a well-formed history', () => {
    expect(
      validate({
        message: 'And now?',
        history: [{ role: 'user', parts: [{ text: 'Earlier question' }] }],
      }),
    ).toEqual([]);
  });

  it('requires a message', () => {
    expect(validate({})).toContain('message');
    expect(validate({ message: '' })).toContain('message');
  });

  it('bounds the message length — it is billed per token', () => {
    expect(validate({ message: 'x'.repeat(2001) })).toContain('message');
  });

  it('bounds the history depth', () => {
    const history = Array.from({ length: 21 }, () => ({
      role: 'user',
      parts: [{ text: 'hi' }],
    }));
    expect(validate({ message: 'hello', history })).toContain('history');
  });

  it('rejects an unknown role', () => {
    expect(
      validate({ message: 'hello', history: [{ role: 'system', parts: [{ text: 'x' }] }] }),
    ).toContain('history');
  });

  it('rejects a history entry that is not shaped like a turn', () => {
    expect(validate({ message: 'hello', history: ['not an object'] })).toContain('history');
  });

  it('rejects unknown top-level properties', () => {
    expect(validate({ message: 'hello', model: 'gpt-4' })).toContain('model');
  });
});
