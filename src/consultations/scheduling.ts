/** Cameroon is UTC+1 year-round (no DST). */
export const CLINIC_UTC_OFFSET_MINUTES = 60;
export const CONSULTATION_SLOT_MINUTES = 30;

export interface AvailabilityWindow {
  dayOfWeek: number;
  startMinute: number;
  endMinute: number;
}

/** True when the whole slot starting at `at` fits inside one weekly availability window. */
export function fitsAvailability(at: Date, windows: AvailabilityWindow[]): boolean {
  const local = new Date(at.getTime() + CLINIC_UTC_OFFSET_MINUTES * 60_000);
  const day = local.getUTCDay();
  const start = local.getUTCHours() * 60 + local.getUTCMinutes();
  const end = start + CONSULTATION_SLOT_MINUTES;
  return windows.some((w) => w.dayOfWeek === day && start >= w.startMinute && end <= w.endMinute);
}
