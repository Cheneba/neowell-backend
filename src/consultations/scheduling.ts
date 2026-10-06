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

/**
 * Free slot starts for the next `days` days (FR-CONS-01): 30-minute slots inside the weekly
 * windows, starting at least `leadMinutes` from now, excluding slots that overlap `booked`.
 */
export function freeSlots(
  windows: AvailabilityWindow[],
  booked: Date[],
  now: Date,
  days = 7,
  leadMinutes = 30,
): Date[] {
  const slotMs = CONSULTATION_SLOT_MINUTES * 60_000;
  const offsetMs = CLINIC_UTC_OFFSET_MINUTES * 60_000;
  const earliest = now.getTime() + leadMinutes * 60_000;
  const localNow = new Date(now.getTime() + offsetMs);
  const localMidnight = Date.UTC(
    localNow.getUTCFullYear(),
    localNow.getUTCMonth(),
    localNow.getUTCDate(),
  );
  const out: Date[] = [];
  for (let d = 0; d < days; d++) {
    const dayStartLocal = localMidnight + d * 86_400_000;
    const dow = new Date(dayStartLocal).getUTCDay();
    for (const w of windows
      .filter((x) => x.dayOfWeek === dow)
      .sort((a, b) => a.startMinute - b.startMinute)) {
      for (
        let m = w.startMinute;
        m + CONSULTATION_SLOT_MINUTES <= w.endMinute;
        m += CONSULTATION_SLOT_MINUTES
      ) {
        const start = dayStartLocal + m * 60_000 - offsetMs; // back to UTC
        if (start < earliest) continue;
        if (booked.some((b) => Math.abs(b.getTime() - start) < slotMs)) continue;
        if (!out.some((s) => s.getTime() === start)) out.push(new Date(start));
      }
    }
  }
  return out;
}
