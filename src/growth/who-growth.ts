import table from './who-lms.json';

/**
 * WHO Child Growth Standards z-scores (LMS method) for weight, length and head
 * circumference by age and sex (FR-MEAS-04). Pure functions, no I/O.
 *
 * Tables: weekly 0–13 weeks, then monthly (weight/HC to 60 months, length to 24 months).
 * Ages between table points are interpolated linearly in L, M and S.
 */
export type Indicator = 'weightForAge' | 'lengthForAge' | 'headCircumferenceForAge';
export type GrowthSex = 'MALE' | 'FEMALE';
type Lms = [number, number, number];

const DAYS_PER_MONTH = 30.4375;
const indicators = (
  table as unknown as {
    indicators: Record<Indicator, Record<GrowthSex, { weeks: Lms[]; months: Lms[] }>>;
  }
).indicators;

function interpolate(rows: Lms[], position: number): Lms | null {
  if (position < 0 || position > rows.length - 1) return null;
  const i = Math.floor(position);
  if (i === rows.length - 1) return rows[i];
  const f = position - i;
  const [a, b] = [rows[i], rows[i + 1]];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

export function lmsAt(indicator: Indicator, sex: GrowthSex, ageDays: number): Lms | null {
  const t = indicators[indicator][sex];
  if (ageDays <= 13 * 7) return interpolate(t.weeks, ageDays / 7);
  return interpolate(t.months, ageDays / DAYS_PER_MONTH);
}

/** z-score of `value` (kg for weight, cm otherwise); null outside the table's age range. */
export function zScore(
  indicator: Indicator,
  sex: GrowthSex,
  ageDays: number,
  value: number,
): number | null {
  const lms = lmsAt(indicator, sex, ageDays);
  if (!lms || value <= 0) return null;
  const [L, M, S] = lms;
  const z = Math.abs(L) < 1e-9 ? Math.log(value / M) / S : ((value / M) ** L - 1) / (L * S);
  return Math.round(z * 100) / 100;
}

export type GrowthFlag = 'NORMAL' | 'OUT_OF_RANGE' | 'FAR_OUT_OF_RANGE';

/** |z| > 2 → outside the usual range; |z| > 3 → far outside (FR-MEAS-04). */
export function flagFor(z: number | null): GrowthFlag | null {
  if (z == null) return null;
  const a = Math.abs(z);
  return a > 3 ? 'FAR_OUT_OF_RANGE' : a > 2 ? 'OUT_OF_RANGE' : 'NORMAL';
}
