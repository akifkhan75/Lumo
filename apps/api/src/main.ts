import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { getCorsOrigins, getDataEncryptionKeyring, getJwtSecret, getPort, getRegionRegistry } from './config/env';

async function bootstrap() {
  // Fail before the server binds, not on the first request that needs a
  // token. A misconfigured safety API that looks healthy is worse than one
  // that refuses to start (KI-9).
  getJwtSecret();
  // Same reasoning for the key personal data is encrypted with (KI-26): without it
  // the API would have nothing to read contacts' phone numbers with.
  getDataEncryptionKeyring();
  // And for the markets: a profile that is incomplete or not legally approved must not
  // be served in production, and the API refuses to start rather than serve it.
  getRegionRegistry();

  const app = await NestFactory.create(AppModule);

  app.use(helmet());

  // KI-22: `enableCors()` with no arguments allowed every origin, including
  // credentialed requests from any site a user happened to have open. The
  // mobile app is not subject to CORS; the only browser client is the Phase 1
  // journey page, so an empty allowlist is the correct default.
  const origins = getCorsOrigins();
  app.enableCors({
    origin: origins.length > 0 ? origins : false,
    credentials: true,
  });

  // Shared with the e2e suite so both run the same request pipeline.
  configureApp(app);
  app.enableShutdownHooks();

  const port = getPort();
  await app.listen(port, '0.0.0.0');
  new Logger('Bootstrap').log(
    `Lumo API listening on :${port} · CORS origins: ${origins.length > 0 ? origins.join(', ') : 'none'}`,
  );
}

bootstrap();
