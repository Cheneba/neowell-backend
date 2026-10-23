import { hashPassword, verifyPassword } from './password';

describe('password', () => {
  it('verifies the right password and rejects the wrong one', async () => {
    const hash = await hashPassword('correct horse battery');
    expect(await verifyPassword('correct horse battery', hash)).toBe(true);
    expect(await verifyPassword('wrong', hash)).toBe(false);
  });

  it('rejects when there is no stored hash', async () => {
    expect(await verifyPassword('anything', null)).toBe(false);
  });

  it('salts every hash', async () => {
    expect(await hashPassword('same')).not.toBe(await hashPassword('same'));
  });
});
