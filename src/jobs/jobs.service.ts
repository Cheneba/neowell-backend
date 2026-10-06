import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Env } from '../config/env';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export type JobHandler = (payload: Record<string, unknown>) => Promise<unknown>;

interface ClaimedJob {
  id: string;
  queue: string;
  payload: Record<string, unknown>;
  attempts: number;
  maxAttempts: number;
}

const CLAIM_BATCH = 5;

/**
 * Postgres-backed work queue (docs/05 §1): jobs live in the `Job` table and are claimed
 * with `FOR UPDATE SKIP LOCKED`, so several API instances can work safely in parallel.
 */
@Injectable()
export class JobsService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(JobsService.name);
  private readonly handlers = new Map<string, JobHandler>();
  private timer?: NodeJS.Timeout;
  private polling = false;
  readonly enabled: boolean;
  private readonly pollMs: number;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService<Env, true>,
  ) {
    this.enabled = config.get('JOBS_ENABLED', { infer: true });
    this.pollMs = config.get('JOBS_POLL_MS', { infer: true });
  }

  register(queue: string, handler: JobHandler) {
    this.handlers.set(queue, handler);
  }

  async enqueue(
    queue: string,
    payload: Record<string, unknown>,
    opts: { runAt?: Date; maxAttempts?: number; tx?: Prisma.TransactionClient } = {},
  ) {
    const db = opts.tx ?? this.prisma;
    return db.job.create({
      data: {
        queue,
        payload: payload as Prisma.InputJsonValue,
        runAt: opts.runAt ?? new Date(),
        maxAttempts: opts.maxAttempts ?? 5,
      },
    });
  }

  onApplicationBootstrap() {
    if (!this.enabled) return;
    this.timer = setInterval(() => void this.poll(), this.pollMs);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /** One worker tick: claim due jobs and run them. */
  async poll(): Promise<number> {
    if (this.polling) return 0;
    this.polling = true;
    try {
      const jobs = await this.claim(false);
      for (const job of jobs) await this.run(job);
      return jobs.length;
    } finally {
      this.polling = false;
    }
  }

  /**
   * Runs every queued job, including ones scheduled in the future, until the queue is empty.
   * Used by tests and scripts; retries are not waited for.
   */
  async drain(maxRounds = 20): Promise<number> {
    let total = 0;
    for (let i = 0; i < maxRounds; i++) {
      const jobs = await this.claim(true);
      if (!jobs.length) break;
      for (const job of jobs) await this.run(job);
      total += jobs.length;
    }
    return total;
  }

  private async claim(includeFuture: boolean): Promise<ClaimedJob[]> {
    const due = includeFuture ? Prisma.sql`TRUE` : Prisma.sql`"runAt" <= now()`;
    return this.prisma.$queryRaw<ClaimedJob[]>`
      UPDATE "Job" SET status = 'RUNNING', "lockedAt" = now(), attempts = attempts + 1
      WHERE id IN (
        SELECT id FROM "Job" WHERE status = 'QUEUED' AND ${due}
        ORDER BY "runAt" LIMIT ${CLAIM_BATCH} FOR UPDATE SKIP LOCKED
      )
      RETURNING id, queue, payload, attempts, "maxAttempts"`;
  }

  private async run(job: ClaimedJob) {
    const handler = this.handlers.get(job.queue);
    try {
      if (!handler) throw new Error(`No handler for queue "${job.queue}"`);
      const result = await handler(job.payload);
      await this.prisma.job.update({
        where: { id: job.id },
        data: {
          status: 'DONE',
          finishedAt: new Date(),
          lastError: null,
          ...(result !== undefined
            ? { payload: { ...job.payload, result } as Prisma.InputJsonValue }
            : {}),
        },
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      const failed = job.attempts >= job.maxAttempts;
      this.logger.warn(`Job ${job.id} (${job.queue}) attempt ${job.attempts} failed: ${message}`);
      await this.prisma.job.update({
        where: { id: job.id },
        data: failed
          ? { status: 'FAILED', lastError: message, finishedAt: new Date() }
          : {
              status: 'QUEUED',
              lastError: message,
              runAt: new Date(Date.now() + 2 ** job.attempts * 30_000),
            },
      });
    }
  }

  /** Puts jobs stuck in RUNNING for over 10 minutes back in the queue (J8). */
  requeueStuck() {
    return this.prisma.job.updateMany({
      where: { status: 'RUNNING', lockedAt: { lt: new Date(Date.now() - 10 * 60_000) } },
      data: { status: 'QUEUED', runAt: new Date() },
    });
  }

  /**
   * Runs `fn` only if this instance gets the Postgres advisory lock `key`
   * (global jobs J7, J9 run once even with several instances).
   */
  async withLock(key: number, fn: () => Promise<void>): Promise<boolean> {
    // Transaction-scoped lock: Prisma pools connections, so a session lock could be
    // taken and released on different connections. The lock lives as long as this transaction.
    return this.prisma.$transaction(
      async (tx) => {
        const [{ locked }] = await tx.$queryRaw<
          { locked: boolean }[]
        >`SELECT pg_try_advisory_xact_lock(${key}) AS locked`;
        if (!locked) return false;
        await fn();
        return true;
      },
      { timeout: 15 * 60_000, maxWait: 10_000 },
    );
  }
}
