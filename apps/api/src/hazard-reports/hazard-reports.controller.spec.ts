import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HazardReportsController } from './hazard-reports.controller';
import { CreateHazardReportDto } from './dto/create-hazard-report.dto';

describe('HazardReportsController', () => {
  let controller: HazardReportsController;
  let service: any;

  beforeEach(() => {
    service = { findAll: vi.fn(), create: vi.fn(), confirm: vi.fn() };
    controller = new HazardReportsController(service);
  });

  it('passes the page size through to findAll', async () => {
    service.findAll.mockResolvedValue([]);

    await controller.findAll(25);

    expect(service.findAll).toHaveBeenCalledWith({ take: 25 });
  });

  it('forwards the submitted coordinates unchanged and does not generate a position', async () => {
    const req = { user: { id: 'user-123' } };
    const body: CreateHazardReportDto = {
      type: 'POOR_LIGHTING' as any,
      description: 'Streetlight out',
      latitude: 51.5074,
      longitude: -0.1278,
      accuracyMetres: 9,
    };
    service.create.mockResolvedValue({ id: 'report-1' });

    const result = await controller.create(req, body);

    expect(result).toEqual({ id: 'report-1' });
    expect(service.create).toHaveBeenCalledWith(body, 'user-123');
  });

  it('confirms on behalf of the authenticated user, not a user id from the body', async () => {
    const req = { user: { id: 'user-123' } };
    service.confirm.mockResolvedValue({ id: 'report-1', confirmationCount: 2 });

    const result = await controller.confirm(req, 'report-1');

    expect(result).toEqual({ id: 'report-1', confirmationCount: 2 });
    expect(service.confirm).toHaveBeenCalledWith('report-1', 'user-123');
  });
});
