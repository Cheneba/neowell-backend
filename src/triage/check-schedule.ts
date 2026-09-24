/**
 * How many guided wellbeing checks per day a baby needs (PDR §3):
 *  - under 1 week:            3 checks/day
 *  - 1 week up to 3 months:   2 checks/day
 *  - 3 months and older:      1 check/day
 */
export function checksPerDay(dateOfBirth: Date, now: Date = new Date()): 1 | 2 | 3 {
  const ageMs = now.getTime() - dateOfBirth.getTime();
  if (ageMs < 7 * 24 * 60 * 60 * 1000) return 3;
  if (now < addMonths(dateOfBirth, 3)) return 2;
  return 1;
}

/** Local times (HH:mm) at which reminders are sent for each schedule. */
export const CHECK_TIMES: Record<1 | 2 | 3, string[]> = {
  3: ['07:00', '14:00', '21:00'],
  2: ['08:00', '20:00'],
  1: ['09:00'],
};

export function ageInHours(dateOfBirth: Date, at: Date = new Date()): number {
  return (at.getTime() - dateOfBirth.getTime()) / (60 * 60 * 1000);
}

function addMonths(date: Date, months: number): Date {
  const d = new Date(date);
  const day = d.getUTCDate();
  d.setUTCMonth(d.getUTCMonth() + months);
  // Clamp overflow (e.g. 30 Nov + 3 months → 28/29 Feb, not 2 Mar).
  if (d.getUTCDate() < day) d.setUTCDate(0);
  return d;
}
