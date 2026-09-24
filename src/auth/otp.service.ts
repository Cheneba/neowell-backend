import { HttpException, HttpStatus, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { Env } from '../config/env';
import { SmsService } from '../notifications/sms.service';
import { PrismaService } from '../prisma/prisma.service';

const RESEND_COOLDOWN_MS = 30_000;
const MAX_REQUESTS_PER_HOUR = 5;

@Injectable()
export class OtpService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sms: SmsService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async request(phone: string): Promise<{ expiresInSeconds: number }> {
    const now = Date.now();
    const recent = await this.prisma.otpCode.findMany({
      where: { phone, createdAt: { gte: new Date(now - 60 * 60 * 1000) } },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    if (recent.length >= MAX_REQUESTS_PER_HOUR) {
      throw new HttpException(
        'Too many codes requested. Try again later.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    if (recent[0] && now - recent[0].createdAt.getTime() < RESEND_COOLDOWN_MS) {
      throw new HttpException(
        'Please wait before requesting another code.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    const ttl = this.config.get('OTP_TTL_SECONDS', { infer: true });

    // Only one live code per phone at a time.
    await this.prisma.otpCode.updateMany({
      where: { phone, consumedAt: null },
      data: { consumedAt: new Date(now) },
    });
    await this.prisma.otpCode.create({
      data: { phone, codeHash: this.hash(phone, code), expiresAt: new Date(now + ttl * 1000) },
    });
    await this.sms.send(
      phone,
      `Your NeoWell code is ${code}. It expires in ${Math.round(ttl / 60)} minutes.`,
    );
    return { expiresInSeconds: ttl };
  }

  /** Consumes the code if valid; throws otherwise. */
  async verify(phone: string, code: string): Promise<void> {
    const otp = await this.prisma.otpCode.findFirst({
      where: { phone, consumedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    const invalid = new UnauthorizedException('Invalid or expired code');
    if (!otp) throw invalid;

    if (otp.attempts >= this.config.get('OTP_MAX_ATTEMPTS', { infer: true })) {
      await this.prisma.otpCode.update({ where: { id: otp.id }, data: { consumedAt: new Date() } });
      throw invalid;
    }

    const expected = Buffer.from(otp.codeHash, 'hex');
    const actual = Buffer.from(this.hash(phone, code), 'hex');
    if (!timingSafeEqual(expected, actual)) {
      await this.prisma.otpCode.update({
        where: { id: otp.id },
        data: { attempts: { increment: 1 } },
      });
      throw invalid;
    }

    // Conditional update guards against the same code being redeemed twice concurrently.
    const { count } = await this.prisma.otpCode.updateMany({
      where: { id: otp.id, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    if (count === 0) throw invalid;
  }

  private hash(phone: string, code: string): string {
    return createHmac('sha256', this.config.get('OTP_SECRET', { infer: true }))
      .update(`${phone}:${code}`)
      .digest('hex');
  }
}
