import { INestApplication, ValidationPipe } from '@nestjs/common';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

/**
 * Everything applied to the app after creation, in one place so the e2e suite
 * exercises the application that actually ships.
 *
 * It did not. The e2e harness built its own `ValidationPipe({ whitelist: true,
 * transform: true })` — no `forbidNonWhitelisted` — so a request carrying an
 * unknown property was silently accepted in tests and rejected in production,
 * and the suite could not see the difference. CORS and helmet stay in main.ts
 * because they are deployment concerns, not request-handling behaviour.
 */
export function configureApp(app: INestApplication): INestApplication {
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

  return app;
}
