import { randomBytes } from 'node:crypto';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { SettingsService } from './settings.service';
import { PiiCipher, ENCRYPTED_PREFIX } from '../crypto/pii-cipher';

const cipher = new PiiCipher({ currentId: 'k1', keys: new Map([['k1', randomBytes(32)]]) });
const cell = (userId: string, column: 'bloodType' | 'allergies') => ({ model: 'User', column, rowId: userId });

const dbUser = (overrides: Record<string, any> = {}) => ({
  id: 'user-1',
  fullName: 'Josim',
  bloodType: cipher.encrypt('O+', cell('user-1', 'bloodType')),
  allergies: cipher.encrypt('Peanuts', cell('user-1', 'allergies')),
  locationSharingEnabled: true,
  shareLocationOnSos: true,
  sendSmsOnSos: true,
  shakeToSosEnabled: false,
  voiceActivationEnabled: false,
  accidentDetectionEnabled: true,
  ...overrides,
});

describe('SettingsService', () => {
  let service: SettingsService;
  let prisma: any;
  let contacts: any;

  beforeEach(() => {
    prisma = { user: { findUnique: vi.fn(), update: vi.fn() } };
    // Contacts are reconciled inside the same transaction as the profile update, so
    // a failure can never leave an account with no trusted contacts (KI-7). The mock
    // hands the callback a transaction client, which is what Prisma does.
    prisma.$transaction = vi.fn((fn: any) => fn(prisma));
    contacts = {
      list: vi.fn().mockResolvedValue([]),
      replaceSet: vi.fn().mockResolvedValue([]),
    };
    service = new SettingsService(prisma, contacts, cipher);
  });

  describe('getSettings', () => {
    it('returns decrypted personal info and the settings shape clients have always received', async () => {
      prisma.user.findUnique.mockResolvedValue(dbUser());
      contacts.list.mockResolvedValue([
        { id: 'c1', name: 'Mom', phone: '+1234567890', email: 'mom@example.com', priority: 0, consented: true },
      ]);

      const result = await service.getSettings('user-1');

      expect(result.personalInfo).toEqual({ fullName: 'Josim', bloodType: 'O+', allergies: 'Peanuts' });
      // Id, name, phone — email and consent status are not part of this response yet.
      expect(result.trustedContacts).toEqual([{ id: 'c1', name: 'Mom', phone: '+1234567890' }]);
      expect(result.security).toEqual({
        locationSharingEnabled: true,
        shareLocationOnSos: true,
        sendSmsOnSos: true,
        shakeToSosEnabled: false,
        voiceActivationEnabled: false,
        accidentDetectionEnabled: true,
      });
    });

    it('reads contacts through the contacts service, so removed contacts never appear', async () => {
      prisma.user.findUnique.mockResolvedValue(dbUser());
      await service.getSettings('user-1');
      expect(contacts.list).toHaveBeenCalledWith(prisma, 'user-1');
    });

    it('returns empty strings for blood type and allergies when none are stored', async () => {
      prisma.user.findUnique.mockResolvedValue(dbUser({ bloodType: null, allergies: null }));
      const result = await service.getSettings('user-1');
      expect(result.personalInfo.bloodType).toBe('');
      expect(result.personalInfo.allergies).toBe('');
    });

    it('throws NotFoundException when the user does not exist', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(service.getSettings('missing')).rejects.toThrow(NotFoundException);
    });

    it('refuses to show medical details that were moved into this user’s row', async () => {
      // Another user's ciphertext, copied into this row.
      prisma.user.findUnique.mockResolvedValue(
        dbUser({ bloodType: cipher.encrypt('AB-', cell('someone-else', 'bloodType')) }),
      );
      await expect(service.getSettings('user-1')).rejects.toThrow(/authentication failed/);
    });
  });

  describe('updateSettings', () => {
    beforeEach(() => {
      prisma.user.update.mockResolvedValue({});
      prisma.user.findUnique.mockResolvedValue(dbUser());
    });

    it('stores blood type and allergies as ciphertext, never as the plaintext', async () => {
      await service.updateSettings('user-1', { personalInfo: { fullName: 'Josim', bloodType: 'O+', allergies: 'Peanuts' } });

      const data = prisma.user.update.mock.calls[0][0].data;
      expect(data.bloodType.startsWith(ENCRYPTED_PREFIX)).toBe(true);
      expect(data.allergies.startsWith(ENCRYPTED_PREFIX)).toBe(true);
      expect(JSON.stringify(data)).not.toContain('Peanuts');
      expect(cipher.decrypt(data.bloodType, cell('user-1', 'bloodType'))).toBe('O+');
    });

    it('treats an empty string as "none", stored as null', async () => {
      await service.updateSettings('user-1', { personalInfo: { fullName: 'Josim', bloodType: '', allergies: '' } });
      const data = prisma.user.update.mock.calls[0][0].data;
      expect(data.bloodType).toBeNull();
      expect(data.allergies).toBeNull();
    });

    it('leaves blood type and allergies alone when they are not sent', async () => {
      await service.updateSettings('user-1', { personalInfo: { fullName: 'Josim' } });
      const data = prisma.user.update.mock.calls[0][0].data;
      expect(data.bloodType).toBeUndefined();
      expect(data.allergies).toBeUndefined();
    });

    it('updates only the security fields that were sent', async () => {
      await service.updateSettings('user-1', { security: { shakeToSosEnabled: false } });
      const data = prisma.user.update.mock.calls[0][0].data;
      expect(data.shakeToSosEnabled).toBe(false);
      expect(data.locationSharingEnabled).toBeUndefined();
    });

    describe('contacts', () => {
      it('are reconciled, not replaced — ids that are sent back are handed over so they can be kept', async () => {
        const input = [{ id: 'c2', name: 'Dad', phone: '+9876543210' }];
        await service.updateSettings('user-1', { trustedContacts: input });
        expect(contacts.replaceSet).toHaveBeenCalledWith(prisma, 'user-1', input);
      });

      it('are reconciled inside the same transaction as the profile update', async () => {
        await service.updateSettings('user-1', {
          personalInfo: { fullName: 'Josim' },
          trustedContacts: [{ name: 'Dad', phone: '+9876543210' }],
        });
        expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      });

      it('are left alone when the key is omitted', async () => {
        await service.updateSettings('user-1', { personalInfo: { fullName: 'Josim' } });
        expect(contacts.replaceSet).not.toHaveBeenCalled();
      });

      it('are all removed when an empty list is sent — which is not the same as omitting it', async () => {
        await service.updateSettings('user-1', { trustedContacts: [] });
        expect(contacts.replaceSet).toHaveBeenCalledWith(prisma, 'user-1', []);
      });

      it('roll back the profile update if reconciling them fails', async () => {
        contacts.replaceSet.mockRejectedValue(new Error('boom'));
        await expect(
          service.updateSettings('user-1', { personalInfo: { fullName: 'New' }, trustedContacts: [{ name: 'A', phone: '+1234567' }] }),
        ).rejects.toThrow('boom');
        // The transaction callback threw, so the real client rolls everything back.
        expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      });
    });

    it('returns the freshly read settings', async () => {
      const result = await service.updateSettings('user-1', { personalInfo: { fullName: 'Josim' } });
      expect(result.personalInfo.fullName).toBe('Josim');
    });
  });
});
