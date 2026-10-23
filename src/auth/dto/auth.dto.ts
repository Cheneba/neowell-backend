import {
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
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

// ── Web dashboard (clinicians & admins only) ─────────────────

const PASSWORD_MSG = 'password must be 10–128 characters';

export class WebVerifyOtpDto {
  @Matches(E164, { message: 'phone must be in E.164 format, e.g. +237670000000' })
  phone: string;

  @Length(6, 6)
  @Matches(/^\d{6}$/)
  code: string;
}

export class WebLoginDto {
  @IsEmail() @MaxLength(200) email: string;
  @IsString() @MaxLength(128) password: string;
}

export class WebRegisterDto extends WebVerifyOtpDto {
  @IsEmail() @MaxLength(200) email: string;
  @IsString()
  @MinLength(10, { message: PASSWORD_MSG })
  @MaxLength(128, { message: PASSWORD_MSG })
  password: string;
  @IsString() @MinLength(1) @MaxLength(60) firstName: string;
  @IsString() @MinLength(1) @MaxLength(60) lastName: string;
  @IsOptional() @IsIn(['en', 'fr']) locale?: 'en' | 'fr';
}

export class WebResetPasswordDto extends WebVerifyOtpDto {
  @IsString()
  @MinLength(10, { message: PASSWORD_MSG })
  @MaxLength(128, { message: PASSWORD_MSG })
  newPassword: string;
}

export class WebCredentialsDto {
  /** Required when a password is already set. */
  @IsOptional() @IsString() @MaxLength(128) currentPassword?: string;
  @IsString()
  @MinLength(10, { message: PASSWORD_MSG })
  @MaxLength(128, { message: PASSWORD_MSG })
  newPassword: string;
  /** Sets or changes the sign-in email. */
  @IsOptional() @IsEmail() @MaxLength(200) email?: string;
}
