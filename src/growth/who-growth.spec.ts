import { flagFor, lmsAt, zScore } from './who-growth';

describe('WHO growth z-scores', () => {
  it('matches the published SD lines at birth', () => {
    // Boys weight-for-age at birth: median 3.3 kg, −2 SD 2.5 kg, +2 SD 4.4 kg.
    expect(zScore('weightForAge', 'MALE', 0, 3.3464)).toBeCloseTo(0, 1);
    expect(zScore('weightForAge', 'MALE', 0, 2.5)).toBeCloseTo(-2, 0);
    expect(zScore('weightForAge', 'MALE', 0, 4.4)).toBeCloseTo(2, 0);
    // Girls head circumference at birth: −2 SD 31.5 cm, +2 SD 36.2 cm.
    expect(zScore('headCircumferenceForAge', 'FEMALE', 0, 31.5)).toBeCloseTo(-2, 1);
    expect(zScore('headCircumferenceForAge', 'FEMALE', 0, 36.2)).toBeCloseTo(2, 1);
    // Girls length at birth: median 49.1 cm.
    expect(zScore('lengthForAge', 'FEMALE', 0, 49.1477)).toBeCloseTo(0, 2);
  });

  it('uses monthly tables after 13 weeks and interpolates', () => {
    // Boys weight median at 6 months is 7.9 kg.
    expect(zScore('weightForAge', 'MALE', Math.round(6 * 30.4375), 7.934)).toBeCloseTo(0, 1);
    const mid = lmsAt('weightForAge', 'FEMALE', 3.5)!;
    const [a, b] = [lmsAt('weightForAge', 'FEMALE', 0)!, lmsAt('weightForAge', 'FEMALE', 7)!];
    expect(mid[1]).toBeCloseTo((a[1] + b[1]) / 2, 4);
  });

  it('returns null outside the table range', () => {
    expect(zScore('lengthForAge', 'MALE', 25 * 30.4375, 90)).toBeNull();
    expect(zScore('weightForAge', 'MALE', -1, 3)).toBeNull();
  });

  it('flags by |z|', () => {
    expect(flagFor(0.4)).toBe('NORMAL');
    expect(flagFor(-2.3)).toBe('OUT_OF_RANGE');
    expect(flagFor(3.4)).toBe('FAR_OUT_OF_RANGE');
    expect(flagFor(null)).toBeNull();
  });
});
