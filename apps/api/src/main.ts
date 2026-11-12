import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { getCorsOrigins, getJwtSecret, getPort } from './config/env';

async function bootstrap() {
  // Fail before the server binds, not on the first request that needs a
  // token. A misconfigured safety API that looks healthy is worse than one
  // that refuses to start (KI-9).
  getJwtSecret();

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

  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      // Reject unknown properties rather than quietly dropping them: a client
      // sending a field the server ignores has a bug worth surfacing.
      forbidNonWhitelisted: true,
    }),
  );

  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableShutdownHooks();

  const port = getPort();
  await app.listen(port, '0.0.0.0');
  new Logger('Bootstrap').log(
    `Lumo API listening on :${port} · CORS origins: ${origins.length > 0 ? origins.join(', ') : 'none'}`,
  );
}

bootstrap();
