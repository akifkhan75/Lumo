import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PgBoss, type Db } from 'pg-boss';
import type { Prisma } from '@prisma/client';
import { requireEnv } from '../config/env';

/**
 * The durable queue (docs/specs/NOTIFICATIONS.md): pg-boss on the existing Postgres.
 *
 * The point of putting the queue in the same database is that ENQUEUEING JOINS THE
 * TRANSACTION that writes the attempt row. An attempt that exists with no job to send it
 * would be a lie the ledger tells ("queued") about something that will never happen; a
 * job with no attempt would send something the ledger has no record of. pg-boss 12 ships
 * a Prisma adapter only for Prisma 7, and this repo is on Prisma 5, so `asDb` below is a
 * one-method adapter over the transaction client. The rollback behaviour is tested
 * (queue.e2e), not assumed.
 */

export const SEND_QUEUE = 'notify.send';
export const EXPIRE_QUEUE = 'notify.expire';

export type Tx = Prisma.TransactionClient;

/** pg-boss's Db interface over a Prisma interactive transaction. */
export const asDb = (tx: Tx): Db => ({
  executeSql: async (text: string, values: unknown[] = []) => ({
    rows: (await tx.$queryRawUnsafe(text, ...values)) as unknown[],
  }),
});

export interface JobHandlers {
  send(attemptId: string): Promise<void>;
  expire(attemptId: string): Promise<void>;
}

@Injectable()
export class NotificationQueue implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('NotificationQueue');
  private boss: PgBoss | null = null;
  private handlers: JobHandlers | null = null;

  /** The worker registers itself here, so the queue has no dependency on what it runs. */
  setHandlers(handlers: JobHandlers) {
    this.handlers = handlers;
  }

  /** NOTIFICATIONS_QUEUE=off keeps the API up without a worker (e.g. a read-only replica). */
  private static enabled() {
    return (process.env.NOTIFICATIONS_QUEUE ?? 'on').toLowerCase() !== 'off';
  }

  async onModuleInit() {
    if (!NotificationQueue.enabled()) {
      this.logger.warn('NOTIFICATIONS_QUEUE=off: nothing will be sent and no attempt can be planned.');
      return;
    }
    const boss = new PgBoss({
      connectionString: requireEnv('DATABASE_URL'),
      schema: process.env.NOTIFICATIONS_QUEUE_SCHEMA ?? 'pgboss',
    });
    // An error on the queue's own connection must not crash the API; it is logged without payloads.
    boss.on('error', e => this.logger.error(`queue error: ${e.message}`));
    await boss.start();
    await boss.createQueue(SEND_QUEUE, { retryLimit: 3, retryDelay: 5, retryBackoff: true });
    await boss.createQueue(EXPIRE_QUEUE, { retryLimit: 5, retryDelay: 10, retryBackoff: true });
    // A poll every second and up to 10 jobs at a time: an alert should not wait behind a
    // backlog at one job per two seconds (pg-boss's default).
    const opts = { pollingIntervalSeconds: 1, batchSize: 10 };
    await boss.work<{ attemptId: string }>(SEND_QUEUE, opts, async jobs => {
      for (const job of jobs) await this.handlers?.send(job.data.attemptId);
    });
    await boss.work<{ attemptId: string }>(EXPIRE_QUEUE, opts, async jobs => {
      for (const job of jobs) await this.handlers?.expire(job.data.attemptId);
    });
    this.boss = boss;
  }

  async onModuleDestroy() {
    await this.boss?.stop({ graceful: true, timeout: 5000 });
    this.boss = null;
  }

  get running(): boolean {
    return this.boss !== null;
  }

  private requireBoss(): PgBoss {
    // Fail loudly: planning an attempt that can never be sent would be a ledger lie.
    if (!this.boss) throw new Error('The notification queue is not running; refusing to plan an attempt.');
    return this.boss;
  }

  /** Enqueue the send. Joins `tx`: it exists only if the transaction commits. */
  async enqueueSend(tx: Tx, attemptId: string): Promise<void> {
    await this.requireBoss().send(SEND_QUEUE, { attemptId }, { db: asDb(tx), singletonKey: attemptId });
  }

  /** Enqueue the time-to-live check. Joins `tx`. */
  async enqueueExpiry(tx: Tx, attemptId: string, afterSeconds: number): Promise<void> {
    await this.requireBoss().send(
      EXPIRE_QUEUE,
      { attemptId },
      { db: asDb(tx), startAfter: afterSeconds, singletonKey: attemptId },
    );
  }
}
