import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database...');

  // Create mock user
  await prisma.user.upsert({
    where: { email: 'josim@example.com' },
    update: {
      passwordHash: '$argon2id$v=19$m=65536,p=4,t=3$ngZIWfC2Tyc0e1Dn/UeMig$TIXvSP83BtSlABfoPTVk70Dz8nBewXlin8VT5l90IT8',
    },
    create: {
      email: 'josim@example.com',
      passwordHash: '$argon2id$v=19$m=65536,p=4,t=3$ngZIWfC2Tyc0e1Dn/UeMig$TIXvSP83BtSlABfoPTVk70Dz8nBewXlin8VT5l90IT8',
      fullName: 'Josim',
      bloodType: 'O+',
      allergies: 'None',
      locationSharingEnabled: true,
      shareLocationOnSos: true,
      sendSmsOnSos: false,
      shakeToSosEnabled: true,
      voiceActivationEnabled: false,
      accidentDetectionEnabled: false,
      trustedContacts: {
        create: [
          { name: 'Mom', phone: '111-222-3333' },
          { name: 'Emergency Services', phone: '911' },
        ],
      },
    },
  });

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
