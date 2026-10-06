import { flagFor, zScore } from '../growth/who-growth';

/** Pure baby facts used across the API (FR-BABY-02..06). */

export const NAMING_AGE_DAYS = 42;
const DAY_MS = 86_400_000;

export type TermStatus =
  'EXTREMELY_PRETERM' | 'VERY_PRETERM' | 'MODERATE_LATE_PRETERM' | 'TERM' | 'POST_TERM';
export type BirthWeightCategory = 'ELBW' | 'VLBW' | 'LBW' | 'NORMAL' | 'HIGH';

export interface BabyLike {
  id: string;
  givenName: string | null;
  dateOfBirth: Date;
  sex: 'FEMALE' | 'MALE' | null;
  gestationalAgeWeeks: number | null;
  birthWeightGrams: number | null;
  birthLengthCm: number | null;
  birthHeadCircumferenceCm: number | null;
  createdAt: Date;
}

export function ageDays(dob: Date, now = new Date()): number {
  return Math.max(0, Math.floor((now.getTime() - dob.getTime()) / DAY_MS));
}

export function termStatus(weeks: number | null): TermStatus | null {
  if (weeks == null) return null;
  if (weeks < 28) return 'EXTREMELY_PRETERM';
  if (weeks < 32) return 'VERY_PRETERM';
  if (weeks < 37) return 'MODERATE_LATE_PRETERM';
  if (weeks < 42) return 'TERM';
  return 'POST_TERM';
}

export const isPreterm = (weeks: number | null) => weeks != null && weeks < 37;

export function birthWeightCategory(grams: number | null): BirthWeightCategory | null {
  if (grams == null) return null;
  if (grams < 1000) return 'ELBW';
  if (grams < 1500) return 'VLBW';
  if (grams < 2500) return 'LBW';
  if (grams > 4000) return 'HIGH';
  return 'NORMAL';
}

/** Corrected age for preterm babies, until 24 months corrected (FR-BABY-06). Null for term babies. */
export function correctedAgeDays(dob: Date, weeks: number | null, now = new Date()): number | null {
  if (!isPreterm(weeks)) return null;
  const corrected = ageDays(dob, now) - (40 - (weeks as number)) * 7;
  return corrected > 24 * 30.4375 ? null : corrected;
}

/** Age used for growth standards: corrected for preterm babies, never negative. */
export function growthAgeDays(dob: Date, weeks: number | null, at = new Date()): number | null {
  const corrected = correctedAgeDays(dob, weeks, at);
  if (corrected == null) return ageDays(dob, at);
  return corrected < 0 ? null : corrected;
}

/**
 * Display names for all of a caregiver's babies (FR-BABY-02):
 * under 42 days → "Baby {lastName}" (+ " 1", " 2" by birth order when several);
 * from 42 days → given name if set, otherwise still "Baby {lastName}".
 */
export function displayNames(
  babies: BabyLike[],
  caregiverLastName: string | null,
  now = new Date(),
): Map<string, string> {
  const base = `Baby ${caregiverLastName?.trim() || ''}`.trim();
  const usesHospitalName = (b: BabyLike) =>
    ageDays(b.dateOfBirth, now) < NAMING_AGE_DAYS || !b.givenName?.trim();
  const unnamed = babies
    .filter(usesHospitalName)
    .sort(
      (a, b) =>
        a.dateOfBirth.getTime() - b.dateOfBirth.getTime() ||
        a.createdAt.getTime() - b.createdAt.getTime(),
    );
  const names = new Map<string, string>();
  unnamed.forEach((b, i) => names.set(b.id, unnamed.length > 1 ? `${base} ${i + 1}` : base));
  for (const b of babies) if (!names.has(b.id)) names.set(b.id, b.givenName!.trim());
  return names;
}

export type RiskFactorCode =
  | 'PRETERM'
  | 'VERY_PRETERM'
  | 'LOW_BIRTH_WEIGHT'
  | 'VERY_LOW_BIRTH_WEIGHT'
  | 'BIRTH_LENGTH_OUT_OF_RANGE'
  | 'BIRTH_HEAD_SIZE_OUT_OF_RANGE'
  | 'MISSING_BIRTH_DATA';

/** "Needs extra care" reasons (FR-BABY-04). */
export function riskFactors(b: BabyLike): RiskFactorCode[] {
  const out: RiskFactorCode[] = [];
  const w = b.gestationalAgeWeeks;
  if (w != null && w < 32) out.push('VERY_PRETERM');
  else if (isPreterm(w)) out.push('PRETERM');
  const cat = birthWeightCategory(b.birthWeightGrams);
  if (cat === 'VLBW' || cat === 'ELBW') out.push('VERY_LOW_BIRTH_WEIGHT');
  else if (cat === 'LBW') out.push('LOW_BIRTH_WEIGHT');
  // Size at birth is compared with term-born references only (WHO standards start at term).
  if (b.sex && !isPreterm(w)) {
    if (
      b.birthLengthCm != null &&
      flagFor(zScore('lengthForAge', b.sex, 0, b.birthLengthCm)) !== 'NORMAL'
    )
      out.push('BIRTH_LENGTH_OUT_OF_RANGE');
    if (
      b.birthHeadCircumferenceCm != null &&
      flagFor(zScore('headCircumferenceForAge', b.sex, 0, b.birthHeadCircumferenceCm)) !== 'NORMAL'
    )
      out.push('BIRTH_HEAD_SIZE_OUT_OF_RANGE');
  }
  if (
    b.sex == null ||
    w == null ||
    b.birthWeightGrams == null ||
    b.birthLengthCm == null ||
    b.birthHeadCircumferenceCm == null
  )
    out.push('MISSING_BIRTH_DATA');
  return out;
}

export const isHighRisk = (factors: RiskFactorCode[]) =>
  factors.some((f) => f !== 'MISSING_BIRTH_DATA');
