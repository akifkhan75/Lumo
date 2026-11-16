import { Injectable, NotFoundException } from '@nestjs/common';
import { countryOfRegionProfile } from '../trusted-contacts/phone';
import { PiiCipher, type PiiContext } from '../crypto/pii-cipher';
import { PrismaService } from '../prisma/prisma.service';
import { TrustedContactsService } from '../trusted-contacts/trusted-contacts.service';
import { UpdateSettingsDto } from './dto/update-settings.dto';

@Injectable()
export class SettingsService {
  constructor(
    private prisma: PrismaService,
    private contacts: TrustedContactsService,
    private cipher: PiiCipher,
  ) {}

  // Blood type and allergies are encrypted at rest (KI-26). The cell is bound to
  // the user's id, so one user's medical details cannot be moved into another's row.
  private cell(userId: string, column: 'bloodType' | 'allergies'): PiiContext {
    return { model: 'User', column, rowId: userId };
  }

  async getSettings(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const trustedContacts = await this.contacts.list(this.prisma, userId);

    return {
      personalInfo: {
        fullName: user.fullName,
        bloodType: this.cipher.decryptNullable(user.bloodType, this.cell(userId, 'bloodType')) || '',
        allergies: this.cipher.decryptNullable(user.allergies, this.cell(userId, 'allergies')) || '',
      },
      // id, name, phone as always, plus the consent status (additive). "agreed" is the
      // contact's agreement; it does not mean an alert path exists yet.
      trustedContacts: trustedContacts.map(c => ({ id: c.id, name: c.name, phone: c.phone, consentStatus: c.consentStatus })),
      security: {
        locationSharingEnabled: user.locationSharingEnabled,
        shareLocationOnSos: user.shareLocationOnSos,
        sendSmsOnSos: user.sendSmsOnSos,
        shakeToSosEnabled: user.shakeToSosEnabled,
        voiceActivationEnabled: user.voiceActivationEnabled,
        accidentDetectionEnabled: user.accidentDetectionEnabled,
      },
    };
  }

  /** An empty string means "none", stored as null; undefined means "leave it alone". */
  private sealOptional(value: string | undefined, cell: PiiContext) {
    if (value === undefined) return undefined;
    return value === '' ? null : this.cipher.encrypt(value, cell);
  }

  async updateSettings(userId: string, data: UpdateSettingsDto) {
    const { personalInfo, security, trustedContacts } = data;

    // KI-7: contacts used to be replaced with a bare deleteMany then createMany. A
    // failure between the two left the account with no trusted contacts and no sign
    // anything had gone wrong. One transaction: the new set is stored or the old
    // set stands.
    await this.prisma.$transaction(async tx => {
      const updated = await tx.user.update({
        where: { id: userId },
        select: { regionProfileId: true },
        data: {
          fullName: personalInfo?.fullName,
          bloodType: this.sealOptional(personalInfo?.bloodType, this.cell(userId, 'bloodType')),
          allergies: this.sealOptional(personalInfo?.allergies, this.cell(userId, 'allergies')),
          locationSharingEnabled: security?.locationSharingEnabled,
          shareLocationOnSos: security?.shareLocationOnSos,
          sendSmsOnSos: security?.sendSmsOnSos,
          shakeToSosEnabled: security?.shakeToSosEnabled,
          voiceActivationEnabled: security?.voiceActivationEnabled,
          accidentDetectionEnabled: security?.accidentDetectionEnabled,
        },
      });

      // Omitting the key leaves the existing contacts alone; sending an empty array
      // is an explicit instruction to remove them all. The two must not mean the
      // same thing.
      //
      // Contacts are RECONCILED, not replaced: a contact whose id is sent back keeps
      // that id (the delivery ledger points at it), and a changed number revokes the
      // consent the old number gave. See TrustedContactsService.
      if (trustedContacts !== undefined) {
        // A number written locally is read in the user's own country, never a guessed one.
        await this.contacts.replaceSet(tx, userId, trustedContacts, countryOfRegionProfile(updated?.regionProfileId));
      }
    });

    return this.getSettings(userId);
  }
}
