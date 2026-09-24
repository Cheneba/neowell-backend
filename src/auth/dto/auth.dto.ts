import { IsIn, IsOptional, IsString, Length, Matches } from 'class-validator';
import { Role } from '../../generated/prisma/enums';

const E164 = /^\+[1-9]\d{7,14}$/;

export class RequestOtpDto {
  /** Phone number in E.164 format, e.g. +237670000000 */
  @Matches(E164, { message: 'phone must be in E.164 format, e.g. +237670000000' })
  phone: string;
}

export class VerifyOtpDto {
  @Matches(E164, { message: 'phone must be in E.164 format, e.g. +237670000000' })
  phone: string;

  @Length(6, 6)
  @Matches(/^\d{6}$/)
  code: string;

  /**
   * Role for a first-time sign-up. Ignored for existing accounts.
   * ADMIN can never be self-assigned.
   */
  @IsOptional()
  @IsIn([Role.CAREGIVER, Role.CLINICIAN])
  role?: typeof Role.CAREGIVER | typeof Role.CLINICIAN;
}

export class RefreshDto {
  @IsString()
  refreshToken: string;
}

export class TokenPairDto {
  accessToken: string;
  refreshToken: string;
  /** True when this verification created the account. */
  isNewUser: boolean;
}
