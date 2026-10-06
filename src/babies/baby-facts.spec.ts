import {
  birthWeightCategory,
  BabyLike,
  correctedAgeDays,
  displayNames,
  growthAgeDays,
  isHighRisk,
  riskFactors,
  termStatus,
} from './baby-facts';

const now = new Date('2026-10-06T12:00:00Z');
const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000);
const baby = (over: Partial<BabyLike>): BabyLike => ({
  id: 'b',
  givenName: null,
  dateOfBirth: daysAgo(5),
  sex: 'FEMALE',
  gestationalAgeWeeks: 39,
  birthWeightGrams: 3200,
  birthLengthCm: 49.5,
  birthHeadCircumferenceCm: 34,
  createdAt: daysAgo(5),
  ...over,
});

describe('displayNames (42-day rule)', () => {
  it('uses "Baby {mother}" under 42 days even when a name is given', () => {
    const names = displayNames([baby({ id: 'a', givenName: 'Amara' })], 'Christian', now);
    expect(names.get('a')).toBe('Baby Christian');
  });

  it('uses the given name from 42 days', () => {
    const names = displayNames(
      [baby({ id: 'a', givenName: 'Amara', dateOfBirth: daysAgo(42) })],
      'Christian',
      now,
    );
    expect(names.get('a')).toBe('Amara');
  });

  it('keeps "Baby {mother}" after 42 days when no name was given', () => {
    const names = displayNames([baby({ id: 'a', dateOfBirth: daysAgo(60) })], 'Christian', now);
    expect(names.get('a')).toBe('Baby Christian');
  });

  it('numbers several babies under 42 days in birth order (twins)', () => {
    const names = displayNames(
      [
        baby({ id: 'second', dateOfBirth: daysAgo(3), createdAt: daysAgo(2) }),
        baby({ id: 'first', dateOfBirth: daysAgo(3), createdAt: daysAgo(3) }),
        baby({ id: 'older', givenName: 'Bih', dateOfBirth: daysAgo(400) }),
      ],
      'Christian',
      now,
    );
    expect(names.get('first')).toBe('Baby Christian 1');
    expect(names.get('second')).toBe('Baby Christian 2');
    expect(names.get('older')).toBe('Bih');
  });
});

describe('term status, weight category, corrected age', () => {
  it.each([
    [26, 'EXTREMELY_PRETERM'],
    [30, 'VERY_PRETERM'],
    [36, 'MODERATE_LATE_PRETERM'],
    [37, 'TERM'],
    [42, 'POST_TERM'],
  ])('%i weeks → %s', (w, s) => expect(termStatus(w)).toBe(s));

  it.each([
    [900, 'ELBW'],
    [1400, 'VLBW'],
    [2499, 'LBW'],
    [2500, 'NORMAL'],
    [4100, 'HIGH'],
  ])('%i g → %s', (g, c) => expect(birthWeightCategory(g)).toBe(c));

  it('corrects age for preterm babies only', () => {
    expect(correctedAgeDays(daysAgo(70), 32, now)).toBe(70 - 56);
    expect(correctedAgeDays(daysAgo(70), 39, now)).toBeNull();
    expect(growthAgeDays(daysAgo(20), 30, now)).toBeNull(); // corrected age still negative
    expect(growthAgeDays(daysAgo(20), 39, now)).toBe(20);
  });
});

describe('riskFactors', () => {
  it('is empty for a healthy term baby', () => {
    expect(riskFactors(baby({}))).toEqual([]);
    expect(isHighRisk(riskFactors(baby({})))).toBe(false);
  });

  it('flags preterm and low birth weight', () => {
    const f = riskFactors(baby({ gestationalAgeWeeks: 34, birthWeightGrams: 2100 }));
    expect(f).toEqual(['PRETERM', 'LOW_BIRTH_WEIGHT']);
    expect(isHighRisk(f)).toBe(true);
  });

  it('flags a head circumference outside the WHO birth range', () => {
    expect(riskFactors(baby({ birthHeadCircumferenceCm: 30 }))).toContain(
      'BIRTH_HEAD_SIZE_OUT_OF_RANGE',
    );
    expect(riskFactors(baby({ birthHeadCircumferenceCm: 38 }))).toContain(
      'BIRTH_HEAD_SIZE_OUT_OF_RANGE',
    );
  });

  it('reports missing birth data on pre-v2 records without counting it as high risk', () => {
    const f = riskFactors(baby({ birthLengthCm: null }));
    expect(f).toEqual(['MISSING_BIRTH_DATA']);
    expect(isHighRisk(f)).toBe(false);
  });
});
