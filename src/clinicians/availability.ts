export interface Slot {
  dayOfWeek: number;
  startMinute: number;
  endMinute: number;
}

/** Returns the first pair of slots on the same day that overlap, or null. Touching slots (10:00 end, 10:00 start) are fine. */
export function findOverlap(slots: Slot[]): [Slot, Slot] | null {
  const sorted = [...slots].sort(
    (a, b) => a.dayOfWeek - b.dayOfWeek || a.startMinute - b.startMinute,
  );
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    if (prev.dayOfWeek === cur.dayOfWeek && cur.startMinute < prev.endMinute) return [prev, cur];
  }
  return null;
}
