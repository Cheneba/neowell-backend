import { ageInHours, checksPerDay } from './check-schedule';

const dob = new Date('2026-01-31T10:00:00Z');
const at = (iso: string) => new Date(iso);

describe('checksPerDay', () => {
  it('is 3 during the first week', () => {
    expect(checksPerDay(dob, at('2026-01-31T12:00:00Z'))).toBe(3);
    expect(checksPerDay(dob, at('2026-02-07T09:59:00Z'))).toBe(3);
  });

  it('is 2 from one week until three months', () => {
    expect(checksPerDay(dob, at('2026-02-07T10:00:00Z'))).toBe(2);
    expect(checksPerDay(dob, at('2026-04-29T09:00:00Z'))).toBe(2);
  });

  it('is 1 from three months (clamping month-end dates)', () => {
    // 31 Jan + 3 months clamps to 30 Apr.
    expect(checksPerDay(dob, at('2026-04-30T10:00:00Z'))).toBe(1);
    expect(checksPerDay(dob, at('2026-09-01T00:00:00Z'))).toBe(1);
  });
});

describe('ageInHours', () => {
  it('computes hours since birth', () => {
    expect(ageInHours(dob, at('2026-02-01T10:00:00Z'))).toBe(24);
  });
});
