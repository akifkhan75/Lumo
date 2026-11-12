import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';

/**
 * KI-23: unhandled errors previously left Nest to render the default 500,
 * leaking stack traces and Prisma messages (which quote column values) to the
 * client, and writing the same detail to logs with no way to correlate a user
 * report to a log line.
 *
 * This filter gives every failure a reference id, logs the detail server-side
 * against that id, and returns a response shaped the same way every time.
 * PLAT-8: the response body never carries internals, and the log line never
 * carries a request body — on this API a body can contain a location.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('HTTP');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const isHttp = exception instanceof HttpException;
    const status = isHttp ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const reference = randomUUID();

    // Client errors are the caller's problem and their detail is safe to
    // return — it is what class-validator produced. Everything else is ours.
    const body = isHttp
      ? exception.getResponse()
      : { statusCode: status, message: 'Internal server error' };

    const payload =
      typeof body === 'string' ? { statusCode: status, message: body, reference } : { ...(body as object), reference };

    const detail = exception instanceof Error ? (exception.stack ?? exception.message) : String(exception);
    const line = `${request.method} ${request.url} -> ${status} [${reference}]`;

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(line, detail);
    } else {
      this.logger.warn(line);
    }

    response.status(status).json(payload);
  }
}
