import { findOverlap } from './availability';

const s = (dayOfWeek: number, startMinute: number, endMinute: number) => ({
  dayOfWeek,
  startMinute,
  endMinute,
});

describe('findOverlap', () => {
  it('detects overlapping slots regardless of input order', () => {
    expect(findOverlap([s(1, 560, 620), s(1, 540, 600)])).not.toBeNull();
  });
  it('detects a slot fully inside another and identical slots', () => {
    expect(findOverlap([s(2, 540, 720), s(2, 600, 660)])).not.toBeNull();
    expect(findOverlap([s(2, 540, 600), s(2, 540, 600)])).not.toBeNull();
  });
  it('allows touching slots, different days and empty input', () => {
    expect(findOverlap([s(1, 540, 600), s(1, 600, 660)])).toBeNull();
    expect(findOverlap([s(1, 540, 600), s(2, 540, 600)])).toBeNull();
    expect(findOverlap([])).toBeNull();
  });
});
