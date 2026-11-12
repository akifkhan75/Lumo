import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateSettingsDto } from './dto/update-settings.dto';

@Injectable()
export class SettingsService {
  constructor(private prisma: PrismaService) {}

  async getSettings(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { trustedContacts: true },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return {
      personalInfo: {
        fullName: user.fullName,
        bloodType: user.bloodType || '',
        allergies: user.allergies || '',
      },
      trustedContacts: user.trustedContacts.map(c => ({
        id: c.id,
        name: c.name,
        phone: c.phone,
      })),
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

  async updateSettings(userId: string, data: UpdateSettingsDto) {
    const { personalInfo, security, trustedContacts } = data;

    // KI-7: contacts were replaced with a bare deleteMany followed by a
    // separate createMany. A failure between the two — or a crash, or a
    // concurrent write — left the account with no trusted contacts at all and
    // no sign that anything had gone wrong. On a safety product that is a
    // silent, total loss of the alert list.
    //
    // One transaction: either the new set is stored or the old set stands.
    await this.prisma.$transaction(async tx => {
      await tx.user.update({
        where: { id: userId },
        data: {
          fullName: personalInfo?.fullName,
          bloodType: personalInfo?.bloodType,
          allergies: personalInfo?.allergies,
          locationSharingEnabled: security?.locationSharingEnabled,
          shareLocationOnSos: security?.shareLocationOnSos,
          sendSmsOnSos: security?.sendSmsOnSos,
          shakeToSosEnabled: security?.shakeToSosEnabled,
          voiceActivationEnabled: security?.voiceActivationEnabled,
          accidentDetectionEnabled: security?.accidentDetectionEnabled,
        },
      });

      // Omitting the key leaves the existing contacts alone; sending an empty
      // array is an explicit instruction to clear them. The two must not mean
      // the same thing.
      if (trustedContacts !== undefined) {
        await tx.trustedContact.deleteMany({ where: { userId } });
        if (trustedContacts.length > 0) {
          await tx.trustedContact.createMany({
            data: trustedContacts.map(c => ({
              name: c.name,
              phone: c.phone,
              userId,
            })),
          });
        }
      }
    });

    return this.getSettings(userId);
  }
}
