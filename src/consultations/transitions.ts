import { ConsultationStatus as S, Role } from '../generated/prisma/enums';

type Status = (typeof S)[keyof typeof S];
export type ConsultationAction = 'accept' | 'decline' | 'start' | 'complete' | 'no-show' | 'cancel';

/** Which role may perform which action from which status (docs/02 §4, FR-CONS-10). */
const RULES: Record<ConsultationAction, { roles: Role[]; from: Status[]; to: Status }> = {
  accept: { roles: [Role.CLINICIAN], from: [S.REQUESTED], to: S.CONFIRMED },
  decline: { roles: [Role.CLINICIAN], from: [S.REQUESTED], to: S.DECLINED },
  start: { roles: [Role.CLINICIAN], from: [S.CONFIRMED], to: S.IN_PROGRESS },
  // Chat consultations may be completed without an explicit start.
  complete: { roles: [Role.CLINICIAN], from: [S.CONFIRMED, S.IN_PROGRESS], to: S.COMPLETED },
  'no-show': { roles: [Role.CLINICIAN], from: [S.CONFIRMED], to: S.NO_SHOW },
  cancel: {
    roles: [Role.CAREGIVER, Role.CLINICIAN],
    from: [S.AWAITING_PAYMENT, S.REQUESTED, S.CONFIRMED],
    to: S.CANCELLED,
  },
};

export function transition(action: ConsultationAction, from: Status, role: Role): Status | null {
  const rule = RULES[action];
  if (!rule.roles.includes(role) || !rule.from.includes(from)) return null;
  // Only the caregiver can cancel an unpaid booking.
  if (action === 'cancel' && from === S.AWAITING_PAYMENT && role !== Role.CAREGIVER) return null;
  return rule.to;
}

/**
 * FR-CONS-10 refund rule for a cancellation of a paid consultation:
 * clinician cancellations are always refunded; caregivers are refunded while the request is
 * still waiting, or when they cancel at least 1 hour before the start.
 */
export function refundOnCancel(
  from: Status,
  role: Role,
  scheduledAt: Date,
  now = new Date(),
): boolean {
  if (from === S.AWAITING_PAYMENT) return false;
  if (role === Role.CLINICIAN) return true;
  if (from === S.REQUESTED) return true;
  return scheduledAt.getTime() - now.getTime() >= 60 * 60_000;
}
