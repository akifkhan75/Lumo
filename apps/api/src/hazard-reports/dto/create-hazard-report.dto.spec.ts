import { describe, it, expect } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CreateHazardReportDto } from './create-hazard-report.dto';

const validate = (payload: Record<string, unknown>) =>
  validateSync(plainToInstance(CreateHazardReportDto, payload))
    .flatMap(error => Object.keys(error.constraints ?? {}).map(() => error.property));

const base = {
  type: 'POOR_LIGHTING',
  description: 'Streetlight out on the footbridge',
  latitude: 51.5074,
  longitude: -0.1278,
};

describe('CreateHazardReportDto', () => {
  it('accepts a well-formed report', () => {
    expect(validate(base)).toEqual([]);
  });

  it('accepts an omitted accuracy', () => {
    expect(validate({ ...base, accuracyMetres: undefined })).toEqual([]);
  });

  it('requires coordinates — a report with no position is not a report', () => {
    expect(validate({ type: 'OTHER', description: 'something' })).toEqual(
      expect.arrayContaining(['latitude', 'longitude']),
    );
  });

  it('rejects coordinates outside the valid range', () => {
    expect(validate({ ...base, latitude: 120 })).toContain('latitude');
    expect(validate({ ...base, longitude: 200 })).toContain('longitude');
  });

  it('rejects an unknown hazard type', () => {
    expect(validate({ ...base, type: 'Suspicious Activity' })).toContain('type');
  });

  it('rejects a severity field outright — there is no severity', () => {
    // Asserted through the same pipe options main.ts uses, so this covers what
    // a real request meets rather than the DTO in isolation.
    const errors = validateSync(
      plainToInstance(CreateHazardReportDto, { ...base, severity: 'high' }),
      { whitelist: true, forbidNonWhitelisted: true },
    );

    expect(errors.map(error => error.property)).toContain('severity');
  });

  it('rejects a description carrying a phone number', () => {
    expect(validate({ ...base, description: 'Call me on +44 7700 900123' })).toContain(
      'description',
    );
  });

  it('rejects a description carrying an email address', () => {
    expect(validate({ ...base, description: 'Contact bob@example.com about it' })).toContain(
      'description',
    );
  });

  it('rejects a description carrying a link', () => {
    expect(validate({ ...base, description: 'See https://example.com/thread' })).toContain(
      'description',
    );
    expect(validate({ ...base, description: 'See www.example.com' })).toContain(
      'description',
    );
  });

  it('rejects a description longer than the limit', () => {
    expect(validate({ ...base, description: 'x'.repeat(281) })).toContain('description');
  });

  it('rejects an empty description', () => {
    expect(validate({ ...base, description: '' })).toContain('description');
  });

  it('rejects an absurd accuracy figure', () => {
    expect(validate({ ...base, accuracyMetres: 50_000 })).toContain('accuracyMetres');
    expect(validate({ ...base, accuracyMetres: -1 })).toContain('accuracyMetres');
  });
});
