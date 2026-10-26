import { ConsoleLogger, LogLevel } from '@nestjs/common';
import { createWriteStream, mkdirSync, WriteStream } from 'node:fs';
import { join } from 'node:path';

export const LOG_FILES = ['app.log', 'app.copy.log'] as const;

/**
 * Prints every log line to the console like Nest's default logger, and appends the same plain
 * line to two files in `dir` (`app.log` and `app.copy.log`), so one is a literal copy of the other.
 */
export class FileLogger extends ConsoleLogger {
  private readonly streams: WriteStream[];

  constructor(dir: string) {
    super();
    mkdirSync(dir, { recursive: true });
    this.streams = LOG_FILES.map((f) => createWriteStream(join(dir, f), { flags: 'a' }));
  }

  log(message: unknown, ...rest: unknown[]) {
    super.log(message, ...rest);
    this.write('LOG', message, rest);
  }
  error(message: unknown, ...rest: unknown[]) {
    super.error(message, ...rest);
    this.write('ERROR', message, rest);
  }
  warn(message: unknown, ...rest: unknown[]) {
    super.warn(message, ...rest);
    this.write('WARN', message, rest);
  }
  debug(message: unknown, ...rest: unknown[]) {
    super.debug(message, ...rest);
    this.write('DEBUG', message, rest);
  }
  verbose(message: unknown, ...rest: unknown[]) {
    super.verbose(message, ...rest);
    this.write('VERBOSE', message, rest);
  }

  /** Flushes and closes both files. */
  close(): Promise<void> {
    return Promise.all(this.streams.map((s) => new Promise<void>((r) => s.end(r)))).then(
      () => undefined,
    );
  }

  private write(level: string, message: unknown, rest: unknown[]) {
    if (!this.isLevelEnabled(level.toLowerCase() as LogLevel)) return;
    const params = [...rest];
    const last = params[params.length - 1];
    const context =
      typeof last === 'string' && params.length > 0 ? (params.pop() as string) : this.context;
    const text = (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v));
    const parts = [new Date().toISOString(), level, context ? `[${context}]` : '', text(message)];
    for (const p of params) parts.push(text(p));
    const line = parts.filter(Boolean).join(' ') + '\n';
    for (const s of this.streams) s.write(line);
  }
}
