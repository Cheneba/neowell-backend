import { Role } from '../generated/prisma/enums';

/** The authenticated principal attached to `request.user` by the JWT strategy. */
export interface AuthUser {
  id: string;
  role: Role;
}
