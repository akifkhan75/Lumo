import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { getDataEncryptionKeyring } from '../src/config/env';
import { PiiCipher } from '../src/crypto/pii-cipher';

const prisma = new PrismaClient();
// Personal data is encrypted at rest (KI-26), so the seed needs DATA_ENCRYPTION_KEY
// like the API does, and writes ciphertext like the API does.
const cipher = new PiiCipher(getDataEncryptionKeyring());

const PASSWORD_HASH =
  '$argon2id$v=19$m=65536,p=4,t=3$ngZIWfC2Tyc0e1Dn/UeMig$TIXvSP83BtSlABfoPTVk70Dz8nBewXlin8VT5l90IT8';

async function main() {
  console.log('Seeding database...');

  // Create mock user
  const userId = (
    await prisma.user.upsert({
      where: { email: 'josim@example.com' },
      update: { passwordHash: PASSWORD_HASH },
      create: {
        email: 'josim@example.com',
        passwordHash: PASSWORD_HASH,
        fullName: 'Josim',
        locationSharingEnabled: true,
        shareLocationOnSos: true,
        sendSmsOnSos: false,
        shakeToSosEnabled: true,
        voiceActivationEnabled: false,
        accidentDetectionEnabled: false,
      },
    })
  ).id;

  // Medical details are bound to the user's id, exactly as SettingsService writes them.
  await prisma.user.update({
    where: { id: userId },
    data: {
      bloodType: cipher.encrypt('O+', { model: 'User', column: 'bloodType', rowId: userId }),
      allergies: cipher.encrypt('None', { model: 'User', column: 'allergies', rowId: userId }),
    },
  });

  // One contact, and deliberately NOT an emergency-services number. The seed used
  // to add "Emergency Services" with the phone 911: once dispatch exists, a
  // development database would text an emergency number, and it hard-coded a US
  // value that region profiles exist to keep out of the code. Emergency numbers
  // come from the region profile and are dialled by the user, never stored as a
  // contact.
  if ((await prisma.trustedContact.count({ where: { userId } })) === 0) {
    const id = randomUUID();
    await prisma.trustedContact.create({
      data: {
        id,
        userId,
        name: 'Mom',
        // Obviously fictional (a reserved test range), and with no consent record,
        // so it can never be alerted until it is invited and agrees.
        phone: cipher.encrypt('+1 555 010 0100', { model: 'TrustedContact', column: 'phone', rowId: id }),
        priority: 0,
      },
    });
  }

  // Deliberately no hazard reports.
  //
  // The seed used to create three of them — "a physical assault was reported
  // here last night" among them — at positions it invented, attributed to the
  // demo user. That is fabricated community testimony about a place, and a
  // screenshot of it is indistinguishable from real data.
  //
  // A development database starts with an empty map. The empty state is part
  // of the product and needs to be seen.

  console.log('Seeding finished.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
