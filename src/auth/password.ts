import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

const KEY_LEN = 64;
const COST = { N: 16384, r: 8, p: 1 };

function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(password, salt, KEY_LEN, COST, (err, key) => (err ? reject(err) : resolve(key))),
  );
}

/** `scrypt$<salt>$<hash>` (base64). No external dependency. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  // Always do the work, so a missing account or password is not distinguishable by timing.
  const [scheme, salt, hash] = (stored ?? 'scrypt$AAAAAAAAAAAAAAAAAAAAAA==$').split('$');
  const expected = Buffer.from(hash ?? '', 'base64');
  const actual = await derive(password, Buffer.from(salt ?? '', 'base64'));
  return (
    !!stored &&
    scheme === 'scrypt' &&
    expected.length === actual.length &&
    timingSafeEqual(expected, actual)
  );
}
