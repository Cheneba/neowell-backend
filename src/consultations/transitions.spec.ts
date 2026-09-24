import { canTransition } from './transitions';

describe('canTransition', () => {
  it('lets the clinician confirm, start and complete', () => {
    expect(canTransition('REQUESTED', 'CONFIRMED', 'CLINICIAN')).toBe(true);
    expect(canTransition('CONFIRMED', 'IN_PROGRESS', 'CLINICIAN')).toBe(true);
    expect(canTransition('IN_PROGRESS', 'COMPLETED', 'CLINICIAN')).toBe(true);
  });

  it('lets the caregiver cancel before the call starts, but not confirm', () => {
    expect(canTransition('REQUESTED', 'CANCELLED', 'CAREGIVER')).toBe(true);
    expect(canTransition('CONFIRMED', 'CANCELLED', 'CAREGIVER')).toBe(true);
    expect(canTransition('IN_PROGRESS', 'CANCELLED', 'CAREGIVER')).toBe(false);
    expect(canTransition('REQUESTED', 'CONFIRMED', 'CAREGIVER')).toBe(false);
  });

  it('treats terminal states as final', () => {
    expect(canTransition('COMPLETED', 'CANCELLED', 'CLINICIAN')).toBe(false);
    expect(canTransition('CANCELLED', 'CONFIRMED', 'CLINICIAN')).toBe(false);
  });
});
