import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileLogger, LOG_FILES } from './file-logger';

describe('FileLogger', () => {
  it('writes the same lines to both files', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'neowell-log-'));
    const logger = new FileLogger(dir);
    const out = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const err = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    logger.log('hello', 'Ctx');
    logger.error('boom', 'stack here', 'Ctx');
    out.mockRestore();
    err.mockRestore();
    await logger.close();
    const [a, b] = LOG_FILES.map((f) => readFileSync(join(dir, f), 'utf8'));
    expect(a).toBe(b);
    expect(a).toMatch(/LOG \[Ctx\] hello\n/);
    expect(a).toMatch(/ERROR \[Ctx\] boom stack here\n/);
  });
});
