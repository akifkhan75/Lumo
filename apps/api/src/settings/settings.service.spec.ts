import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SettingsService } from './settings.service';
import { NotFoundException } from '@nestjs/common';

describe('SettingsService', () => {
  let service: SettingsService;
  let prisma: any;

  beforeEach(() => {
    prisma = {
      user: {
        findUnique: vi.fn(),
        update: vi.fn(),
      },
      trustedContact: {
        deleteMany: vi.fn(),
        createMany: vi.fn(),
      },
    };
    // The contact set is replaced inside a transaction so a failure can never
    // leave an account with no trusted contacts (KI-7). The mock hands the
    // callback the same client, which is what Prisma does for an interactive
    // transaction.
    prisma.$transaction = vi.fn((fn: any) => fn(prisma));
    service = new SettingsService(prisma);
  });

  describe('getSettings', () => {
    it('returns formatted settings when user is found', async () => {
      const mockUser = {
        id: 'user-1',
        fullName: 'Josim',
        bloodType: 'O+',
        allergies: 'Peanuts',
        locationSharingEnabled: true,
        shareLocationOnSos: true,
        sendSmsOnSos: true,
        shakeToSosEnabled: false,
        voiceActivationEnabled: false,
        accidentDetectionEnabled: true,
        trustedContacts: [
          { id: 'c1', name: 'Mom', phone: '+1234567890' },
        ],
      };

      prisma.user.findUnique.mockResolvedValue(mockUser);

      const result = await service.getSettings('user-1');
      expect(result.personalInfo.fullName).toBe('Josim');
      expect(result.personalInfo.bloodType).toBe('O+');
      expect(result.personalInfo.allergies).toBe('Peanuts');
      expect(result.trustedContacts).toEqual([{ id: 'c1', name: 'Mom', phone: '+1234567890' }]);
      expect(result.security.locationSharingEnabled).toBe(true);
      expect(result.security.accidentDetectionEnabled).toBe(true);
    });

    it('throws NotFoundException when user does not exist', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.getSettings('unknown-id')).rejects.toThrow(NotFoundException);
    });
  });

  describe('updateSettings', () => {
    it('updates user attributes and replaces trusted contacts', async () => {
      const updateData = {
        personalInfo: { fullName: 'Josim Updated', bloodType: 'B+', allergies: 'None' },
        security: { locationSharingEnabled: false },
        trustedContacts: [{ name: 'Dad', phone: '+9876543210' }],
      };

      const updatedUser = {
        id: 'user-1',
        fullName: 'Josim Updated',
        bloodType: 'B+',
        allergies: 'None',
        locationSharingEnabled: false,
        shareLocationOnSos: true,
        sendSmsOnSos: true,
        shakeToSosEnabled: false,
        voiceActivationEnabled: false,
        accidentDetectionEnabled: false,
        trustedContacts: [{ id: 'c2', name: 'Dad', phone: '+9876543210' }],
      };

      prisma.user.update.mockResolvedValue(updatedUser);
      prisma.user.findUnique.mockResolvedValue(updatedUser);

      const result = await service.updateSettings('user-1', updateData);
      expect(prisma.user.update).toHaveBeenCalled();
      expect(prisma.trustedContact.deleteMany).toHaveBeenCalledWith({ where: { userId: 'user-1' } });
      expect(prisma.trustedContact.createMany).toHaveBeenCalledWith({
        data: [{ name: 'Dad', phone: '+9876543210', userId: 'user-1' }],
      });
      expect(result.personalInfo.fullName).toBe('Josim Updated');
    });

    it('replaces the contact set inside a single transaction', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        fullName: 'Josim',
        trustedContacts: [],
        locationSharingEnabled: true,
        shareLocationOnSos: true,
        sendSmsOnSos: false,
        shakeToSosEnabled: true,
        voiceActivationEnabled: false,
        accidentDetectionEnabled: false,
      });

      await service.updateSettings('user-1', {
        trustedContacts: [{ name: 'Dad', phone: '+9876543210' }],
      });

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it('leaves existing contacts alone when the key is omitted', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        fullName: 'Josim',
        trustedContacts: [{ id: 'c1', name: 'Mom', phone: '+1234567890' }],
        locationSharingEnabled: true,
        shareLocationOnSos: true,
        sendSmsOnSos: false,
        shakeToSosEnabled: true,
        voiceActivationEnabled: false,
        accidentDetectionEnabled: false,
      });

      await service.updateSettings('user-1', {
        security: { sendSmsOnSos: true },
      });

      expect(prisma.trustedContact.deleteMany).not.toHaveBeenCalled();
    });

    it('clears contacts when an empty array is sent explicitly', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        fullName: 'Josim',
        trustedContacts: [],
        locationSharingEnabled: true,
        shareLocationOnSos: true,
        sendSmsOnSos: false,
        shakeToSosEnabled: true,
        voiceActivationEnabled: false,
        accidentDetectionEnabled: false,
      });

      await service.updateSettings('user-1', { trustedContacts: [] });

      expect(prisma.trustedContact.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
      });
      expect(prisma.trustedContact.createMany).not.toHaveBeenCalled();
    });
  });
});
