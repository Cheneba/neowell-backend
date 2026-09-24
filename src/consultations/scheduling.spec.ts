import { fitsAvailability } from './scheduling';

// Thursday 09:00–12:00 local (UTC+1)
const windows = [{ dayOfWeek: 4, startMinute: 9 * 60, endMinute: 12 * 60 }];

describe('fitsAvailability', () => {
  it('accepts a slot inside the window (converting UTC to local time)', () => {
    // 2026-10-01 is a Thursday; 08:00Z = 09:00 local.
    expect(fitsAvailability(new Date('2026-10-01T08:00:00Z'), windows)).toBe(true);
    expect(fitsAvailability(new Date('2026-10-01T10:30:00Z'), windows)).toBe(true);
  });

  it('rejects a slot that would run past the end of the window', () => {
    expect(fitsAvailability(new Date('2026-10-01T10:45:00Z'), windows)).toBe(false);
  });

  it('rejects other days and times', () => {
    expect(fitsAvailability(new Date('2026-10-01T07:59:00Z'), windows)).toBe(false);
    expect(fitsAvailability(new Date('2026-10-02T08:00:00Z'), windows)).toBe(false);
  });
});
