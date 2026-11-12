import { Global, Module } from '@nestjs/common';
import { getDataEncryptionKeyring } from '../config/env';
import { PiiCipher } from './pii-cipher';

/**
 * Global so the two services that touch personal data (settings, trusted
 * contacts) get the same cipher without each importing the module. The keyring is
 * read when the module is created, so a missing or malformed key stops the API
 * from starting rather than failing on the first request that needs it.
 */
@Global()
@Module({
  providers: [{ provide: PiiCipher, useFactory: () => new PiiCipher(getDataEncryptionKeyring()) }],
  exports: [PiiCipher],
})
export class CryptoModule {}
