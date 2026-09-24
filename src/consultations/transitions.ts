import { ConsultationStatus as S, Role } from '../generated/prisma/enums';

type Status = (typeof S)[keyof typeof S];

/** Who may move a consultation from one status to another. */
const TRANSITIONS: Record<Status, Partial<Record<Status, Role[]>>> = {
  [S.REQUESTED]: {
    [S.CONFIRMED]: [Role.CLINICIAN],
    [S.CANCELLED]: [Role.CAREGIVER, Role.CLINICIAN],
  },
  [S.CONFIRMED]: {
    [S.IN_PROGRESS]: [Role.CLINICIAN],
    [S.CANCELLED]: [Role.CAREGIVER, Role.CLINICIAN],
    [S.NO_SHOW]: [Role.CLINICIAN],
  },
  [S.IN_PROGRESS]: { [S.COMPLETED]: [Role.CLINICIAN] },
  [S.COMPLETED]: {},
  [S.CANCELLED]: {},
  [S.NO_SHOW]: {},
};

export function canTransition(from: Status, to: Status, role: Role): boolean {
  return TRANSITIONS[from][to]?.includes(role) ?? false;
}
