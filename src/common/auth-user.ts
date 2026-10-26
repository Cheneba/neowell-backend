import { Role, VerificationStatus } from '../generated/prisma/enums';

/** The authenticated principal attached to `request.user` by the JWT strategy. */
export interface AuthUser {
  id: string;
  role: Role;
  /** Clinicians only; undefined for others, null when no profile exists yet. */
  verificationStatus?: VerificationStatus | null;
}
