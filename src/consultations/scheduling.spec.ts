import { fitsAvailability, freeSlots } from './scheduling';

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

describe('freeSlots', () => {
  // Thursday 1 Oct 2026, 07:00 UTC = 08:00 local.
  const now = new Date('2026-10-01T07:00:00Z');

  it('lists 30-minute starts inside the window, at least 30 minutes ahead', () => {
    const slots = freeSlots(windows, [], now, 1).map((d) => d.toISOString());
    // 09:00–12:00 local = 08:00–11:00 UTC → 6 slots; all are ≥ 07:30Z.
    expect(slots).toEqual([
      '2026-10-01T08:00:00.000Z',
      '2026-10-01T08:30:00.000Z',
      '2026-10-01T09:00:00.000Z',
      '2026-10-01T09:30:00.000Z',
      '2026-10-01T10:00:00.000Z',
      '2026-10-01T10:30:00.000Z',
    ]);
  });

  it('skips booked and too-soon slots and repeats weekly', () => {
    const slots = freeSlots(
      windows,
      [new Date('2026-10-01T09:00:00Z')],
      new Date('2026-10-01T08:10:00Z'),
      8,
    );
    const iso = slots.map((d) => d.toISOString());
    expect(iso).not.toContain('2026-10-01T08:30:00.000Z'); // < 30 min ahead
    expect(iso).not.toContain('2026-10-01T09:00:00.000Z'); // booked
    expect(iso).toContain('2026-10-08T08:00:00.000Z'); // next Thursday
  });
});
