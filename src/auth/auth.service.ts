import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes } from 'node:crypto';
import { Env } from '../config/env';
import { Prisma } from '../generated/prisma/client';
import { Role, VerificationStatus } from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import {
  TokenPairDto,
  VerifyOtpDto,
  WebCredentialsDto,
  WebLoginDto,
  WebRegisterDto,
  WebRequestOtpDto,
  WebResetPasswordDto,
  WebVerifyOtpDto,
} from './dto/auth.dto';
import { OtpService } from './otp.service';
import { hashPassword, verifyPassword } from './password';

export interface JwtPayload {
  sub: string;
  role: Role;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly otp: OtpService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /**
   * Mobile sign-in (OTP only). Clinicians register and get verified on the web dashboard, so
   * the app lets in only verified ones.
   */
  async verifyOtp(dto: VerifyOtpDto): Promise<TokenPairDto> {
    await this.otp.verify(dto.phone, dto.code);

    let user = await this.prisma.user.findUnique({
      where: { phone: dto.phone },
      include: { clinician: { select: { verificationStatus: true } } },
    });
    if (!user && dto.role === Role.CLINICIAN) {
      throw new ForbiddenException({
        code: 'CLINICIAN_REGISTER_ON_WEB',
        message: 'Clinicians register on the NeoWell web dashboard',
      });
    }
    const isNewUser = !user;
    user ??= {
      ...(await this.prisma.user.create({
        data: { phone: dto.phone, role: dto.role ?? Role.CAREGIVER },
      })),
      clinician: null,
    };
    if (!user.isActive) throw new UnauthorizedException('Account disabled');
    if (
      user.role === Role.CLINICIAN &&
      user.clinician?.verificationStatus !== VerificationStatus.VERIFIED
    ) {
      throw new ForbiddenException({
        code: 'CLINICIAN_NOT_VERIFIED',
        message: 'Your account is not verified yet. Check your status on the web dashboard',
      });
    }

    return { ...(await this.issueTokens(user.id, user.role)), isNewUser };
  }

  // ── Web dashboard: clinicians and admins only ─────────────────

  /** Phone + OTP sign-in for an existing clinician or admin. Never creates an account. */
  async webVerifyOtp(dto: WebVerifyOtpDto): Promise<TokenPairDto> {
    await this.otp.verify(dto.phone, dto.code);
  /**
   * Sends a code by SMS, or by email when a sign-up asks for it. The email goes to the address
   * typed in the form, and only while the phone has no account: otherwise anyone could have a
   * code for someone else's number delivered to their own inbox and sign in with it. The answer is
   * the same either way, so this cannot be used to find accounts or addresses.
   */
  async webRequestOtp(dto: WebRequestOtpDto): Promise<{ expiresInSeconds: number }> {
    if (dto.channel !== 'email' || !dto.email) return this.otp.request(dto.phone);
    const email = dto.email.trim().toLowerCase();
    const [byPhone, byEmail] = await Promise.all([
      this.prisma.user.findUnique({ where: { phone: dto.phone } }),
      this.prisma.user.findFirst({ where: { email: { equals: email, mode: 'insensitive' } } }),
    ]);
    if (!byPhone && !byEmail) return this.otp.request(dto.phone, email);
    return { expiresInSeconds: this.config.get('OTP_TTL_SECONDS', { infer: true }) };
  }

    const user = await this.prisma.user.findUnique({ where: { phone: dto.phone } });
    if (!user || !isWebRole(user.role)) {
      throw new UnauthorizedException('No clinician or admin account for this number');
    }
    if (!user.isActive) throw new UnauthorizedException('Account disabled');
    return { ...(await this.issueTokens(user.id, user.role)), isNewUser: false };
  }

  /** Clinician sign-up: the phone is proven by OTP, the email and password become a second way in. */
  async webRegister(dto: WebRegisterDto): Promise<TokenPairDto> {
    const email = dto.email.trim().toLowerCase();
    const taken = await this.prisma.user.findFirst({
      where: { OR: [{ phone: dto.phone }, { email }] },
      select: { id: true },
    });
    if (taken) throw new ConflictException('Phone number or email already registered');
    await this.otp.verify(dto.phone, dto.code);
    try {
      const user = await this.prisma.user.create({
        data: {
          phone: dto.phone,
          email,
          passwordHash: await hashPassword(dto.password),
          role: Role.CLINICIAN,
          firstName: dto.firstName.trim(),
          lastName: dto.lastName.trim(),
          locale: dto.locale ?? 'en',
        },
      });
      return { ...(await this.issueTokens(user.id, user.role)), isNewUser: true };
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('Phone number or email already registered');
      }
      throw e;
    }
  }

  async webLogin(dto: WebLoginDto): Promise<TokenPairDto> {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email.trim().toLowerCase() },
    });
    const ok = await verifyPassword(dto.password, user?.passwordHash ?? null);
    if (!user || !ok || !isWebRole(user.role) || !user.isActive) {
      throw new UnauthorizedException('Invalid email or password');
    }
    return { ...(await this.issueTokens(user.id, user.role)), isNewUser: false };
  }

  /** Forgot password: proves the phone by OTP, sets a new password, signs out other sessions. */
  async webResetPassword(dto: WebResetPasswordDto): Promise<void> {
    await this.otp.verify(dto.phone, dto.code);
    const user = await this.prisma.user.findUnique({ where: { phone: dto.phone } });
    if (!user || !isWebRole(user.role) || !user.isActive) {
      throw new UnauthorizedException('No clinician or admin account for this number');
    }
    await this.prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await hashPassword(dto.newPassword) },
    });
    await this.revokeAll(user.id);
  }

  /** Set or change the web password (and email) of the signed-in clinician or admin. */
  async setCredentials(userId: string, dto: WebCredentialsDto): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (
      user.passwordHash &&
      !(await verifyPassword(dto.currentPassword ?? '', user.passwordHash))
    ) {
      throw new BadRequestException('Current password is incorrect');
    }
    const email = dto.email?.trim().toLowerCase();
    if (!user.email && !email) throw new BadRequestException('An email address is required');
    try {
      await this.prisma.user.update({
        where: { id: userId },
        data: { passwordHash: await hashPassword(dto.newPassword), ...(email ? { email } : {}) },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('Email already in use');
      }
      throw e;
    }
  }

  /** Rotates the refresh token: the presented one is revoked and a new pair issued. */
  async refresh(refreshToken: string): Promise<TokenPairDto> {
    const tokenHash = sha256(refreshToken);
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });
    if (!stored || stored.expiresAt < new Date() || !stored.user.isActive) {
      throw new UnauthorizedException('Invalid refresh token');
    }
    if (stored.revokedAt) {
      // Reuse of a rotated token suggests theft: revoke every session for this user.
      await this.prisma.refreshToken.updateMany({
        where: { userId: stored.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw new UnauthorizedException('Invalid refresh token');
    }
    const { count } = await this.prisma.refreshToken.updateMany({
      where: { id: stored.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (count === 0) throw new UnauthorizedException('Invalid refresh token');

    return { ...(await this.issueTokens(stored.userId, stored.user.role)), isNewUser: false };
  }

  async logout(refreshToken: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: sha256(refreshToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private revokeAll(userId: string) {
    return this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private async issueTokens(userId: string, role: Role) {
    const payload: JwtPayload = { sub: userId, role };
    const accessToken = await this.jwt.signAsync(payload);
    const refreshToken = randomBytes(48).toString('base64url');
    const days = this.config.get('JWT_REFRESH_TTL_DAYS', { infer: true });
    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash: sha256(refreshToken),
        expiresAt: new Date(Date.now() + days * 24 * 60 * 60 * 1000),
      },
    });
    return { accessToken, refreshToken };
  }
}

function isWebRole(role: Role): boolean {
  return role === Role.CLINICIAN || role === Role.ADMIN;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
