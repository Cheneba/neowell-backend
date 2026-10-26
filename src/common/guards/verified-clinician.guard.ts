import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role, VerificationStatus } from '../../generated/prisma/enums';
import { AuthUser } from '../auth-user';
import { ALLOW_UNVERIFIED_KEY } from '../decorators/allow-unverified.decorator';

/**
 * A clinician who is not verified, or was suspended, can only reach the routes marked
 * `@AllowUnverified()`. Checked on every request, so a suspension also cuts off a session
 * that is already signed in (the app shows a "contact support" screen when it sees this).
 */
@Injectable()
export class VerifiedClinicianGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const user: AuthUser | undefined = context.switchToHttp().getRequest().user;
    if (user?.role !== Role.CLINICIAN || user.verificationStatus === VerificationStatus.VERIFIED) {
      return true;
    }
    const allowed = this.reflector.getAllAndOverride<boolean>(ALLOW_UNVERIFIED_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (allowed) return true;
    const suspended = user.verificationStatus === VerificationStatus.SUSPENDED;
    throw new ForbiddenException({
      code: suspended ? 'CLINICIAN_SUSPENDED' : 'CLINICIAN_NOT_VERIFIED',
      message: suspended
        ? 'Your account is suspended. Contact NeoWell support'
        : 'Your account is not verified. Contact NeoWell support',
    });
  }
}
