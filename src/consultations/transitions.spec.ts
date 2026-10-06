import { refundOnCancel, transition } from './transitions';

describe('transition', () => {
  it('lets the clinician accept, start and complete', () => {
    expect(transition('accept', 'REQUESTED', 'CLINICIAN')).toBe('CONFIRMED');
    expect(transition('start', 'CONFIRMED', 'CLINICIAN')).toBe('IN_PROGRESS');
    expect(transition('complete', 'IN_PROGRESS', 'CLINICIAN')).toBe('COMPLETED');
    expect(transition('complete', 'CONFIRMED', 'CLINICIAN')).toBe('COMPLETED');
  });

  it('does not let the caregiver act for the clinician', () => {
    expect(transition('accept', 'REQUESTED', 'CAREGIVER')).toBeNull();
    expect(transition('complete', 'IN_PROGRESS', 'CAREGIVER')).toBeNull();
  });

  it('allows cancelling only before the call starts; unpaid only by the caregiver', () => {
    expect(transition('cancel', 'AWAITING_PAYMENT', 'CAREGIVER')).toBe('CANCELLED');
    expect(transition('cancel', 'AWAITING_PAYMENT', 'CLINICIAN')).toBeNull();
    expect(transition('cancel', 'CONFIRMED', 'CLINICIAN')).toBe('CANCELLED');
    expect(transition('cancel', 'IN_PROGRESS', 'CAREGIVER')).toBeNull();
  });

  it('treats terminal states as final', () => {
    for (const from of ['COMPLETED', 'CANCELLED', 'DECLINED', 'EXPIRED', 'NO_SHOW'] as const) {
      expect(transition('accept', from, 'CLINICIAN')).toBeNull();
      expect(transition('cancel', from, 'CAREGIVER')).toBeNull();
    }
  });
});

describe('refundOnCancel', () => {
  const now = new Date('2026-10-06T10:00:00Z');
  it('always refunds clinician cancellations and waiting requests', () => {
    expect(refundOnCancel('CONFIRMED', 'CLINICIAN', new Date('2026-10-06T10:05:00Z'), now)).toBe(
      true,
    );
    expect(refundOnCancel('REQUESTED', 'CAREGIVER', new Date('2026-10-06T10:05:00Z'), now)).toBe(
      true,
    );
  });
  it('refunds the caregiver only ≥ 1 hour before a confirmed start', () => {
    expect(refundOnCancel('CONFIRMED', 'CAREGIVER', new Date('2026-10-06T11:00:00Z'), now)).toBe(
      true,
    );
    expect(refundOnCancel('CONFIRMED', 'CAREGIVER', new Date('2026-10-06T10:59:00Z'), now)).toBe(
      false,
    );
  });
  it('never refunds an unpaid booking', () => {
    expect(
      refundOnCancel('AWAITING_PAYMENT', 'CAREGIVER', new Date('2026-10-07T10:00:00Z'), now),
    ).toBe(false);
  });
});
